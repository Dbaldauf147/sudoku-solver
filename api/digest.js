// The "what's slipping" email digest.
//
//   GET  /api/digest                                  -> cron entry: mail every subscriber
//   GET  /api/digest?status=1&profile=…               -> { subscribed, email }
//   POST /api/digest?profile=…  { email }             -> subscribe (or change the address)
//   POST /api/digest?profile=…  { unsubscribe: true } -> stop
//   POST /api/digest  { games, to, preview }          -> analyse these games; mail them, or with
//                                                        `preview` just return the rendered digest
//
// The preview/send-now path takes games in the request body, so it works for a device that has
// never synced. The weekly cron can only read what's in the store, so it needs cloud sync on —
// the app says so where you turn the digest on.
//
// Configuration (Vercel project env). Two ways to send; set up either one.
//
//   Gmail, over SMTP — nothing to register, no domain of your own:
//     GMAIL_USER          the Gmail address that sends (and, since Gmail rewrites the From header
//                         to the authenticated account, the address it arrives from).
//     GMAIL_APP_PASSWORD  a Google App Password, not the account password — SMTP refuses the
//                         ordinary one on any account with 2-Step Verification. Spaces are ignored,
//                         so it can be pasted exactly as Google prints it.
//
//   Resend — an HTTPS API, better suited to mailing addresses that aren't your own:
//     RESEND_API_KEY      required to send this way.
//     DIGEST_FROM         sender address, e.g. "Sudoku Coach <coach@yourdomain>". Defaults to
//                         Resend's shared onboarding sender, which only delivers to your own
//                         Resend account email. Ignored on the Gmail path, which has no such knob.
//
//   CRON_SECRET           when set, the cron GET must present it as a bearer token.
//
// With neither set the endpoint still analyses and previews, and reports `configured: false` so
// the UI can say why.
//
// Subscriptions live in the same Redis store as everything else, one entry per profile.

import { Redis } from "@upstash/redis";
import { analyze, renderDigest } from "../lib/digest.js";

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = REST_URL && REST_TOKEN ? new Redis({ url: REST_URL, token: REST_TOKEN }) : null;

const SUBS_KEY = "sudoku-coach:digest-subs";
const STATS_KEY = "sudoku-coach:stats";
const SHARED_SENDER = "Sudoku Coach <onboarding@resend.dev>";

// Gmail wins when both are configured: it's the one that needs no domain and can't half-work, so
// a deployment that has just been given Gmail credentials should start using them.
const GMAIL_USER = (process.env.GMAIL_USER || "").trim();
// Google prints an app password in four groups of four. The spaces are presentation, and pasting
// them through would fail authentication for a reason nothing on screen would explain.
const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const RESEND_KEY = process.env.RESEND_API_KEY || "";
// Gmail rewrites From to the authenticated account unless the address is a verified alias, so the
// Gmail path doesn't offer a sender setting: mail is always from the account that sent it. That
// removes the whole class of failure DIGEST_FROM exists to warn about.
const GMAIL_FROM = `Sudoku Coach <${GMAIL_USER}>`;
const RESEND_FROM = process.env.DIGEST_FROM || SHARED_SENDER;

// What this deployment can do, in the shape the Settings panel's checklist reads.
function mailer() {
  if (GMAIL_USER && GMAIL_PASS) return { provider: "gmail", from: GMAIL_FROM, sharedSender: false };
  if (RESEND_KEY) return { provider: "resend", from: RESEND_FROM, sharedSender: RESEND_FROM === SHARED_SENDER };
  return { provider: null, from: null, sharedSender: false };
}

// Same charset restriction the games endpoint uses, so a profile id can't reach other keys.
const cleanProfile = (v) => String(v || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
// Deliberately loose — the mail provider is the real validator. This only rejects what is
// obviously not an address, so a legitimate but unusual one is never turned away here.
const validEmail = (v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length <= 254;

async function sendViaGmail({ to, subject, html, text }) {
  // Imported here rather than at the top of the file: preview, status and subscribe make up most
  // of the traffic to this endpoint and none of them have any business paying an SMTP library's
  // cold start.
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    // The cron mails every subscriber inside one invocation, so a connection that hangs has to
    // give up well within the function's own budget instead of taking the whole run down with it.
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  try {
    await transport.sendMail({ from: GMAIL_FROM, to, subject, html, text });
    return { sent: true };
  } catch (e) {
    // Gmail's own words are the useful half: "535 Username and Password not accepted" says exactly
    // what to go and fix, where "couldn't send" sends you looking through the app.
    return {
      sent: false,
      reason: `gmail ${e?.responseCode || e?.code || "error"}`,
      detail: String(e?.response || e?.message || "").slice(0, 300),
    };
  } finally {
    transport.close();
  }
}

async function sendViaResend({ to, subject, html, text }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html, text }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return { sent: false, reason: `mailer ${r.status}`, detail: detail.slice(0, 300) };
  }
  return { sent: true };
}

async function send(mail) {
  const provider = mailer().provider;
  if (provider === "gmail") return sendViaGmail(mail);
  if (provider === "resend") return sendViaResend(mail);
  return { sent: false, reason: "no-mailer" };
}

async function readSubs() {
  const v = await redis.get(SUBS_KEY);
  return Array.isArray(v) ? v : [];
}

export default async function handler(req, res) {
  try {
    // --- send-now / preview: games come in the request, no store needed ---
    if (req.method === "POST" && req.body && Array.isArray(req.body.games)) {
      const { games, to, preview } = req.body;
      const digest = renderDigest(analyze(games));
      if (preview || !to) {
        return res.status(200).json({ ...digest, configured: !!mailer().provider, sent: false });
      }
      if (!validEmail(to)) return res.status(400).json({ error: "That doesn't look like an email address." });
      const out = await send({ to: to.trim(), ...digest });
      if (!out.sent) {
        return res.status(out.reason === "no-mailer" ? 501 : 502)
          .json({ error: out.reason === "no-mailer" ? "Email sending isn't configured on this deployment." : `Couldn't send: ${out.reason}`, detail: out.detail, subject: digest.subject });
      }
      return res.status(200).json({ ok: true, sent: true, to: to.trim(), subject: digest.subject });
    }

    // Everything below needs the store. The mailer config is reported anyway: it doesn't depend on
    // Redis, and the Settings panel would otherwise have to guess at it — saying "no mail key" when
    // it can't actually tell is worse than saying nothing.
    if (!redis) {
      const m = mailer();
      return res.status(501).json({
        error: "Cloud sync not configured", configured: false,
        store: false, subscribed: false,
        mailer: !!m.provider, provider: m.provider, from: m.from, sharedSender: m.sharedSender,
      });
    }

    const profile = cleanProfile(req.query.profile);

    if (req.method === "GET" && req.query.status) {
      const sub = (await readSubs()).find((s) => s.profile === profile);
      const m = mailer();
      return res.status(200).json({
        subscribed: !!sub,
        email: sub ? sub.email : null,
        mailer: !!m.provider,
        provider: m.provider,   // "gmail" · "resend" · null — the panel names it
        store: true,   // this branch is only reached with the store connected
        from: m.from,
        // Resend's shared onboarding sender only delivers to the address on the Resend account
        // itself. Everything looks configured and mail silently goes nowhere else, so it's called
        // out rather than left to be discovered.
        sharedSender: m.sharedSender,
      });
    }

    if (req.method === "POST") {
      const subs = await readSubs();
      const rest = subs.filter((s) => s.profile !== profile);
      if (req.body && req.body.unsubscribe) {
        await redis.set(SUBS_KEY, rest);
        return res.status(200).json({ ok: true, subscribed: false });
      }
      const email = req.body && req.body.email;
      if (!validEmail(email)) return res.status(400).json({ error: "That doesn't look like an email address." });
      rest.push({ profile, email: String(email).trim(), since: Date.now() });
      await redis.set(SUBS_KEY, rest);
      return res.status(200).json({ ok: true, subscribed: true, email: String(email).trim(), mailer: !!mailer().provider });
    }

    // --- the weekly cron ---
    if (req.method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (secret && req.headers.authorization !== `Bearer ${secret}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const subs = await readSubs();
      const results = [];
      for (const sub of subs) {
        try {
          const games = await redis.get(sub.profile ? `${STATS_KEY}:${sub.profile}` : STATS_KEY);
          const a = analyze(Array.isArray(games) ? games : []);
          // Nothing to say and nothing played — better to stay quiet than to send an empty week.
          if (!a.games) { results.push({ profile: sub.profile, skipped: "no games" }); continue; }
          const out = await send({ to: sub.email, ...renderDigest(a) });
          results.push({ profile: sub.profile, sent: out.sent, reason: out.reason, findings: a.worse.length });
        } catch (e) {
          results.push({ profile: sub.profile, error: e?.message || "failed" });
        }
      }
      return res.status(200).json({ ok: true, subscribers: subs.length, results });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(502).json({ error: err?.message || "Digest failed" });
  }
}
