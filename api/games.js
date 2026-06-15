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

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const COLLECTIONS = {
  library: "sudoku-coach:games",
  stats: "sudoku-coach:stats",
};

async function redis(command) {
  const r = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error(`Storage backend returned ${r.status}`);
  return r.json(); // { result: ... }
}

export default async function handler(req, res) {
  if (!REST_URL || !REST_TOKEN) {
    return res
      .status(501)
      .json({ error: "Cloud sync not configured", configured: false });
  }

  const KEY = COLLECTIONS[req.query.collection] || COLLECTIONS.library;

  try {
    if (req.method === "GET") {
      const { result } = await redis(["GET", KEY]);
      return res.status(200).json({ games: result ? JSON.parse(result) : [] });
    }

    if (req.method === "PUT" || req.method === "POST") {
      const games = (req.body && req.body.games) || [];
      if (!Array.isArray(games)) {
        return res.status(400).json({ error: "`games` must be an array" });
      }
      await redis(["SET", KEY, JSON.stringify(games)]);
      return res.status(200).json({ ok: true, count: games.length });
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(502).json({ error: err?.message || "Storage error" });
  }
}
