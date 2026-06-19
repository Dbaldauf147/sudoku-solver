# sudoku-solver

A Sudoku **coach**: enter a puzzle (or import a screenshot) and solve it
yourself, one step at a time. Every move is checked and explained — naming the
actual technique — so you learn the reasoning instead of just getting the
answer.

## How it works

- **`index.html`** — a zero-dependency static front end that houses all the
  Sudoku logic:
  - **Start solving** locks your clues and computes the (unique) solution.
  - **Type a number** in any cell and it tells you immediately whether it's
    right and *why* — e.g. "*R3C5 can only be 7 — every other digit already
    appears in its row, column, or box*" (naked single), or "*within this box,
    7 can only go here*" (hidden single). When a cell isn't a basic single, it
    names the harder technique that unlocks it (pointing pair, box/line
    reduction, naked/hidden pair, X-wing), so those moves are categorized in
    your stats instead of lumped together as "Other".
  - **Hint** finds the next cell you can logically prove, explains it (and
    names the technique — naked/hidden single, pointing pair, box/line
    reduction, naked pair, hidden pair, X-wing), and offers to place it for you.
  - A **number pad** (1–9 plus **✕** to clear) with **Normal** and
    **Candidate** modes — Candidate mode toggles your own pencil marks;
    **Auto notes** fills every empty cell with its possible digits.
  - A **timer** runs while you solve, a live **error count** tracks wrong
    entries, and every move is logged with the time since your last choice and
    the technique that justifies it. The clock **auto-pauses when you switch
    away** from the tab (and there's a manual **Pause**), so idle time doesn't
    skew your stats. **Undo** (or Ctrl/⌘-Z) steps back through your entries.
    Once a digit is placed nine times its number-pad key is crossed out.
  - **Stats** opens a deep-dive: solve times and accuracy **per difficulty**,
    plus **over-time trends** that chart how your numbers move from game to
    game — a **solve time over time** sparkline per difficulty and a
    **technique time over time** sparkline per technique, each tagged with a
    faster/slower badge so you can see whether you're improving. It also has a
    "where you spend time" breakdown of typical (median) time **per technique**
    so you can see what trips you up, and a per-game timeline that bars out the
    gap before each move and flags the slow ones. **Tap any technique** for a
    pop-up with a visual example of how it works.
  - A **History** tab on the main page lists every game you've finished (or
    revealed), grouped by date, with its difficulty, source, time, and error
    count — tap **Details** on any entry to jump straight to that game's
    move-by-move breakdown in Stats.
  - Finishing a puzzle pops a **celebration screen** with your time and error
    count.
  - Wrong entries are flagged with the reason they can't work — without
    spoiling the answer. When a digit **clashes** with one already placed, the
    offending cell, the duplicate cell(s), and the shared **row, column, or
    box are highlighted in red** so you can see exactly why it's illegal.
    **Check entries** and **Reveal solution** are there when you want them.
  - A built-in **catalog** of puzzles ships with the app, so every user can
    pick one and play it from scratch — no setup or account needed. Puzzles
    are also **auto-saved to your library when you start solving** (if that
    exact grid isn't already saved), capturing the selected **difficulty**
    (Easy/Medium/Hard) and **source** (defaults to NYT, editable for other
    sources). There's also a manual **Save puzzle**. The **Saved games**
    button opens a history of everything you've saved — **grouped by date**
    (Today, Yesterday, then by day), newest first, with each entry's
    difficulty and source — where you can **load** or **delete** any puzzle.
  - Stats, Check entries, Reveal solution, Edit puzzle, and Start solving live
    under a ⚙ menu in the top-right corner.

  The coaching and saved library are entirely client-side, so they work
  **without an API key** — only the optional screenshot import calls Claude.

- **`api/games.js`** — optional cross-device sync for the saved library,
  backed by a Redis store. When a store is connected the library syncs across
  devices; when it isn't, the front end silently falls back to the browser's
  `localStorage` (per device), so nothing breaks either way.

### Cross-device sync (optional)

To sync saved puzzles across devices, connect a Redis store:

1. In Vercel → your project → **Storage → Create / Connect Database** → choose
   **Upstash Redis** (Marketplace).
2. Connecting it injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` (the Upstash
   integration also sets `UPSTASH_REDIS_REST_*`; `api/games.js` accepts either).
3. **Redeploy** so the function picks up the new variables.

The library is stored as a single shared collection (no per-user auth), which
is fine for a personal tool — add auth before sharing it broadly.
- **`api/parse-sudoku-image.js`** — a Vercel serverless function that forwards
  the screenshot to Claude Vision and returns the parsed grid as a `9×9` array
  of numbers (`0` = empty).

```
Browser ──(base64 image)──▶ /api/parse-sudoku-image ──▶ Claude Vision
   ▲                                                          │
   └──────────────── { grid: number[9][9] } ◀────────────────┘
```

## Local development

```bash
npm install
npm run dev          # vercel dev — serves index.html + the API locally
```

Set your Anthropic API key so the serverless function can call Claude:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-…" > .env.local
```

Then open the URL printed by `vercel dev` and import a Sudoku screenshot.

## Deploy

This is a standard [Vercel](https://vercel.com) project — static front end plus
a function under `api/`.

1. Add `ANTHROPIC_API_KEY` in your Vercel project's **Environment Variables**.
2. Deploy:

   ```bash
   npm run deploy      # vercel deploy --prod
   ```

## API

`POST /api/parse-sudoku-image`

```jsonc
// request
{ "image": "<base64 image data>", "media_type": "image/png" }

// response
{ "grid": [[5,3,0, ...], ... 9 rows ...] }   // 0 = empty cell
```

Errors come back as `{ "error": "<message>" }` with a 4xx/5xx status.
