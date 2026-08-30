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
    L.push("YOUR AVERAGES");
    for (const v of a.averages) L.push(`  • ${v.difficulty} — ${fmtTime(v.avg)} avg over ${v.solves} solve${v.solves === 1 ? "" : "s"} · ${fmtTime(v.recent)} last ${v.recentN} · ${fmtTime(v.best)} best`);
    L.push("");
  }
  if (a.stale) L.push(`You haven't finished a puzzle in a couple of weeks — the comparison above is against older play.`);
  return L.join("\n");
}

function renderHTML(a) {
  const BAD = "#dc2626", OK = "#16a34a", MUTED = "#5b6472", LINE = "#e2e5ea";
  const card = (inner) => `<div style="border:1px solid ${LINE};border-radius:10px;padding:14px 16px;margin:0 0 14px">${inner}</div>`;
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
    body += card(`<div style="font-weight:800;font-size:15px">Your averages</div>` + a.averages.map((v) => `
      <div style="padding:8px 0;border-top:1px solid ${LINE}">
        <div style="font-weight:700">${esc(v.difficulty)}</div>
        <div style="color:${MUTED};font-size:14px;margin-top:2px"><b>${fmtTime(v.avg)}</b> avg over ${v.solves} solve${v.solves === 1 ? "" : "s"} · <b>${fmtTime(v.recent)}</b> last ${v.recentN} · <b>${fmtTime(v.best)}</b> best</div>
      </div>`).join("").replace(`border-top:1px solid ${LINE}`, "border-top:none"));
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
