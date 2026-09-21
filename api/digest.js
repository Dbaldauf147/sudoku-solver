// The "what's slipping" email digest.
//
//   GET  /api/digest                                  -> cron entry: mail every subscriber who is due
//   GET  /api/digest?status=1&profile=…               -> { subscribed, email, day, time, tz, … }
//   POST /api/digest?profile=…  { email, day, time, tz }  -> subscribe, or change the address or
//                                                        the schedule; anything left out is kept
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
//
// When it goes out. Each subscriber picks a weekday and a time of day in their own timezone, and
// the cron works out who is due. The cron is also the limit on how precise that can be: Vercel
// Hobby triggers a job once a day, so vercel.json runs this daily at CRON_UTC_HOUR rather than
// hourly, and a subscriber is mailed on the first run at or after their chosen moment. With the
// hour set for the morning Eastern that is the same morning, within the hour, all year round; a
// time far from it arrives on the next day's run instead, which the Settings panel works out and
// says rather than leaving you to notice it. Change the cron to "0 * * * *" on a plan that allows
// it and every chosen time becomes exact — nothing in here needs to change with it.

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

// The hour vercel.json fires the cron at, in UTC. Picked so the daily run lands at 8am Eastern in
// winter and 9am in summer: at or just after the default send time, never before it, which is what
// keeps the digest on the day you asked for instead of slipping to the next one. scripts/check.mjs
// fails the build if this and vercel.json disagree — the Settings panel quotes this number when it
// tells you when the mail will actually arrive, and a wrong answer there is worse than none.
const CRON_UTC_HOUR = 13;

const DEFAULT_DAY = 0;          // Sunday, as a JS day index
const DEFAULT_TIME = "08:00";
// Only ever reached by subscriptions written before the schedule was pickable; every one made
// since carries the browser's own zone. Eastern, because that's what CRON_UTC_HOUR is set for.
const DEFAULT_TZ = "America/New_York";
const WEEK_MINUTES = 7 * 24 * 60;

const validDay = (v) => Number.isInteger(v) && v >= 0 && v <= 6;
const validTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
// An IANA zone name, validated by handing it to Intl: the only list of zones that matters is the
// one the runtime actually has, and it is the thing that will be asked to use it.
function validTz(v) {
  if (typeof v !== "string" || !v || v.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: v }); return true; } catch { return false; }
}

// A subscription's schedule, with anything missing or malformed replaced by the default.
const scheduleOf = (sub) => ({
  day: validDay(sub.day) ? sub.day : DEFAULT_DAY,
  time: validTime(sub.time) ? sub.time : DEFAULT_TIME,
  tz: validTz(sub.tz) ? sub.tz : DEFAULT_TZ,
});

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Where `at` falls in the week of `tz`, counted in minutes from local Sunday 00:00. Going through
// Intl keeps daylight saving where it belongs — in the runtime's own zone database — rather than
// in an offset this file would have to remember to keep up to date.
function weekMinutes(tz, at) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(at);
  } catch { return null; }
  const p = {};
  for (const x of parts) p[x.type] = x.value;
  const day = DAY_INDEX[p.weekday];
  if (day === undefined) return null;
  // Some ICU builds still write midnight as "24" under h23. The modulo costs nothing.
  return day * 1440 + (Number(p.hour) % 24) * 60 + Number(p.minute);
}

// The instant this subscriber's weekly moment last came round. Written this way round on purpose:
// a run that misses the moment — because the once-a-day cron fired before it — still mails on the
// next run rather than dropping the week on the floor.
function lastDueAt(sub, at) {
  const s = scheduleOf(sub);
  const now = weekMinutes(s.tz, at) ?? weekMinutes("UTC", at);
  const [h, m] = s.time.split(":").map(Number);
  const elapsed = ((now - (s.day * 1440 + h * 60 + m)) % WEEK_MINUTES + WEEK_MINUTES) % WEEK_MINUTES;
  // Off by an hour across a daylight-saving change, which cannot matter against a gap measured in
  // days: the comparison below is only ever "last week" against "this week".
  return at.getTime() - elapsed * 60000;
}

// A fresh subscription carries `since` and no send yet, so the first digest goes out at the next
// occurrence of the chosen moment rather than on the next run after signing up.
const isDue = (sub, at) => (sub.lastSentAt || sub.since || 0) < lastDueAt(sub, at);

// The instant the next digest actually goes out, which is not the same thing as the time that was
// asked for: it is the first run of the cron at or after it. Settings shows this rather than the
// request, because the difference between the two is exactly what you would otherwise find out by
// waiting for an email that came a morning late.
function nextSendAt(sub, from = new Date()) {
  const hourly = CRON_UTC_HOUR === null;
  const step = hourly ? 3600000 : 86400000;
  const first = Date.UTC(
    from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(),
    hourly ? from.getUTCHours() : CRON_UTC_HOUR, 0, 0, 0,
  );
  // One more run than it takes to cross a whole week, so this always finds one.
  const runs = (hourly ? 24 * 8 : 8) + 1;
  for (let i = 0; i <= runs; i++) {
    const at = new Date(first + i * step);
    if (at <= from) continue;
    if (isDue(sub, at)) return at.getTime();
  }
  return null;
}

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
      // Defaults are returned for a profile that isn't subscribed too, so the pickers have
      // something sensible to open on.
      const when = scheduleOf(sub || {});
      return res.status(200).json({
        subscribed: !!sub,
        email: sub ? sub.email : null,
        day: when.day,          // 0 = Sunday
        time: when.time,        // "HH:MM" in `tz`
        tz: when.tz,
        // What the panel needs to say when the mail will really land: the schedule above is the
        // request, and this once-a-day run is what can be done about it.
        runsAtUtcHour: CRON_UTC_HOUR,   // null when the cron runs hourly and every time is exact
        // Worked out here rather than in the browser: this is the one place that knows both the
        // rule the cron applies and when this subscriber was last mailed.
        nextSendAt: nextSendAt(sub || { since: Date.now(), ...when }),
        lastSentAt: sub ? (sub.lastSentAt || null) : null,
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
      const body = req.body || {};
      const email = body.email;
      if (!validEmail(email)) return res.status(400).json({ error: "That doesn't look like an email address." });
      const prev = subs.find((s) => s.profile === profile);
      // Each field falls back to what was already stored before it falls back to the default, so a
      // request that only carries an address changes only the address.
      const entry = {
        profile,
        email: String(email).trim(),
        since: (prev && prev.since) || Date.now(),
        ...scheduleOf({
          day: validDay(body.day) ? body.day : prev && prev.day,
          time: validTime(body.time) ? body.time : prev && prev.time,
          tz: validTz(body.tz) ? body.tz : prev && prev.tz,
        }),
        // Carried across, so moving the address or nudging the time doesn't hand out a second
        // digest in the same week. A new subscription starts from now, i.e. not already due.
        lastSentAt: (prev && (prev.lastSentAt || prev.since)) || Date.now(),
      };
      rest.push(entry);
      await redis.set(SUBS_KEY, rest);
      return res.status(200).json({
        ok: true, subscribed: true, email: entry.email,
        day: entry.day, time: entry.time, tz: entry.tz,
        runsAtUtcHour: CRON_UTC_HOUR, mailer: !!mailer().provider,
      });
    }

    // --- the weekly cron ---
    if (req.method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (secret && req.headers.authorization !== `Bearer ${secret}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const subs = await readSubs();
      const now = new Date();
      const results = [];
      // The run only writes the store back if it actually moved someone on, so the ordinary case —
      // a daily run on six of the seven days, with nobody due — costs one read and nothing else.
      let changed = false;
      for (const sub of subs) {
        try {
          if (!isDue(sub, now)) { results.push({ profile: sub.profile, skipped: "not due" }); continue; }
          const games = await redis.get(sub.profile ? `${STATS_KEY}:${sub.profile}` : STATS_KEY);
          const a = analyze(Array.isArray(games) ? games : []);
          // Nothing to say and nothing played — better to stay quiet than to send an empty week.
          // The week is still marked as used: otherwise the first game of the week would trip the
          // next day's run and deliver the digest on a day nobody chose.
          if (!a.games) {
            sub.lastSentAt = now.getTime(); changed = true;
            results.push({ profile: sub.profile, skipped: "no games" }); continue;
          }
          const out = await send({ to: sub.email, ...renderDigest(a) });
          // Only a delivered mail moves the marker. A mailer that was briefly down is retried on
          // the next run — a day late, and on the wrong day, but that beats losing the week.
          if (out.sent) { sub.lastSentAt = now.getTime(); changed = true; }
          results.push({ profile: sub.profile, sent: out.sent, reason: out.reason, findings: a.worse.length });
        } catch (e) {
          results.push({ profile: sub.profile, error: e?.message || "failed" });
        }
      }
      if (changed) await redis.set(SUBS_KEY, subs);
      return res.status(200).json({
        ok: true, subscribers: subs.length,
        due: results.filter((r) => r.skipped !== "not due").length,
        results,
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(502).json({ error: err?.message || "Digest failed" });
  }
}
