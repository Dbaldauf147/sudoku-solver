// Vercel serverless function: fetches today's New York Times daily Sudoku.
//
// The NYT puzzle pages are server-rendered with the puzzle embedded in the HTML as a
// `window.gameData` JSON blob, so no subscription, login, or API key is involved — NYT
// sudoku is free. This endpoint exists only because the browser can't read that page
// itself: it's a cross-origin document with no CORS headers, so the fetch has to happen
// server-side and hand back just the grid.
//
// This is an unofficial route — there is no public NYT sudoku API. It depends on the
// shape of a page we don't control, so every failure below is reported with a `reason`
// the front end can turn into an honest message ("NYT changed their page" reads very
// differently from "you're offline"), rather than a generic 500.
//
// Request:  GET /api/nyt-sudoku?difficulty=easy|medium|hard
// Response: 200 { difficulty, date, puzzle: "<81 chars>", grid: number[9][9] }
//
// Request:  GET /api/nyt-sudoku?difficulty=all
// Response: 200 { date, puzzles: { easy: {...}, medium: {...}, hard: {...} }, missing: [] }
//
//           4xx/5xx { error: string, reason: string }
//
// `all` is what the app's "Today's NYT" tab asks for. One page usually embeds all three
// difficulties, so the common case costs a single fetch; any difficulty that page doesn't
// carry is fetched from its own page. A partial result is still a 200 — two puzzles beat
// none — with the shortfall named in `missing`.

const DIFFICULTIES = ["easy", "medium", "hard"];
const UPSTREAM = "https://www.nytimes.com/puzzles/sudoku/";
const TIMEOUT_MS = 10000;

// NYT serves a different (JS-only) page to clients that don't look like browsers, so the
// request carries an ordinary browser's headers. Nothing here is an attempt to defeat a
// block — if they turn us away, the 403 is passed straight through to the caller below.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Pull the `window.gameData = {...}` object out of the page.
//
// Scrapers in the wild match this with a regex anchored to the markup that follows the
// script tag, which breaks the moment NYT reorders anything. Instead this finds the
// assignment and walks the JSON to its matching close brace, tracking string literals and
// escapes so a `}` inside a puzzle title can't end the object early. That survives any
// change to the surrounding page and only fails if the variable itself goes away.
function extractGameData(html) {
  const at = html.indexOf("window.gameData");
  if (at === -1) return null;

  const start = html.indexOf("{", at);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// The 81 cells live at gameData[difficulty].puzzle_data.puzzle. The fallbacks cover a page
// that returns a single bare puzzle object instead of one keyed per difficulty.
function findPuzzle(data, difficulty) {
  const candidates = [data?.[difficulty], data];
  for (const node of candidates) {
    const cells = node?.puzzle_data?.puzzle;
    if (Array.isArray(cells) && cells.length === 81) {
      return { cells, date: node.print_date || node.publish_date || null };
    }
  }
  return null;
}

// Empty cells come back as 0, which is already the app's own convention.
function toGrid(cells) {
  const grid = [];
  for (let r = 0; r < 9; r++) {
    const row = [];
    for (let c = 0; c < 9; c++) {
      const n = Number(cells[r * 9 + c]);
      if (!Number.isInteger(n) || n < 0 || n > 9) {
        throw new Error("Puzzle contained a cell outside 0-9");
      }
      row.push(n);
    }
    grid.push(row);
  }
  return grid;
}

// Fetch one difficulty's page and hand back its parsed gameData. Failures come back as a
// value rather than a throw, so the `all` path can hold several of them at once and still
// answer with whatever it did get.
async function loadPage(difficulty) {
  let html;
  try {
    const response = await fetch(UPSTREAM + difficulty, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // 403/401 here means NYT turned away this server, not the player — most likely the
      // deployment's datacenter IP. Say so, because no amount of retrying fixes it.
      const blocked = response.status === 403 || response.status === 401;
      return {
        ok: false,
        status: 502,
        reason: blocked ? "blocked" : "upstream",
        error: blocked
          ? `NYT refused the request from this server (HTTP ${response.status})`
          : `NYT returned HTTP ${response.status}`,
        upstreamStatus: response.status,
      };
    }

    html = await response.text();
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      reason: timedOut ? "timeout" : "network",
      error: timedOut
        ? `NYT did not respond within ${TIMEOUT_MS / 1000}s`
        : `Couldn't reach NYT: ${err?.message || "network error"}`,
    };
  }

  const data = extractGameData(html);
  if (!data) {
    return {
      ok: false,
      status: 502,
      reason: "markup-changed",
      error: "Couldn't find the puzzle data in the NYT page — their page layout has probably changed",
    };
  }
  return { ok: true, data };
}

// Turn a difficulty's slice of gameData into the shape the app consumes. Absent and
// unreadable are both failures, but they're kept apart: "the puzzle wasn't on the page"
// points at NYT changing their layout, while "the cells weren't digits" points at this
// endpoint misreading data that *was* there. Only the second is a bug on our side.
function readPuzzle(data, difficulty) {
  const found = findPuzzle(data, difficulty);
  if (!found) {
    return {
      ok: false,
      status: 502,
      reason: "markup-changed",
      error: `The NYT page had no ${difficulty} puzzle in its game data`,
    };
  }
  try {
    return {
      ok: true,
      puzzle: { difficulty, date: found.date, puzzle: found.cells.join(""), grid: toGrid(found.cells) },
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      reason: "malformed",
      error: err?.message || "NYT returned a puzzle this endpoint couldn't read",
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed", reason: "method" });
  }

  const requested = String(req.query.difficulty || "easy").toLowerCase();
  if (requested !== "all" && !DIFFICULTIES.includes(requested)) {
    return res.status(400).json({
      error: `difficulty must be one of ${DIFFICULTIES.join(", ")}, or all`,
      reason: "bad-request",
    });
  }
  const difficulty = requested === "all" ? "easy" : requested;

  // The daily puzzle changes once a day, so a shared edge cache spares NYT (and us) a
  // fetch per player. stale-while-revalidate keeps a slow upstream off the critical path.
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");

  const fail = (r) => {
    res.setHeader("Cache-Control", "no-store");
    const { status, ...body } = r;
    return res.status(status).json(body);
  };

  const first = await loadPage(difficulty);
  if (!first.ok) return fail(first);

  if (requested !== "all") {
    const read = readPuzzle(first.data, difficulty);
    if (!read.ok) return fail(read);
    return res.status(200).json(read.puzzle);
  }

  // One page normally embeds all three difficulties, so this usually ends here. Anything it
  // didn't carry is fetched from its own page, concurrently. A difficulty that fails at any
  // step is simply left out — the others are still worth returning.
  const puzzles = {};
  for (const d of DIFFICULTIES) {
    const read = readPuzzle(first.data, d);
    if (read.ok) puzzles[d] = read.puzzle;
  }

  const absent = DIFFICULTIES.filter((d) => !puzzles[d]);
  if (absent.length) {
    const pages = await Promise.all(absent.map((d) => loadPage(d)));
    absent.forEach((d, i) => {
      const page = pages[i];
      if (!page.ok) return;
      const read = readPuzzle(page.data, d);
      if (read.ok) puzzles[d] = read.puzzle;
    });
  }

  const missing = DIFFICULTIES.filter((d) => !puzzles[d]);
  if (missing.length === DIFFICULTIES.length) {
    return fail({
      status: 502,
      error: "The NYT pages had no readable puzzles in their game data — their layout has probably changed",
      reason: "markup-changed",
    });
  }

  // Every puzzle carries the same print date; take it from whichever one turned up.
  const date = DIFFICULTIES.map((d) => puzzles[d]?.date).find(Boolean) || null;
  return res.status(200).json({ date, puzzles, missing });
}
