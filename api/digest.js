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
// Configuration (Vercel project env):
//   RESEND_API_KEY   required to actually send. Without it the endpoint still analyses and
//                    previews, and reports `configured: false` so the UI can say why.
//   DIGEST_FROM      sender address, e.g. "Sudoku Coach <coach@yourdomain>". Defaults to Resend's
//                    shared onboarding sender, which only delivers to your own Resend account email.
//   CRON_SECRET      when set, the cron GET must present it as a bearer token.
//
// Subscriptions live in the same Redis store as everything else, one entry per profile.

import { Redis } from "@upstash/redis";
import { analyze, renderDigest } from "../lib/digest.js";

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = REST_URL && REST_TOKEN ? new Redis({ url: REST_URL, token: REST_TOKEN }) : null;

const SUBS_KEY = "sudoku-coach:digest-subs";
const STATS_KEY = "sudoku-coach:stats";
const FROM = process.env.DIGEST_FROM || "Sudoku Coach <onboarding@resend.dev>";

// Same charset restriction the games endpoint uses, so a profile id can't reach other keys.
const cleanProfile = (v) => String(v || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
// Deliberately loose — the mail provider is the real validator. This only rejects what is
// obviously not an address, so a legitimate but unusual one is never turned away here.
const validEmail = (v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length <= 254;

async function send({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "no-mailer" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return { sent: false, reason: `mailer ${r.status}`, detail: detail.slice(0, 300) };
  }
  return { sent: true };
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
        return res.status(200).json({ ...digest, configured: !!process.env.RESEND_API_KEY, sent: false });
      }
      if (!validEmail(to)) return res.status(400).json({ error: "That doesn't look like an email address." });
      const out = await send({ to: to.trim(), ...digest });
      if (!out.sent) {
        return res.status(out.reason === "no-mailer" ? 501 : 502)
          .json({ error: out.reason === "no-mailer" ? "Email sending isn't configured on this deployment." : `Couldn't send: ${out.reason}`, detail: out.detail, subject: digest.subject });
      }
      return res.status(200).json({ ok: true, sent: true, to: to.trim(), subject: digest.subject });
    }

    // Everything below needs the store.
    if (!redis) return res.status(501).json({ error: "Cloud sync not configured", configured: false });

    const profile = cleanProfile(req.query.profile);

    if (req.method === "GET" && req.query.status) {
      const sub = (await readSubs()).find((s) => s.profile === profile);
      return res.status(200).json({ subscribed: !!sub, email: sub ? sub.email : null, mailer: !!process.env.RESEND_API_KEY });
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
      return res.status(200).json({ ok: true, subscribed: true, email: String(email).trim(), mailer: !!process.env.RESEND_API_KEY });
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
