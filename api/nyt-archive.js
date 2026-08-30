// Vercel serverless function: the shared archive of NYT sudoku days, and the cron that fills it.
//
// NYT serves only the current day — /puzzles/sudoku/<difficulty> carries no date and has no archive
// behind it — so a day nobody captures while it *is* that day is gone for good. The app keeps a
// per-device archive of the days it was open for, which leaves the obvious hole: a device that
// isn't opened all weekend can't capture the weekend. This is the other half. A cron captures every
// day server-side, and any device fills its gaps from here on next open.
//
//   GET /api/nyt-archive                          -> { configured, count, days: [...] }
//   GET /api/nyt-archive?since=2026-08-01&limit=60
//   GET /api/nyt-archive?capture=1                -> the cron: fetch today and file it
//
// Days are stored as { date, puzzles: { easy: "<81 digits>", … }, capturedAt }, newest first, in one
// Redis value — the same shape the browser keeps, so the client merge is a straight pass through its
// own archiveNytDay(). Like /api/games this is a single shared dataset with no per-user auth, which
// is what it should be: a given day's puzzles are the same for everyone.
//
// Backed by the same Redis store as /api/games (Vercel Marketplace → Upstash Redis). With no store
// connected this replies 501 and the app carries on with its per-device archive alone.

import { Redis } from "@upstash/redis";
import { loadAllDifficulties } from "./nyt-sudoku.js";

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = REST_URL && REST_TOKEN ? new Redis({ url: REST_URL, token: REST_TOKEN }) : null;

const ARCHIVE_KEY = "sudoku-coach:nyt-archive";
const MAX_DAYS = 400;          // ~13 months. Days are ~260 bytes, so the whole value stays small.
const DEFAULT_LIMIT = 120;     // enough to fill in any gap a device could plausibly have
const DIFFICULTIES = ["easy", "medium", "hard"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PUZZLE_81 = /^[0-9]{81}$/;

// NYT's day, not the server's: the deployment runs in UTC, where it's already tomorrow for the last
// few hours of a New York evening. Only used to decide whether today is already held — what a day is
// actually filed under is the print date NYT itself reports.
function nytToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// Anything malformed is dropped rather than served: this value is written by one cron, but it long
// outlives any single deploy, so a day left behind by an older shape shouldn't reach the client.
function readDays(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((d) => d && ISO_DATE.test(d.date) && d.puzzles && typeof d.puzzles === "object")
    .map((d) => {
      const puzzles = {};
      for (const tier of DIFFICULTIES) if (PUZZLE_81.test(String(d.puzzles[tier]))) puzzles[tier] = d.puzzles[tier];
      return { date: d.date, puzzles, capturedAt: d.capturedAt || null };
    })
    .filter((d) => Object.keys(d.puzzles).length)
    .sort((a, b) => (a.date < b.date ? 1 : -1));   // newest first
}

// Vercel sends `Authorization: Bearer $CRON_SECRET` on every cron invocation.
function cronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "unset";
  return String(req.headers.authorization || "") === `Bearer ${secret}` ? "ok" : "bad";
}

// Fetch today from NYT and file it. Idempotent: a day already held in full is not re-fetched, which
// is also what keeps this from being useful to hammer NYT with if CRON_SECRET hasn't been set —
// after the day's first successful capture every further call is one Redis read.
async function capture(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const auth = cronAuth(req);
  if (auth === "bad") {
    return res.status(401).json({ error: "Bad or missing cron secret", reason: "unauthorized" });
  }
  // Re-fetching a day already held is the one thing worth protecting, since it's the only path that
  // reaches NYT unconditionally.
  const force = req.query.force === "1" || req.query.force === "true";
  if (force && auth !== "ok") {
    return res.status(401).json({ error: "force=1 requires CRON_SECRET to be set and sent", reason: "unauthorized" });
  }

  let days;
  try {
    days = readDays(await redis.get(ARCHIVE_KEY));
  } catch (err) {
    return res.status(502).json({ error: err?.message || "Storage error", reason: "storage" });
  }

  const today = nytToday();
  const held = days.find((d) => d.date === today);
  if (!force && held && Object.keys(held.puzzles).length === DIFFICULTIES.length) {
    return res.status(200).json({ ok: true, date: today, filed: 0, note: "already archived", protected: auth === "ok" });
  }

  const day = await loadAllDifficulties();
  if (!day.ok) return res.status(day.status).json({ error: day.error, reason: day.reason });
  // No print date means no day to file it under. Every consumer keys on NYT's own date, so guessing
  // one here would put the puzzles under a date the app's "NYT <date>" sources would then disagree with.
  if (!ISO_DATE.test(String(day.date || ""))) {
    return res.status(502).json({ error: "NYT gave no print date for today's puzzles", reason: "markup-changed" });
  }

  const puzzles = {};
  for (const tier of DIFFICULTIES) {
    const cells = day.puzzles[tier]?.puzzle;
    if (PUZZLE_81.test(String(cells))) puzzles[tier] = cells;
  }
  if (!Object.keys(puzzles).length) {
    return res.status(502).json({ error: "Today's puzzles weren't 81 cells of 0-9", reason: "malformed" });
  }

  // Difficulties merge rather than replace, so a day first captured with two of the three keeps them
  // when a later run brings the third — which is exactly what the second daily run is for.
  let entry = days.find((d) => d.date === day.date);
  if (!entry) { entry = { date: day.date, puzzles: {}, capturedAt: Date.now() }; days.push(entry); }
  let filed = 0;
  for (const [tier, cells] of Object.entries(puzzles)) {
    if (entry.puzzles[tier] !== cells) { entry.puzzles[tier] = cells; filed++; }
  }

  if (filed) {
    days.sort((a, b) => (a.date < b.date ? 1 : -1));
    try {
      await redis.set(ARCHIVE_KEY, days.slice(0, MAX_DAYS));   // the oldest days fall off the end
    } catch (err) {
      return res.status(502).json({ error: err?.message || "Storage error", reason: "storage" });
    }
  }

  return res.status(200).json({
    ok: true, date: day.date, filed, missing: day.missing, total: days.length, protected: auth === "ok",
  });
}

// The days a device can fill its gaps from.
async function list(req, res) {
  const asked = Number(req.query.limit);
  const limit = Math.min(MAX_DAYS, Math.max(1, Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_LIMIT));
  const since = ISO_DATE.test(String(req.query.since || "")) ? String(req.query.since) : null;

  let days;
  try {
    days = readDays(await redis.get(ARCHIVE_KEY));
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: err?.message || "Storage error", reason: "storage" });
  }

  if (since) days = days.filter((d) => d.date >= since);
  days = days.slice(0, limit);

  // An archived day never changes once it's in, so the only thing that moves here is today's entry
  // arriving — a short shared cache costs nothing and spares the store a read per device per open.
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
  return res.status(200).json({ configured: true, count: days.length, days });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed", reason: "method" });
  }
  if (!redis) {
    res.setHeader("Cache-Control", "no-store");
    // Not an error the app should report: without a store there's simply no shared archive, and the
    // per-device one carries on alone.
    return res.status(501).json({ error: "Shared NYT archive not configured", configured: false, days: [] });
  }
  return req.query.capture ? capture(req, res) : list(req, res);
}
