# Sudoku Coach — working notes

## Git workflow

**Every requested change ships as its own PR.** For each user request that produces code changes:

1. Create a fresh feature branch off the latest `main`. Use `claude/<short-kebab-slug>` for the name — pick a slug that describes the change (e.g. `claude/finish-rate-chart`, `claude/nyt-archive-retry`). Note the default branch here is `main`, not `master`.
2. Commit on that branch and push it with `git push -u origin <branch>`.
3. Open the PR. Prefer the GitHub API (`mcp__github__create_pull_request`) when it's available; if it fails, fall back to printing the compare URL: `https://github.com/Dbaldauf147/sudoku-solver/pull/new/<branch>`.
4. **Merge it yourself** (`mcp__github__merge_pull_request`) once the work is verified — the user asked for this rather than being handed a link each time. Report the merge commit instead. Verification doesn't get lighter for being faster: see below for what it means here. If CI is red, the branch conflicts, or the change turns out riskier than it looked, fix that first rather than merging and explaining afterwards. Still stop and ask on anything destructive or genuinely ambiguous.
5. Don't push directly to `main`. Everything lands through a PR.

Branches stay one-PR-per-change so each fix can be reviewed and merged independently — don't pile unrelated changes onto a previous branch.

## Verifying before you merge

There is no test framework and no bundler: the app is one 480 KB inline `<script>` in `index.html`, so nothing stands between an edit and production except this. All three steps, every time.

1. **`npm run build`** (same as `npm test`) — `scripts/check.mjs`. Parses every inline script block, every `api/` and `lib/` module and `sw.js`; checks `vercel.json`, `package.json` and the manifest are valid JSON; and checks the two things this repo has silently got wrong before — an `api/` route with no `functions` entry (so it deploys on the default timeout and dies mid-request), and a file in the service worker's `SHELL_FILES` that isn't on disk (the worker swallows that by design, leaving a cold offline launch quietly broken). Vercel runs this as the build command, so a failure here fails the deploy.
2. **Check the actual behaviour.** Syntax passing is not the change working. Chromium and Playwright are available: serve the repo statically, drive the real page, and assert on what you changed — seed `localStorage` for anything that reads history, and call into the page's own top-level functions (`writeGrid`, `applyDigit`, `select`, `renderStats`) rather than trying to click through the custom keypad. Watch for `pageerror` while you do; the app catches a lot internally and a broken panel can look merely empty.
3. **Open the Vercel preview on the PR** and confirm the page actually loads there. The preview is the only place the real `vercel.json` — build command, function timeouts, the CSP — is exercised. A header change that breaks the app breaks it *only* here, never locally.

## Deploys

Vercel builds `main` on every merge and ships the static files, the `api/` functions and the crons in `vercel.json`. Nothing else needs releasing out of band: the data store is Upstash Redis reached over REST at runtime, so there are no rules, schema or migrations to push. If that ever changes, hang the release off a `prebuild` script that runs only when `VERCEL_ENV === "production"` and never fails the build — log loudly and carry on, because shipping with a stale side-artefact beats not shipping at all.

The Content-Security-Policy in `vercel.json` allows `'unsafe-inline'` for scripts and styles, because the entire app *is* inline. It is not protecting against XSS in our own code — it's there so nothing can be loaded from, or exfiltrated to, an origin that isn't ours, and so the page can't be framed. Keep `connect-src 'self'`: every fetch the app makes is same-origin `/api/*`. Adding a third-party script, font or endpoint means widening the policy deliberately, not discovering later that it was blocked.
