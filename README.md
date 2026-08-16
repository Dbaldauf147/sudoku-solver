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
  - **Two kinds of hidden single, told apart.** A digit pinned to one cell of a
    **box** is the one you see at a glance; a digit pinned to one cell of a
    **row or column** *while its box still allows it elsewhere* only turns up if
    you scan the whole line. Those are different skills, so they're separate
    labels — **Hidden single (box)** and **Hidden single (row/column)** — with
    their own colours, worked examples, and counts everywhere techniques are
    named: move explanations, hints, the step-by-step solve, and stats. The
    explanation for a row/column one says outright that a box scan wouldn't have
    found it, and the hint shades **just the unit that proves it** — the box for
    a box single, the line for a row/column one. Box singles are always offered
    first, since they're the easier spot. Both stay in the Easy band, so no
    puzzle's difficulty rating changes; games logged before the split keep their
    old "Hidden single" label and still show up in stats.
  - **Hint** finds the next cell you can logically prove, explains it (and
    names the technique — naked single, hidden single in a box or a
    row/column, pointing pair, box/line reduction, naked pair, hidden pair,
    X-wing), and offers to place it for you.
  - **Hints you can see, not just read.** Every hint carries a **Show me on a
    board** button that lays the same reasoning out step by step on a read-only
    replay board: the board as it stands with all candidates pencilled in and
    the cell in question in amber, then *each* elimination the hint needed —
    named, explained, and with the candidates it removes **struck in red where
    they sit** — and then the proof itself. That last step is the one a grid
    tells better than a sentence: a **naked single** crosses out all eight rival
    digits in the cell and highlights the cell already using each one, so you
    can see the eight blockers at once; a **hidden single** crosses the digit
    out of every other cell in the unit that pins it, so "it fits nowhere else"
    is something you look at rather than take on trust. The digit being proved
    is drawn large and green among the ones struck around it, and a colour key
    says what the shading means. Step through with ‹ ›, tap **About this
    technique** for the worked example, or place the digit straight from the
    panel — the clock auto-pauses while it's open and your board is left exactly
    as it was. A move that no named rule forces says so plainly instead of
    inventing one.
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
    placed nine times its number-pad key is crossed out. **Restart** sits beside
    Pause above the board — one confirmation and the puzzle is back to its
    starting clues with a fresh clock, the same reset that lives in the ⚙ menu.
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
  - **Today's three, under the top menu.** A strip on the main page shows the
    day's New York Times puzzles — **Easy · Medium · Hard**, labelled with the
    date — so any of them is one click from the board. Ones you've solved are
    ticked, the one on the board is highlighted, and hovering gives the clue
    count and your time. They're fetched in the background when the app opens;
    if that fails (offline, NYT down) the strip just stays hidden and the
    board is unaffected. Clicking one while a game is in progress asks before
    clearing it.
  - **Today's NYT** is a tab in the game library (⚙ → *Today's NYT puzzle* is a
    shortcut to it) holding the same puzzles with more detail. All three
    difficulties are fetched **in one request** when you open the tab, and
    **Easy / Medium / Hard** sub-tabs switch between them with no further
    network — each showing a thumbnail of the grid, its clue count, whether
    it's already in your library, and your time if you've played it. **Play**
    loads it with the difficulty and puzzle date already filled in, saved to
    your library like any other import. Every grid goes through the same
    conflict and solvability checks as a pasted one, so an unplayable one is
    dropped rather than loaded.

    The day's puzzles are held until the date rolls over, so reopening the tab
    costs nothing; **Refresh** forces a refetch. If NYT only returns some of
    the three, the ones that arrived are still playable and the sub-tabs for
    the others are disabled with a note.

    The fetch happens server-side, in `/api/nyt-sudoku`: the NYT puzzle pages
    embed the grid in the HTML as a `window.gameData` blob (free — no
    subscription or login), but the page is cross-origin with no CORS headers,
    so the browser can't read it directly. Two things worth knowing:

    - **It's unofficial.** There is no public NYT sudoku API, so this depends
      on the shape of a page nobody here controls. If they change it the
      endpoint says so in as many words, and the screenshot and paste imports
      still work. NYT may also refuse the request from a deployment's
      datacenter IP; that failure is reported as their block rather than
      retried.
    - **Don't republish what you pull.** Personal use is one thing;
      **Share catalogue** would turn auto-imported NYT puzzles into
      redistributed NYT content, so keep them out of catalogues you share.
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
    **Over your target pace** is its own section, scoped to nothing but the moves
    that ran past the per-move pace your target implies. *This game* lists those
    moves **slowest first** — cell, technique, what it took, how far over — then
    rolls them up by technique. *All games* ranks the techniques by the **total
    time** those moves cost (most to least, with typical and worst alongside),
    then trails it **game by game**: each game's pace, how many moves went over,
    and which techniques they were with what each cost there — so a technique
    that keeps landing in this section is visible across games rather than only
    within one. Games whose difficulty has no target set sit out (there's no pace
    to miss) instead of being counted as clean.
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
  - **Every technique, worked step by step on a real board.** The refresher
    pop-up also has **Show me step by step**, which gives the technique the
    same treatment a hint gets: a real position where that technique *is* the
    move, then the elimination with its candidates struck in red where they
    sit, then the single it opens up and the proof of it. The position isn't
    hand-drawn — it's hunted out of the practice bank (and the catalogue for
    the techniques with no drill) by playing a puzzle forward and stopping at
    the first board where the technique fires **from plain pencil marks**, so
    it's a position you could have reached yourself, and one that pays off in
    a placement wherever possible. Every rule the coach names has one, from
    full houses to XY-chains — including the ones that never had a hand-drawn
    example. Labels that name no rule (a mistake, a forced move) don't offer
    the button rather than inventing a lesson. **Practice this** sits right
    there in the panel, so you can go from seeing the pattern to drilling it.
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

  A game **ending** elsewhere — finished, revealed, or reset — pulls the full set
  straight away rather than waiting out the five-minute beat, since that's the
  moment the other device's history gains an entry. And **opening Stats or the
  Game library asks the cloud first**: that's the moment you're asking to see
  this data, so it's checked then rather than on whatever the last background
  beat happened to catch.

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
- **Uploads failing** — reads and writes fail independently, and a device whose
  writes keep failing used to look perfectly healthy: writes retry forever in
  silence and the status line only ever reflected reads. A failing upload now
  turns that line into a warning and is named here with its status and payload
  size, because "my last game never reached my other device" is what it looks
  like from the outside.

It also names the **newest game on this device against the newest in the store**,
which is the fork when a game goes missing: if this device's newest isn't in the
store the upload is at fault, and if the store's newest isn't here the download
is. **Upload this device** re-queues and pushes this device's copies — the repair
for a push that never landed, and safe to press at any time, since every merge is
a union and it can only add. **Sync now** and **Re-check** sit beside it.

## Offline

The coach is self-contained — solving, hints, the step-by-step walkthrough,
stats, and the per-move proofs are all client-side JavaScript over
`localStorage` — so the only thing that ever needed the network was fetching the
page. **`sw.js`** caches the shell (`index.html`, the manifest, the icons, the
win sound), which is enough to launch and play with no connection at all: cold
start on a plane, solve, take hints, run the walkthrough, browse stats, open any
move's proof.

Two things still need the network, and both already fail soft: `/api/games`
sync (Settings reports it plainly) and the screenshot import. Neither is cached
— the worker never touches `/api/`, so game data is never served from a stale
copy.

## Staying on the current version

The service worker fetches `index.html` **network-first**, and `must-revalidate`
on the server means a reload always lands on the newest deploy — the cached copy
is strictly the offline fallback, never something you can get stuck on while
online. (The worker asks for the page `no-store` so it can't be handed the
browser's own cached copy either.) The gap that leaves is a tab — or an
installed app on a phone — that simply never reloads, and so keeps running the
build it opened with while the website has moved on.

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

`GET /api/nyt-sudoku?difficulty=easy|medium|hard`

```jsonc
// response
{
  "difficulty": "hard",
  "date": "2026-08-14",                        // NYT's print date, when the page carries one
  "puzzle": "003000100900400 ...",             // 81 chars, 0 = empty cell
  "grid": [[0,0,3, ...], ... 9 rows ...]
}
```

`GET /api/nyt-sudoku?difficulty=all` — what the **Today's NYT** tab asks for.

```jsonc
// response
{
  "date": "2026-08-14",
  "puzzles": {                                 // same shape as above, per difficulty
    "easy":   { "difficulty": "easy",   "date": "...", "puzzle": "...", "grid": [...] },
    "medium": { ... },
    "hard":   { ... }
  },
  "missing": []                                // difficulties that couldn't be read
}
```

One NYT page normally embeds all three difficulties, so `all` usually costs a
**single** upstream fetch; any difficulty that page doesn't carry is fetched
from its own page concurrently. A partial result is still a `200` — two puzzles
beat none — with the shortfall named in `missing`. It only fails outright when
none of the three could be read.

Errors come back as `{ "error": "<message>", "reason": "<code>" }` with a
4xx/5xx status. `reason` distinguishes the failures that need different
responses from the caller:

| `reason` | Status | Meaning |
| --- | --- | --- |
| `bad-request` | 400 | `difficulty` wasn't one of the three |
| `blocked` | 502 | NYT refused this server (403/401) — usually the deployment's IP |
| `upstream` | 502 | NYT returned some other non-2xx |
| `network` | 502 | NYT couldn't be reached |
| `timeout` | 504 | NYT didn't respond within 10s |
| `markup-changed` | 502 | The page loaded but the puzzle wasn't in it — needs a code fix |
| `malformed` | 502 | The puzzle data wasn't 81 cells of 0-9 |

Successful responses are edge-cached (`s-maxage=1800`) since the puzzle changes
once a day; failures are `no-store`.
