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
  - **Step-by-step solve** replays the *whole* solve the way you'd do it on
    paper: place, prune, place, prune, until the grid is full. It works
    **easiest-first and one placement per step** — every naked single before any
    hidden single, every single before any technique — and a step that *isn't* a
    single opens by saying no naked or hidden single was available, so you can
    see it didn't skip something simpler. Each step is one
    deduction on a read-only board that shows every cell's candidates — a
    technique step names itself (naked pair, X-wing, skyscraper…), explains the
    elimination, and **strikes the candidates it removes in red where they sit**
    before they disappear; the **Prune candidates** step that follows every
    placement strikes the digit out of every peer it just ruled out. Digits the
    walkthrough places are amber (your givens stay black) and the ones placed on
    the current step are blue. Step through with ‹ ›, or jump with Start / −5 /
    +5 / End, and tap **About this technique** for the worked example. It starts
    from wherever your board actually stands, and never touches your game — the
    clock auto-pauses while it's open and your entries are left alone. When a
    puzzle needs a method beyond the ones the coach names, that step is labelled
    **Forced placement** and says so rather than pretending a rule applies.
  - **Audit: your solve vs the solver.** When a game is over, one tap on the
    celebration screen (or in Stats → *This game*) lays the same puzzle out
    twice, **phase by phase, side by side** — your route on the left, the
    step-by-step solver's on the right, each stopped at the *same number of
    filled cells* so the two are always comparable. Every phase shows what each
    side placed (tinted on the board), the time you spent, your mistakes (in
    red) and hints, the techniques you were credited with against the ones the
    solver used, and how many cells sit differently at that checkpoint — the
    measure of how far your order drifted from the book solution. The header
    totals it up: cells filled, moves taken, how often you picked the same cell
    at the same point as the solver, and the hardest technique the solve
    actually needed.
  - A **number pad** (1–9 plus **✕** to clear) with **Normal** and
    **Candidate** modes — Candidate mode toggles your own pencil marks;
    **Auto notes** fills every empty cell with its possible digits.
  - A **timer** runs while you solve, a live **error count** tracks wrong
    entries, and every move is logged with the time since your last choice and
    the technique that justifies it. The clock **auto-pauses when you switch
    away** from the tab (and there's a manual **Pause**), so idle time doesn't
    skew your stats. **Undo** (Ctrl/⌘-Z) and **Redo** (Ctrl/⌘-Y or
    Ctrl/⌘-Shift-Z) step back and forth through your entries. Once a digit is
    placed nine times its number-pad key is crossed out.
  - **Pencil marks** can be filled for every empty cell at once with **Auto
    notes**, and an **Auto-update notes** setting keeps them tidy — placing a
    digit clears it from the notes of every cell in that row, column, and box
    automatically (and undo puts them back), so you can work advanced
    techniques without re-pencilling by hand.
  - **Settings** (⚙ → Settings) collects the toggles that change how the board
    behaves — **Highlight matches**, **Error highlighting**, and **Auto-update
    notes** — on one screen, each with a line explaining what it actually does
    instead of a bare on/off in the menu. Every setting is remembered on the
    device.
  - **Paste puzzle** loads a game from its 81 digits (0 or `.` for blanks;
    spaces and line breaks are ignored) — handy for puzzles you find as a
    string rather than a screenshot. It's checked for conflicts and
    solvability, then saved to your library like any import.
  - **Stats** opens a deep-dive: solve times and accuracy **per difficulty**,
    plus **over-time trends** that chart how your numbers move from game to
    game — a **solve time over time** sparkline per difficulty and a
    **technique time over time** sparkline per technique, each tagged with a
    faster/slower badge so you can see whether you're improving. It also has a
    "where you spend time" breakdown of typical (median) time **per technique**
    so you can see what trips you up, and a per-game timeline that bars out the
    gap before each move and flags the slow ones. That breakdown also carries a
    **Hints** column — how many hints you asked for that each technique answered
    — and the timeline heads with the same per-technique tally and marks every
    move you placed straight from a hint with 💡, so "I needed help here" is
    visible move by move rather than as one lump total. (Hints you read but
    solved yourself still count in the tally; they just have no 💡 to mark.)
    **Tap any technique** for a pop-up with a visual example of how it works. Stats has two tabs: **All
    games** for these lifetime totals and trends, and **This game** — which
    mirrors the same breakdown for the current (or most recent) game alone:
    its time, accuracy, errors, and hints, how it stacks up against your best
    at that difficulty, where its time went per technique, and its own
    move-by-move timeline. Both tabs also surface **Techniques to practice** —
    your weak spots, ranked by how often you needed help: every hint you take
    is logged against the technique it revealed, and every mistake against the
    simpler step that was available. Tap one for a refresher.
  - **Auto difficulty rating.** The app grades each puzzle by the hardest
    technique its logical solution actually needs — singles only is Easy,
    intersections and pairs are Medium, X-wings and beyond are Hard — instead
    of trusting the clue count or the source's label. The rating (and the
    hardest step it found) shows in the **"Ready to start?" popup** with a
    one-tap **Use** button to apply it to the puzzle's difficulty.
  - **Technique trainer.** A **Practice** tab in the Game library lets you
    drill one technique at a time — hidden singles, pointing pairs, naked and
    hidden pairs/triples, X-wings, XY/XYZ-wings, swordfish. Each drill loads a
    puzzle whose *toughest step is that technique*, so you get repeated,
    targeted reps instead of hoping it turns up. **Learn** opens the worked
    example; **Drill** loads a puzzle. The technique refresher pop-up (and the
    "Techniques to practice" weak-spots list in Stats) has a **Practice this**
    button that drops you straight into a matching drill — so you can go from
    spotting a weakness to training it in one tap.
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
  - A built-in **catalog** of 39 puzzles ships with the app — 12 Easy, 15
    Medium, 12 Hard — so every user can pick one and play it from scratch, no
    setup or account needed. Each is labelled by the same technique-based
    grader used everywhere else (Easy = singles only, Medium = intersections
    and pairs/triples, Hard = X-wings and wings), and every one is verified to
    have a single solution.
  - Every time you **import a screenshot** the puzzle is **saved to your
    library automatically** (if that exact grid isn't already saved) — no
    button to press. The **difficulty** (Easy/Medium/Hard) and **source**
    (defaults to NYT) are set right in the **"Ready to start?" popup** that
    appears on import; editing them there updates the saved copy. The
    **Saved games** button opens a history of everything you've saved —
    **grouped by date** (Today, Yesterday, then by day), newest first, with
    each entry's difficulty and source — where you can **load**, **edit**, or
    **delete** any puzzle.
  - Stats, Step-by-step solve, Settings, Check entries, Reveal solution, Edit
    puzzle, and Start solving live under a ⚙ menu in the top-right corner.

  The coaching and saved library are entirely client-side, so they work
  **without an API key** — only the optional screenshot import calls Claude
  (Claude Vision reads the grid; you fix any misreads before starting).

- **`api/games.js`** — optional cross-device sync for the saved library, play
  history, and the **game currently in progress**, backed by a Redis store. When
  a store is connected these sync across devices — start a puzzle on the website
  and pick it up right where you left off in the installed app (or vice-versa),
  with the most recently touched copy winning. When it isn't connected, the front
  end silently falls back to the browser's `localStorage` (per device), so nothing
  breaks either way.

  Devices **stay** in step, not just at startup: each one re-syncs whenever it
  comes back to the foreground, wakes from the back/forward cache, reconnects, or
  has been left open a while, so a tab (or an installed app you never actually
  reload) doesn't keep showing the history it had when it opened. A launch that
  couldn't reach the store retries with backoff instead of staying device-only for
  the rest of the session.

  The **game in progress keeps its own fast lane**, because that's the one thing
  you want live when you switch devices: it's a single key, so it's polled on its
  own — every 10 seconds for the first couple of minutes after the app wakes, then
  easing to a minute — while the full four-key sync stays on its five-minute beat.
  Pick your phone up and the puzzle you left on the website is there within
  seconds, without an idle tab costing a request every few seconds all day.

  That includes **while you're solving**, which is the case that matters when two
  devices are both sitting on a board — but a background fetch replacing the grid
  mid-move would be worse than being out of step, so what lands depends on what's
  arriving:

  - **the same puzzle, further along** (your own progress from the other device)
    is adopted quietly — and only once your hands have been off the board for a
    few seconds, so it can't land between two keystrokes;
  - **a different puzzle** asks first, with a **Switch** / **Stay** bar. Declining
    silences *that puzzle*, not that moment, so the other device carrying on
    playing doesn't re-ask every few seconds;
  - **a game cleared or finished elsewhere** never touches a board you're playing.

  Whichever device is actually being played holds the newest stamp, so it stays
  the source and the idle one follows.

  Merges are a union, so no device can wipe another's
  data — with two refinements that keep them from disagreeing forever: **deletes
  are recorded as tombstones** and replayed on your other devices instead of being
  undone by them, and on a collision the **most recently edited copy wins**, so
  re-labelling a game on one device isn't reverted by another holding the old one.

  Your game data is protected by four backup layers: (1) primary
  `localStorage`; (2) cloud sync — coalesced and **retried with backoff**, and
  re-pushed when the network reconnects; (3) **rolling local snapshots** (the
  last several changes plus one per earlier day) that auto-restore if the
  primary store is ever emptied; and (4) a manual **Backup & restore** file
  (`Download backup file` / `Restore from a backup file`). The app **nudges
  you to download a backup** every so often, the export includes any
  in-progress game, restoring **merges** (never overwrites), and writes are
  **quota-safe** — if storage fills up, old snapshots are pruned and you're
  warned rather than silently losing data.

### Cross-device sync (optional)

To sync saved puzzles across devices, connect a Redis store:

1. In Vercel → your project → **Storage → Create / Connect Database** → choose
   **Upstash Redis** (Marketplace).
2. Connecting it injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` (the Upstash
   integration also sets `UPSTASH_REDIS_REST_*`; `api/games.js` accepts either).
3. **Redeploy** so the function picks up the new variables.

The library, history, the in-progress game, and the deletion tombstones are each
stored under their own key (namespaced per profile when you sign in), with no
per-user auth, which is fine for a personal tool — add auth before sharing it
broadly.

**If two devices show different history**, they're almost certainly on different
profiles. A profile is `name + passphrase`, so the same name with a different
passphrase is a different account with its own history. The sync line under the
board shows a short **profile code** — if it differs between your phone and your
laptop, sign in on both with exactly the same name and passphrase and they'll
converge. (Both are whitespace-trimmed, so a keyboard that slips in a trailing
space can't quietly split a profile in two.)
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

## When devices don't agree

⚙ → **Settings → Sync** (or tap the sync line at the foot of the ⚙ menu) reports
what sync is actually doing on that device, because "it isn't syncing" is nearly
always one of three things and none of them used to be visible:

- **No store connected** — the API replies `501`, so every device keeps its own
  data and nothing can cross between them. The app can't fix this itself: connect
  a Redis store in Vercel (**Storage → Create / Connect Database → Upstash
  Redis**) and redeploy.
- **Different profiles** — data is namespaced per profile, so the panel shows the
  profile **code** this device is reading. Two devices must show the *same* code;
  the same name with a different passphrase is a different namespace, and Guest
  is its own.
- **Reaching the store but not landing** — any status other than 200 is reported
  as-is (a 5xx usually means the store's credentials are set but wrong).

It also shows how many games the cloud holds against how many this device holds,
so a one-way sync is obvious, with **Sync now** and **Re-check** buttons.

## Staying on the current version

There's no service worker, deliberately: `index.html` is served
`must-revalidate`, so a reload always lands on the newest deploy and there's no
cache layer to go stale. The gap that leaves is a tab — or an installed app on a
phone — that simply never reloads, and so keeps running the build it opened with
while the website has moved on.

So the page fingerprints `index.html` (its `ETag`, else `Last-Modified`, else
`Content-Length`) and re-checks it every minute while visible, plus whenever the
app is brought back to the foreground, refocused, or reconnects. When the
fingerprint changes it acts by what it would cost you:

- **backgrounded** — it reloads onto the new build as you come back to it;
- **idle** (no game in progress, nothing open, no clues part-typed) — it reloads
  straight away;
- **mid-solve or with something open** — it shows a "newer version is live" bar
  with **Reload** and **Later**, since your entries are saved but your place on
  screen isn't.

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
