import Anthropic from "@anthropic-ai/sdk";

// Vercel serverless function: takes a digest of the player's own solve statistics
// and returns coaching — what they're good at, what to work on, and what to do
// next session.
//
// Request:  POST { digest: {...} }        // built client-side from local stats
// Response: 200 { coaching: {...} }  |  4xx/5xx { error: string }
//
// The digest is aggregate only — counts, medians, technique names. No move logs,
// no puzzle grids, nothing identifying. The front end shows the player exactly
// what it sends before it sends it.
//
// Deliberately uses only `model` / `max_tokens` / `system` / `messages` plus the
// pass-through `output_config`, and parses JSON out of the text response rather
// than using structured outputs: this repo pins an older SDK for the screenshot
// reader, and a coaching feature isn't a reason to move that dependency under it.

const SYSTEM_PROMPT = `You are a Sudoku coach. You are given a JSON digest of one player's solving statistics from an app that logs every move with the technique that justified it.

What the numbers mean:
- "typicalMs" is a median time between choices, so it isn't skewed by one long pause.
- A player's "target" is a whole-game goal; spread over the puzzle's empty cells it implies a per-move pace. "overTarget" covers only the moves that ran past that pace — that's where games are actually lost.
- "hints" counts the times the player asked for help and this technique was the answer. "needsHelp" additionally includes the easier step that was available when they made a mistake.
- Absent data means absent, not zero: say so rather than inferring.

Coach on the evidence in front of you. Name the specific technique and the number you're reading, and give advice the player can act on in their next game — a scanning habit, an order to work in, what to look for before reaching for a hint. Do not invent statistics that aren't in the digest, and do not pad: if the data only supports two observations, make two.

Respond with ONLY a JSON object, no prose or code fences, of this shape:
{
  "headline": "one short sentence — the single most useful thing you noticed",
  "assessment": "2-4 sentences on where this player currently stands",
  "strengths": ["what they're demonstrably doing well, each tied to a number"],
  "focus": [
    {
      "technique": "the exact technique name as it appears in the digest",
      "why": "what the data says about it",
      "drill": "a concrete thing to practise or a habit to change"
    }
  ],
  "habits": ["specific changes to how they play — pace, checking, hint use"],
  "nextSession": "one concrete goal for the next game"
}
Use at most 3 strengths, 3 focus entries, and 3 habits.`;

function extractCoaching(text) {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in model response");
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 3) : []);
  const coaching = {
    headline: str(parsed.headline),
    assessment: str(parsed.assessment),
    strengths: list(parsed.strengths),
    habits: list(parsed.habits),
    nextSession: str(parsed.nextSession),
    focus: (Array.isArray(parsed.focus) ? parsed.focus : [])
      .slice(0, 3)
      .map((f) => ({ technique: str(f && f.technique), why: str(f && f.why), drill: str(f && f.drill) }))
      .filter((f) => f.technique || f.why),
  };
  if (!coaching.headline && !coaching.assessment && !coaching.focus.length) {
    throw new Error("Model response had none of the expected fields");
  }
  return coaching;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Same diagnostic shape as the screenshot reader: names and lengths only,
    // never values, so "not attached to this deployment" and "pasted empty"
    // can be told apart without leaking the key.
    return res.status(500).json({
      error: "Server is missing ANTHROPIC_API_KEY",
      diagnostic: {
        defined: Object.prototype.hasOwnProperty.call(process.env, "ANTHROPIC_API_KEY"),
        length: (process.env.ANTHROPIC_API_KEY || "").length,
        anthropicVars: Object.keys(process.env).filter((k) => /ANTHROPIC/i.test(k)),
      },
    });
  }

  const { digest } = req.body || {};
  if (!digest || typeof digest !== "object") {
    return res.status(400).json({ error: "Request body must include a `digest` object" });
  }
  const body = JSON.stringify(digest);
  // The digest is aggregates; anything this size is a client bug, and it would
  // spend tokens for nothing.
  if (body.length > 120000) {
    return res.status(413).json({ error: "Stats digest is too large to coach on" });
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000,
      // Reading aggregates and naming what to work on doesn't need deep
      // reasoning, and this runs inside a serverless request the player is
      // waiting on — so keep the thinking short.
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Coach this player.\n\n${body}` }],
    });

    if (message.stop_reason === "refusal") {
      return res.status(502).json({ error: "The model declined to answer this request" });
    }

    const text = (message.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return res.status(200).json({ coaching: extractCoaching(text) });
  } catch (err) {
    const status = err?.status && err.status >= 400 ? err.status : 502;
    return res.status(status).json({ error: err?.message || "Failed to get coaching" });
  }
}
