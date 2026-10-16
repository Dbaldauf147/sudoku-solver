// The build step for a project that doesn't build.
//
// Nothing here bundles or transpiles: index.html ships exactly as it is on disk. What this does is
// refuse to ship a broken one. The whole app is a single 480 KB inline <script>, so a stray bracket
// is a blank page for everyone until someone notices — and there is no bundler, no type checker and
// no test runner standing between an edit and production. Vercel runs this as the build command, so
// a syntax error fails the deploy instead of reaching the browser.
//
// It also checks the two things this repo has silently got wrong before, both of which fail late and
// quietly rather than loudly and early:
//
//   * an api/ route added without a `functions` entry in vercel.json, which then runs on the default
//     timeout and dies mid-request on the slow ones (image import, the digest);
//   * a file listed in the service worker's SHELL_FILES that isn't on disk, which the worker itself
//     swallows by design ("one miss shouldn't fail the whole install"), leaving a cold offline launch
//     missing an icon or the win sound with nothing said anywhere.
//
// Run it directly with `npm run build` (or `npm test`, which is the same checks under the name you'd
// reach for locally).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const fail = (where, detail) => problems.push({ where, detail });

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Compile `source` without running it, and return the syntax error if it has one.
 *
 * Goes through `node --check` on stdin rather than the file, because that's the only way to say
 * which grammar to use: api/ and lib/ are ES modules while package.json has no `"type": "module"`
 * (Vercel detects the syntax per file), so checking those paths directly would reject every
 * `import` as a syntax error.
 *
 * `kind` is "module" for those, and "commonjs" for anything the browser loads as a classic script —
 * index.html's inline blocks and sw.js. Node has no "script" grammar; commonjs is the closest one,
 * and unlike "module" it allows sloppy mode, which a classic script is entitled to use.
 */
function syntaxError(source, kind) {
  try {
    execFileSync(process.execPath, [`--input-type=${kind}`, "--check"], {
      input: source, stdio: ["pipe", "pipe", "pipe"],
    });
    return null;
  } catch (err) {
    // Node prints the offending line, a caret, the SyntaxError — and then its own stack, which is
    // all frames inside node:internal and tells you nothing about your file. Keep the first half:
    // in a Vercel build log the useful part should not be below the fold.
    const out = String(err.stderr || err.message).trim().split("\n");
    const stack = out.findIndex((l) => /^\s*at /.test(l));
    return (stack === -1 ? out : out.slice(0, stack)).join("\n").trim();
  }
}

// ---- index.html: every inline script block has to parse ----
const html = read("index.html");
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!blocks.length) fail("index.html", "no inline <script> blocks found — has the page been gutted?");
blocks.forEach((m, i) => {
  // The line the block opens on, so a reported error can be found in the file rather than in an
  // extract of it. `--check` numbers from the start of what it was handed, hence the offset.
  const line = html.slice(0, m.index).split("\n").length;
  const err = syntaxError(m[1], "commonjs");
  if (err) fail(`index.html (inline script #${i + 1}, opens at line ${line})`, err);
});

// ---- api/ and lib/: every module has to parse ----
for (const dir of ["api", "lib"]) {
  if (!existsSync(join(ROOT, dir))) continue;
  for (const name of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".js"))) {
    const err = syntaxError(read(join(dir, name)), "module");
    if (err) fail(`${dir}/${name}`, err);
  }
}

// ---- sw.js and the plain-JS files it ships ----
{
  const err = syntaxError(read("sw.js"), "commonjs");
  if (err) fail("sw.js", err);
}

// ---- the JSON that Vercel and the browser parse for themselves ----
const json = {};
for (const name of ["vercel.json", "package.json", "manifest.webmanifest"]) {
  try { json[name] = JSON.parse(read(name)); }
  catch (err) { fail(name, `not valid JSON — ${err.message}`); }
}

// ---- every api/ route needs a maxDuration, or it silently gets the default ----
if (json["vercel.json"]) {
  const globs = Object.keys(json["vercel.json"].functions || {});
  // Only the two glob shapes this file actually uses ("api/*.js" and a literal path). A general
  // matcher would be more code than the thing it guards.
  const covered = (path) => globs.some((g) => g === path || (g.endsWith("/*.js") && path.startsWith(g.slice(0, -5) + "/")));
  for (const name of readdirSync(join(ROOT, "api")).filter((f) => f.endsWith(".js"))) {
    if (!covered(`api/${name}`)) {
      fail("vercel.json", `api/${name} has no "functions" entry, so it would deploy on Vercel's default timeout. Add one with the duration it needs.`);
    }
  }
}

// ---- the digest's cron hour has to match the one api/digest.js quotes to the app ----
// Settings tells you when the weekly mail will land, and it works that out from CRON_UTC_HOUR in
// api/digest.js — while the schedule in vercel.json is what actually decides. Nothing at runtime
// can see the two disagree, so the panel would just state the wrong time, confidently, until
// somebody compared it against an inbox. `CRON_UTC_HOUR = null` means the cron runs hourly, which
// is the one arrangement where every chosen time is honoured exactly.
if (json["vercel.json"]) {
  const cron = (json["vercel.json"].crons || []).find((c) => String(c.path).startsWith("/api/digest"));
  const declared = read("api/digest.js").match(/const CRON_UTC_HOUR = (\d+|null);/);
  if (!cron) fail("vercel.json", "no cron for /api/digest, so the weekly email would never be sent.");
  else if (!declared) fail("api/digest.js", "couldn't find CRON_UTC_HOUR — this check needs updating alongside it.");
  else {
    const [minute, hour, ...rest] = String(cron.schedule).trim().split(/\s+/);
    const want = declared[1] === "null" ? "*" : declared[1];
    if (hour !== want) {
      fail("vercel.json", `the /api/digest cron runs at hour ${hour}, but api/digest.js declares CRON_UTC_HOUR = ${declared[1]}, which is the hour Settings tells you to expect the mail at. Change both, or set CRON_UTC_HOUR = null for an hourly cron.`);
    }
    if (rest.join(" ") !== "* * *") {
      fail("vercel.json", `the /api/digest cron is "${cron.schedule}". The schedule picker assumes it runs at least daily; anything narrower strands every subscriber whose chosen day the cron never falls on.`);
    }
    if (minute !== "0") {
      fail("vercel.json", `the /api/digest cron starts at minute ${minute}. Keep it at 0 — Settings quotes the hour on its own.`);
    }
  }
}

// ---- the service worker's shell has to exist, since the worker itself won't say so ----
{
  const sw = read("sw.js");
  const list = sw.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
  if (!list) fail("sw.js", "couldn't find SHELL_FILES — this check needs updating alongside it.");
  else {
    for (const [, file] of list[1].matchAll(/"\.\/([^"]+)"/g)) {
      if (!existsSync(join(ROOT, file))) fail("sw.js", `SHELL_FILES lists ./${file}, which isn't in the repo — a cold offline launch would be missing it.`);
    }
  }
}

// ---- report ----
if (problems.length) {
  console.error(`\ncheck: ${problems.length} problem${problems.length === 1 ? "" : "s"} — not shipping this.\n`);
  for (const { where, detail } of problems) console.error(`  ${where}\n    ${detail.replace(/\n/g, "\n    ")}\n`);
  process.exit(1);
}
console.log(`check: ok — ${blocks.length} inline script block${blocks.length === 1 ? "" : "s"}, every api/ route has a timeout, the offline shell is complete.`);
