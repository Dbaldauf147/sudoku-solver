// Cross-device storage for the saved puzzle library and play statistics.
//
// Backed by a Redis store (Vercel Marketplace → Upstash Redis). Each collection
// is kept as one JSON value under its own key, which is plenty for a personal
// collection. If no store is connected the endpoint replies 501 and the front
// end silently falls back to per-device localStorage.
//
//   GET  /api/games?collection=library|stats            -> { games: [...] }
//   PUT  /api/games?collection=library|stats  { games }  -> { ok: true, count }
//
// Connect a store in Vercel and it injects the credentials below automatically
// (redeploy afterwards). This is a single shared dataset — there's no per-user
// auth, which is fine for a personal tool; add auth before sharing it widely.

import { Redis } from "@upstash/redis";

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const COLLECTIONS = {
  library: "sudoku-coach:games",
  stats: "sudoku-coach:stats",
};

// Only build a client when credentials are present; otherwise the endpoint
// reports 501 and the front end falls back to per-device localStorage.
const redis = REST_URL && REST_TOKEN ? new Redis({ url: REST_URL, token: REST_TOKEN }) : null;

export default async function handler(req, res) {
  if (!redis) {
    return res
      .status(501)
      .json({ error: "Cloud sync not configured", configured: false });
  }

  const base = COLLECTIONS[req.query.collection] || COLLECTIONS.library;
  // Per-profile namespacing: the client sends an opaque id (derived from name + passphrase).
  // Restrict to a safe charset so it can't reach other keys.
  const profile = String(req.query.profile || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  const KEY = profile ? `${base}:${profile}` : base;

  try {
    if (req.method === "GET") {
      // The SDK auto-deserializes JSON values, so this is already an array.
      const games = await redis.get(KEY);
      return res.status(200).json({ games: Array.isArray(games) ? games : [] });
    }

    if (req.method === "PUT" || req.method === "POST") {
      const games = (req.body && req.body.games) || [];
      if (!Array.isArray(games)) {
        return res.status(400).json({ error: "`games` must be an array" });
      }
      await redis.set(KEY, games); // SDK serializes the array to JSON.
      return res.status(200).json({ ok: true, count: games.length });
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(502).json({ error: err?.message || "Storage error" });
  }
}
