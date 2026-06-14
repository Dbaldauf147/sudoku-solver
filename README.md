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
    7 can only go here*" (hidden single).
  - **Hint** finds the next cell you can logically prove, explains it (and
    names the technique — naked/hidden single, pointing pair, box/line
    reduction, naked pair, hidden pair, X-wing), and offers to place it for you.
  - **Candidates** toggles pencil marks in every empty cell.
  - Wrong entries are flagged with the reason they can't work — without
    spoiling the answer. **Check entries** and **Reveal solution** are there
    when you want them.
  - **Save puzzle** stores the current grid with its **difficulty**
    (Easy/Medium/Hard) and **source** (defaults to NYT, editable for other
    sources). Saved puzzles are listed below the grid to load or delete.

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
