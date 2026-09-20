// Regression digest — the analysis behind the "what's getting worse" email.
//
// The stats screen answers "how am I doing?" when you go and look. This answers the question you
// won't think to ask: which parts of your game have quietly slipped since last month. It's
// deliberately one-sided. Improvements get a single closing line; the body is the slippage,
// because that's the part you'd otherwise miss.
//
// Pure functions over the same game records the app stores, so the API route and any future
// caller share one definition of "slipping".

const MS_DAY = 24 * 60 * 60 * 1000;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtDt(ms) { return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : fmtTime(ms); }
const pct = (from, to) => (from ? ((to - from) / from) * 100 : 0);
// Findings are measured in different units — a solve time moves by a percentage, a stall rate by
// percentage points, accuracy by points in the other direction. `mag` is how the change is written
// down; `severity` is the one comparable number that orders the list. Percentage points of a rate
// hit harder than the same count of percent, hence the weighting.
const asPct = (change) => ({ mag: `${change > 0 ? "+" : "\u2212"}${Math.abs(Math.round(change))}%`, severity: Math.abs(change) });
const asPoints = (change) => ({ mag: `${change > 0 ? "+" : "\u2212"}${Math.abs(Math.round(change))} pts`, severity: Math.abs(change) * 3 });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

// ---- palette ----
// The digest is read on a white background wherever it lands, so these are the app's light-theme
// values, nudged only where a colour that reads fine on the app's grey panel would be too pale on
// white. Everything is an opaque hex: mail clients are least surprising with those.
const BAD = "#dc2626", OK = "#16a34a", WARN = "#b45309", MUTED = "#5b6472",
  LINE = "#e2e5ea", TEXT = "#1d2330", CARD = "#ffffff", THICK = "#9aa3b2";
const CHART_COLORS = { Easy: "#22c55e", Medium: "#f59e0b", Hard: "#ef4444" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Deliberately UTC and deliberately not toLocaleDateString: this runs on a Vercel function, where
// the locale is whatever the runtime feels like and the clock is UTC either way. A fixed format is
// at least the same date for every subscriber, and an axis label is not worth an ICU dependency.
const fmtDay = (ms) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };

// Compares the first half of a run of times against the second — the same read the Stats screen
// puts beside each chart. Lower is faster, so a negative change is the good direction.
function trendOf(vals) {
  if (vals.length < 2) return null;
  const half = Math.max(1, Math.floor(vals.length / 2));
  const early = mean(vals.slice(0, half)), late = mean(vals.slice(-half));
  if (!early) return null;
  const p = Math.round(((late - early) / early) * 100);
  return { pct: p, dir: p <= -5 ? "down" : p >= 5 ? "up" : "flat" };
}

// Thresholds. A digest that fires on every wobble stops being read, so each finding needs both a
// meaningful size and enough games on each side of the comparison to mean anything.
const CFG = {
  recentGames: 6,      // games per difficulty in the "now" window
  minPerSide: 3,       // …and the fewest that window can hold before a comparison is reported
  solveWorsePct: 8,    // % slower on solve time before it's worth telling you
  techMinMoves: 6,     // moves of one technique needed on each side
  techWorsePct: 20,    // % slower per move before a technique is called out
  errorWorse: 0.5,     // extra mistakes per game before it's flagged
  slowShareWorse: 5,   // extra percentage points of moves running slow
  slowFactor: 1.6,     // a move is "slow" past this multiple of that game's median pause
  clusterBins: 10,
  maxRows: 10,         // the longest list anyone reads before skimming
};

const chron = (games) => [...games].sort((a, b) => (a.finishedAt || a.startedAt || 0) - (b.finishedAt || b.startedAt || 0));
const movesOf = (g) => (g.moves || []).filter((m) => m && typeof m.dt === "number");

// How often moves ran away from the pace of their own game, and the tenth of the game where that
// happened most. Judged inside each game so a run of hard puzzles doesn't read as a slowdown.
function slowProfile(games) {
  const bins = Array.from({ length: CFG.clusterBins }, () => ({ n: 0, slow: 0 }));
  let n = 0, slow = 0;
  for (const g of games) {
    const ms = movesOf(g);
    if (ms.length < CFG.clusterBins) continue;
    const bar = median(ms.map((m) => m.dt)) * CFG.slowFactor;
    if (!bar) continue;
    ms.forEach((m, i) => {
      const b = Math.min(CFG.clusterBins - 1, Math.floor((i / ms.length) * CFG.clusterBins));
      bins[b].n++; n++;
      if (m.dt > bar) { bins[b].slow++; slow++; }
    });
  }
  if (!n) return null;
  const rates = bins.map((b, i) => ({ i, rate: b.n ? b.slow / b.n : 0, n: b.n }));
  const peak = rates.reduce((a, b) => (b.rate > a.rate ? b : a));
  const width = 100 / CFG.clusterBins;
  return { share: slow / n, moves: n, peak: { from: Math.round(peak.i * width), to: Math.round((peak.i + 1) * width), rate: peak.rate } };
}

// Median time per move for each technique across a set of games.
function techMedians(games) {
  const by = {};
  for (const g of games) for (const m of movesOf(g)) {
    if (!m.tech || m.tech === "Mistake") continue;
    (by[m.tech] ||= []).push(m.dt);
  }
  return by;
}

function accuracyOf(games) {
  const ms = games.flatMap((g) => g.moves || []);
  if (!ms.length) return null;
  return ms.filter((m) => m.correct).length / ms.length;
}
function errorsPerGame(games) {
  if (!games.length) return null;
  const total = games.reduce((n, g) => n + (typeof g.errors === "number" ? g.errors : (g.moves || []).filter((m) => !m.correct).length), 0);
  return total / games.length;
}

// Split a list into the recent window and everything before it, refusing the comparison unless
// both sides carry enough games to be worth reading.
function split(list, size = CFG.recentGames) {
  if (list.length < CFG.minPerSide * 2) return null;
  const take = Math.min(size, Math.floor(list.length / 2));
  return { prior: list.slice(0, list.length - take), recent: list.slice(-take) };
}

// Collapse the same technique flagged on several difficulties into one row. The row keeps the
// worst change (that's the one worth acting on) and names where it showed up.
function rollUp(rows) {
  const groups = new Map(), out = [];
  for (const r of rows) {
    if ((r.kind !== "tech" && r.kind !== "hints") || !r.tech) { out.push(r); continue; }
    const key = `${r.kind}:${r.tech}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [, rs] of groups) {
    if (rs.length === 1) { out.push(rs[0]); continue; }
    const worstFirst = [...rs].sort((a, b) => b.severity - a.severity);
    const top = worstFirst[0];
    const where = rs.map((r) => r.difficulty);
    const list = where.length === 2 ? where.join(" and ") : `${where.slice(0, -1).join(", ")} and ${where[where.length - 1]}`;
    // The group's own direction — this same roll-up runs over the improving list too, where
    // "slower on Easy, Medium and Hard" would be exactly backwards.
    const lead = top.kind === "hints"
      ? (top.change > 0 ? "More hints" : "Fewer hints")
      : (top.change > 0 ? "Slower" : "Faster");
    out.push({
      ...top,
      what: top.kind === "hints" ? `Hints on ${top.tech}` : top.tech,
      detail: `${lead} on ${list}. ${top.change > 0 ? "Worst" : "Biggest gain"} on ${top.difficulty}: ${top.detail}`,
      across: where,
    });
  }
  return out;
}

/**
 * Compare the recent stretch of play against everything before it.
 * @param {Array} games  game records as the app stores them
 * @returns {{worse: Array, better: Array, averages: Array, ...}}
 */
function analyze(games) {
  const all = chron((games || []).filter((g) => g && g.moves));
  const worse = [], better = [], averages = [];
  const diffs = ["Easy", "Medium", "Hard"];

  // Everything is compared inside one difficulty. Pooling them is the trap here: a fortnight of
  // Hard puzzles would make every technique look like it had slowed down, when all that changed
  // was what you chose to play.
  for (const d of diffs) {
    const solved = all.filter((g) => g.solved && g.difficulty === d);
    if (solved.length) {
      const times = solved.map((g) => g.totalMs);
      averages.push({
        difficulty: d, solves: solved.length, avg: mean(times), best: Math.min(...times),
        recent: mean(times.slice(-5)), recentN: Math.min(5, times.length),
        last: times[times.length - 1],
        trend: trendOf(times),
        // The chart's own window. A long history would make the columns too thin to read in a
        // mail client that can't scroll sideways, so only the newest games are plotted — the
        // figures beside the chart stay lifetime ones, and the caption says which window it is.
        points: solved.slice(-MAX_POINTS).map((g) => ({ v: g.totalMs, when: fmtDay(g.finishedAt || g.startedAt || 0) })),
      });
    }
    const played = all.filter((g) => g.difficulty === d);

    // --- solve time ---
    const s = split(solved);
    if (s) {
      const before = mean(s.prior.map((g) => g.totalMs)), now = mean(s.recent.map((g) => g.totalMs));
      const change = pct(before, now);
      const row = {
        kind: "solve", difficulty: d, before, now, change, ...asPct(change), n: s.recent.length, priorN: s.prior.length,
        what: `${d} solve time`,
        detail: `${fmtTime(now)} over your last ${s.recent.length}, against ${fmtTime(before)} across the ${s.prior.length} before.`,
      };
      if (change >= CFG.solveWorsePct) worse.push(row);
      else if (change <= -CFG.solveWorsePct) better.push(row);
    }

    // --- how often you stall, and where ---
    const sp = split(played.filter((g) => movesOf(g).length >= CFG.clusterBins));
    if (sp) {
      const before = slowProfile(sp.prior), now = slowProfile(sp.recent);
      if (before && now) {
        const change = (now.share - before.share) * 100;
        const row = {
          kind: "stall", difficulty: d, before: before.share, now: now.share, change, ...asPoints(change), n: sp.recent.length,
          what: `${d} stalls`,
          detail: `${Math.round(now.share * 100)}% of your moves now run slow, against ${Math.round(before.share * 100)}% before — worst ${now.peak.from}–${now.peak.to}% into the puzzle, where ${Math.round(now.peak.rate * 100)}% of moves drag.`,
        };
        if (change >= CFG.slowShareWorse) worse.push(row);
        else if (change <= -CFG.slowShareWorse) better.push(row);
      }
    }

    const sg = split(played, 10);
    if (!sg) continue;

    // --- per technique ---
    const tBefore = techMedians(sg.prior), tNow = techMedians(sg.recent);
    for (const tech of Object.keys(tNow)) {
      const b = tBefore[tech] || [], n = tNow[tech] || [];
      if (b.length < CFG.techMinMoves || n.length < CFG.techMinMoves) continue;
      const mb = median(b), mn = median(n), change = pct(mb, mn);
      const row = {
        kind: "tech", tech, difficulty: d, before: mb, now: mn, change, ...asPct(change), n: n.length,
        what: `${tech} on ${d}`,
        detail: `${fmtDt(mn)} per move now, against ${fmtDt(mb)} before — over ${n.length} recent placements.`,
      };
      if (change >= CFG.techWorsePct) worse.push(row);
      else if (change <= -CFG.techWorsePct) better.push(row);
    }

    // --- mistakes and accuracy ---
    const eb = errorsPerGame(sg.prior), en = errorsPerGame(sg.recent);
    if (eb != null && en != null && en - eb >= CFG.errorWorse) {
      worse.push({ kind: "errors", difficulty: d, before: eb, now: en, change: pct(eb, en), ...asPct(pct(eb, en)), n: sg.recent.length,
        what: `Mistakes per ${d} game`,
        detail: `${en.toFixed(1)} per game over your last ${sg.recent.length}, against ${eb.toFixed(1)} before.` });
    } else if (eb != null && en != null && eb - en >= CFG.errorWorse) {
      better.push({ kind: "errors", difficulty: d, before: eb, now: en, change: pct(eb, en), ...asPct(pct(eb, en)), n: sg.recent.length,
        what: `Mistakes per ${d} game`,
        detail: `down to ${en.toFixed(1)} per game from ${eb.toFixed(1)}.` });
    }
    const ab = accuracyOf(sg.prior), an = accuracyOf(sg.recent);
    if (ab != null && an != null && (ab - an) * 100 >= 3) {
      worse.push({ kind: "accuracy", difficulty: d, before: ab, now: an, change: -(ab - an) * 100, ...asPoints(-(ab - an) * 100), n: sg.recent.length,
        what: `${d} accuracy`,
        detail: `${Math.round(an * 100)}% over your last ${sg.recent.length} games, against ${Math.round(ab * 100)}% before.` });
    }

    // --- hints you needed ---
    const hints = (list) => {
      const by = {};
      for (const g of list) for (const [t, c] of Object.entries(g.hintsBy || {})) by[t] = (by[t] || 0) + c;
      return by;
    };
    const hb = hints(sg.prior), hn = hints(sg.recent);
    for (const t of Object.keys(hn)) {
      const perBefore = (hb[t] || 0) / sg.prior.length, perNow = hn[t] / sg.recent.length;
      if (hn[t] >= 3 && perNow - perBefore >= 0.4) {
        worse.push({ kind: "hints", tech: t, difficulty: d, before: perBefore, now: perNow, change: perNow - perBefore, ...asPct(pct(perBefore || perNow, perNow)), n: hn[t],
          what: `Hints on ${t} (${d})`,
          detail: `${hn[t]} across your last ${sg.recent.length} ${d} games (${perNow.toFixed(1)}/game), against ${perBefore.toFixed(1)}/game before.` });
      }
    }
  }

  // One technique slipping on all three difficulties is one thing you're doing, not three findings.
  // Rolled up before ranking so it competes as a single, correspondingly bigger item.
  const rolled = rollUp(worse), rolledBetter = rollUp(better);
  rolled.sort((a, b) => b.severity - a.severity);
  rolledBetter.sort((a, b) => b.severity - a.severity);
  // An email nobody finishes reading tells you nothing, so the tail is counted rather than listed.
  const worseTop = rolled.slice(0, CFG.maxRows), betterTop = rolledBetter.slice(0, 5);

  const last = all[all.length - 1];
  return {
    games: all.length,
    solved: all.filter((g) => g.solved).length,
    enough: diffs.some((d) => all.filter((g) => g.difficulty === d).length >= CFG.minPerSide * 2),
    since: all.length ? new Date(all[0].startedAt || 0).toISOString() : null,
    lastPlayed: last ? new Date(last.finishedAt || last.startedAt || 0).toISOString() : null,
    stale: last ? Date.now() - (last.finishedAt || last.startedAt || 0) > 14 * MS_DAY : false,
    worse: worseTop, better: betterTop,
    worseMore: Math.max(0, rolled.length - worseTop.length),
    betterMore: Math.max(0, rolledBetter.length - betterTop.length),
    averages,
  };
}

// ---- rendering ----

// ---- the per-difficulty solve-time chart ----
//
// The same chart the Stats screen draws, rebuilt for email. Mail clients throw <svg> away — Gmail
// strips it outright — so the picture is painted with table cells instead: one column per game,
// each column a stack of coloured blocks. Read a column downwards and you get empty space, the
// line, then the tinted area under it, with the gridlines and the average and best rules laid over
// the top. A background colour on a block is the one thing every mail client agrees on, so this
// renders wherever the rest of the email does.
const PLOT_H = 150;        // the plot's height in px; every y below lives in that space
const MAX_POINTS = 14;     // games per difficulty that get plotted, newest first
const TARGET_COLS = 28;    // columns to aim for — the gaps between games are interpolated up to it

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const chan = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// `t` of the way from `a` to `b`. Every translucent fill in the app's chart is pre-blended against
// the card here, because opacity is the sort of thing a mail client drops without saying so.
function mix(a, b, t) {
  const A = chan(a), B = chan(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
// A trailing average over the last `w` games — where you actually are now, without one bad night
// reading as a slump.
const rollingAvg = (vals, w) => vals.map((_, i) => mean(vals.slice(Math.max(0, i - w + 1), i + 1)));

// A block `h` px tall, filled or empty. The nbsp is what gives it a line box to be tall with, and
// line-height is what makes it that tall — Outlook ignores `height` on a div but honours this.
// There are a few hundred of these in a digest, so the run-length encoding below is what keeps the
// mail under the 102 KB Gmail clips at.
const block = (h, bg) => (h > 0 ? `<div style="line-height:${h}px${bg ? `;background:${bg}` : ""}">&nbsp;</div>` : "");
// Run-length encode a painted column into as few blocks as it takes. A column is an array of
// PLOT_H colours ("" for the card showing through), so this is what keeps the email small.
function column(px) {
  let out = "", run = px[0], len = 0;
  for (const c of px) { if (c === run) { len++; continue; } out += block(len, run); run = c; len = 1; }
  return out + block(len, run);
}
// Lay a horizontal rule `h` px thick across one column, centred on `at`, clipped to the plot.
const rule = (px, at, h, color) => seg(px, at, at, h, color);
// One column's worth of a sloping line: the band it sweeps between the two heights it enters and
// leaves at. Without this a line is a row of floating dashes — each column would paint only its own
// height, and every step between neighbours would be a gap.
function seg(px, a, b, h, color) {
  const top = Math.round(Math.min(a, b) - (h - 1) / 2), bottom = Math.round(Math.max(a, b) + (h - 1) / 2);
  for (let p = top; p <= bottom; p++) if (p >= 0 && p < PLOT_H) px[p] = color;
}
// Text down the side of the plot, at the height of the line it names. Labels are 12px tall and
// never overlap: one that would collide with the label above is pushed below it.
function sideLabels(items) {
  let out = "", cursor = 0;
  for (const it of [...items].sort((a, b) => a.y - b.y)) {
    const top = clamp(Math.round(it.y - 6), cursor, Math.max(cursor, PLOT_H - 12));
    out += block(top - cursor, "");
    out += `<div style="line-height:12px;font-size:10px;font-weight:${it.bold ? 700 : 400};color:${it.color};text-align:${it.align};white-space:nowrap">${esc(it.text)}</div>`;
    cursor = top + 12;
  }
  return out;
}

function solveChart(v) {
  const pts = v.points || [], n = pts.length;
  if (n < 2) return "";                       // one game is a number, not a chart
  const color = CHART_COLORS[v.difficulty] || "#2563eb";
  const tint = mix(color, CARD, 0.86);        // the area under the line
  const rise = mix(color, CARD, 0.45);        // the near-vertical climb between two games, softened
  const roll = mix(THICK, CARD, 0.3);         // the trailing average, kept quieter than the line
  const vals = pts.map((p) => p.v);

  // A padded band around the games shown rather than a zero baseline: solve times cluster, and
  // anchoring at zero flattens the very movement this chart exists to show. The band is stretched
  // to hold the average and best rules, which are lifetime figures and can fall outside the window.
  const lo0 = Math.min(...vals, v.best), hi0 = Math.max(...vals, v.avg);
  const span = hi0 - lo0 || Math.max(1000, v.avg * 0.2);
  const lo = Math.max(0, lo0 - span * 0.2), hi = hi0 + span * 0.2;
  const y = (val) => clamp(Math.round((1 - (val - lo) / (hi - lo)) * PLOT_H), 0, PLOT_H - 1);

  const ticks = [3, 2, 1, 0].map((i) => lo + ((hi - lo) * i) / 3);   // top → bottom
  const avgY = y(v.avg), bestY = y(v.best);
  // Dropped when best and average sit on top of each other, where the two labels would collide.
  const showBest = Math.abs(bestY - avgY) > 12;
  const trail = rollingAvg(vals, Math.max(2, Math.min(5, Math.ceil(n / 4))));

  // Columns between the games, so the top edge reads as a line rather than a staircase. Each real
  // game keeps a thicker cap — that's what the dots on the app's chart come to here. At least two
  // columns per game, always: with one, the climb between two games fills its whole column and the
  // chart reads as bars. That lower bound is what MAX_POINTS is set from.
  const k = clamp(Math.floor(TARGET_COLS / (n - 1)), 2, 8);
  const cols = (n - 1) * k + 1;
  // Reads a series at a fractional column — the half-steps either side of a column are where its
  // line segment enters and leaves, which is what joins one column to the next.
  const at = (arr, j) => {
    const i = clamp(j / k, 0, n - 1), i0 = Math.floor(i);
    return i0 >= n - 1 ? arr[n - 1] : arr[i0] + (arr[i0 + 1] - arr[i0]) * (i - i0);
  };
  const ys = (arr, j) => [y(at(arr, j - 0.5)), y(at(arr, j)), y(at(arr, j + 0.5))];

  let plot = "";
  for (let j = 0; j < cols; j++) {
    const px = new Array(PLOT_H).fill("");
    const [vl, vc, vr] = ys(vals, j);
    for (let p = vc; p < PLOT_H; p++) px[p] = tint;                        // the area under the line
    // Gridlines only where the card still shows through. One drawn under the area would either
    // vanish into it or have to be blended against it, and blending splits the fill into three
    // blocks per line — the same picture at several times the size, on an email that gets clipped
    // past 102 KB.
    for (const t of ticks) { const g = y(t); if (!px[g]) px[g] = LINE; }
    if (n >= 4) { const [tl, , tr] = ys(trail, j); seg(px, tl, tr, 2, roll); }   // trailing average
    seg(px, vl, vr, 2, rise);                                              // the climb into and out of this column…
    rule(px, vc, 3, color);                                                // …the line across it…
    if (j % k === 0) rule(px, vc, 7, color);                               // …and a dot on each game
    if (showBest) rule(px, bestY, 2, OK);
    rule(px, avgY, 2, WARN);
    plot += `<td style="width:${(100 / cols).toFixed(3)}%">${column(px)}</td>`;
  }

  const axis = sideLabels(ticks.map((t) => ({ y: y(t), text: fmtTime(t), color: MUTED, align: "right" })));
  const rules = sideLabels([
    { y: avgY, text: `avg ${fmtTime(v.avg)}`, color: WARN, align: "left", bold: true },
    ...(showBest ? [{ y: bestY, text: `best ${fmtTime(v.best)}`, color: OK, align: "left", bold: true }] : []),
  ]);
  const date = (t, align) => `<td align="${align}" style="padding:4px 0 0;font-size:10px;color:${MUTED}">${esc(t)}</td>`;
  const xaxis = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;table-layout:fixed;width:100%"><tr>`
    + date(pts[0].when, "left") + date(n > 2 ? pts[n >> 1].when : "", "center") + date(pts[n - 1].when, "right")
    + `</tr></table>`;
  const caption = v.solves > n
    ? `last ${n} of ${v.solves} solved games, oldest → newest`
    : `${n} solved games, oldest → newest`;

  // aria-hidden because a screen reader has nothing to gain from a few hundred empty blocks, and
  // loses nothing by skipping them: the average, the best and the dates are all written out again
  // in the card's own text and in the plain-text part.
  return `<table role="presentation" aria-hidden="true" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;table-layout:fixed;width:100%;margin:10px 0 0">
      <tr>
        <td width="46" valign="top" style="width:46px;padding:0 6px 0 0;font-size:1px;line-height:1px">${axis}</td>
        <td valign="top" style="padding:0">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;table-layout:fixed;width:100%;font-size:1px;line-height:1px"><tr>${plot}</tr></table>
        </td>
        <td width="60" valign="top" style="width:60px;padding:0 0 0 5px;font-size:1px;line-height:1px">${rules}</td>
      </tr>
      <tr><td></td><td style="padding:0">${xaxis}</td><td></td></tr>
    </table>
    <div style="margin:2px 0 9px;text-align:center;font-size:11px;color:${MUTED}">${esc(caption)}</div>`;
}

// "▼ 6% faster" — the read the Stats screen puts beside the same chart.
function trendBadge(t) {
  if (!t) return "";
  if (t.dir === "down") return `<span style="color:${OK};font-weight:700">▼ ${Math.abs(t.pct)}% faster</span>`;
  if (t.dir === "up") return `<span style="color:${BAD};font-weight:700">▲ ${t.pct}% slower</span>`;
  return `<span style="color:${MUTED}">steady</span>`;
}
const trendWords = (t) => (!t ? "" : t.dir === "down" ? `${Math.abs(t.pct)}% faster` : t.dir === "up" ? `${t.pct}% slower` : "steady");

// The white is stated rather than left to the client: the chart's area fill is a pre-blended
// colour that assumes it, and a mail client in dark mode is much less likely to repaint a
// background it was given than one it wasn't.
const card = (inner) => `<div style="background:${CARD};border:1px solid ${LINE};border-radius:10px;padding:14px 16px;margin:0 0 14px">${inner}</div>`;

// One card per difficulty: the heading, the chart, and the four figures under it — the same three
// lines, in the same order, as the Stats screen's solve-time cards.
function timesCard(v) {
  const color = CHART_COLORS[v.difficulty] || "#2563eb";
  const badge = trendBadge(v.trend);
  const fig = (ms) => `<b style="color:${TEXT}">${fmtTime(ms)}</b>`;
  return card(`<div style="font-size:15px;color:${MUTED}">
      <b style="color:${color}">${esc(v.difficulty)}</b> · ${v.solves} solved${badge ? ` · ${badge}` : ""}
    </div>
    ${solveChart(v)}
    <div style="color:${MUTED};font-size:13px;line-height:1.5">
      ${fig(v.avg)} average · ${fig(v.recent)} over your last ${v.recentN} · ${fig(v.best)} best · ${fig(v.last)} most recent
    </div>`);
}

function headline(a) {
  if (!a.enough) return `Not enough games yet — play a few more and this will start comparing.`;
  if (!a.worse.length) return a.better.length
    ? `Nothing has slipped. ${a.better.length} thing${a.better.length === 1 ? " is" : "s are"} moving the right way.`
    : `Nothing has slipped, and nothing has moved much either. Steady.`;
  const top = a.worse[0];
  return `${a.worse.length} thing${a.worse.length === 1 ? "" : "s"} slipping — worst is ${top.what.toLowerCase()}.`;
}

function renderText(a) {
  const L = [];
  L.push(`Sudoku Coach — what's slipping`);
  L.push(headline(a));
  L.push("");
  if (a.worse.length) {
    L.push("SLOWING DOWN");
    for (const r of a.worse) L.push(`  • ${r.what} — ${r.mag}. ${r.detail}`);
    if (a.worseMore) L.push(`  … and ${a.worseMore} more, in the app under Stats → All games.`);
    L.push("");
  }
  if (a.better.length) {
    L.push("STILL IMPROVING");
    for (const r of a.better) L.push(`  • ${r.what} — ${r.mag}. ${r.detail}`);
    if (a.betterMore) L.push(`  … and ${a.betterMore} more.`);
    L.push("");
  }
  if (a.averages.length) {
    L.push("YOUR SOLVE TIMES");
    for (const v of a.averages) {
      const words = trendWords(v.trend);
      L.push(`  • ${v.difficulty} — ${v.solves} solved${words ? ` · ${words}` : ""}`);
      L.push(`      ${fmtTime(v.avg)} average · ${fmtTime(v.recent)} over your last ${v.recentN} · ${fmtTime(v.best)} best · ${fmtTime(v.last)} most recent`);
    }
    L.push("");
  }
  if (a.stale) L.push(`You haven't finished a puzzle in a couple of weeks — the comparison above is against older play.`);
  return L.join("\n");
}

function renderHTML(a) {
  const row = (r, bad) => `<div style="padding:9px 0;border-top:1px solid ${LINE}">
      <div style="font-weight:700">${esc(r.what)}
        <span style="color:${bad ? BAD : OK};font-weight:700">${bad ? "▲" : "▼"} ${esc(r.mag.replace(/^[+\u2212]/, ""))}</span>
      </div>
      <div style="color:${MUTED};font-size:14px;line-height:1.5;margin-top:2px">${esc(r.detail)}</div>
    </div>`;
  const strip = (rows, bad) => rows.map((r) => row(r, bad)).join("").replace(`border-top:1px solid ${LINE}`, "border-top:none");

  let body = "";
  if (a.worse.length) {
    body += card(`<div style="font-weight:800;font-size:15px;color:${BAD}">Slowing down</div>
      <div style="color:${MUTED};font-size:13px;margin:2px 0 4px">Your recent games against everything before them.</div>
      ${strip(a.worse, true)}
      ${a.worseMore ? `<div style="color:${MUTED};font-size:13px;padding-top:9px">…and ${a.worseMore} more — the full picture is in the app under Stats → All games.</div>` : ""}`);
  } else if (a.enough) {
    body += card(`<div style="font-weight:800;font-size:15px;color:${OK}">Nothing is slipping</div>
      <div style="color:${MUTED};font-size:14px;margin-top:4px">No difficulty, technique, or stall pattern has moved the wrong way since your earlier games.</div>`);
  } else {
    body += card(`<div style="font-weight:800;font-size:15px">Not enough games yet</div>
      <div style="color:${MUTED};font-size:14px;margin-top:4px">${a.games} recorded so far. A few more and this will start comparing your recent play against the rest.</div>`);
  }
  if (a.better.length) {
    body += card(`<div style="font-weight:800;font-size:15px;color:${OK}">Still improving</div>${strip(a.better, false)}`);
  }
  if (a.averages.length) {
    body += `<div style="font-weight:800;font-size:15px;margin:2px 0 9px">Your solve times</div>`
      + a.averages.map(timesCard).join("");
  }
  if (a.stale) {
    body += `<p style="color:${MUTED};font-size:13px">You haven't finished a puzzle in a couple of weeks, so the comparison above is against older play.</p>`;
  }
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:18px;color:#1d2330">
    <h1 style="font-size:19px;margin:0 0 2px">What's slipping in your Sudoku</h1>
    <p style="color:${MUTED};font-size:14px;margin:0 0 16px">${esc(headline(a))}</p>
    ${body}
    <p style="color:${MUTED};font-size:12px;border-top:1px solid ${LINE};padding-top:12px;margin-top:18px">
      Comparing your most recent games against everything before them, across ${a.games} recorded game${a.games === 1 ? "" : "s"}.
      Turn this off in the app under ⚙ → Settings → Weekly email digest.
    </p>
  </div>`;
}

function renderDigest(a) {
  const n = a.worse.length;
  const subject = !a.enough
    ? "Sudoku: not enough games to compare yet"
    : n
    ? `Sudoku: ${n} thing${n === 1 ? "" : "s"} slipping — ${a.worse[0].what.toLowerCase()}`
    : "Sudoku: nothing slipping this week";
  return { subject, html: renderHTML(a), text: renderText(a) };
}

export { analyze, renderDigest, renderHTML, renderText, headline, CFG, fmtTime, fmtDt };
