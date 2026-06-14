import Anthropic from "@anthropic-ai/sdk";

// Vercel serverless function: accepts a Sudoku screenshot and returns the
// 9x9 grid that Claude Vision reads from it. Empty cells are returned as 0.
//
// Request:  POST { image: "<base64>", media_type: "image/png" }
// Response: 200 { grid: number[9][9] }  |  4xx/5xx { error: string }

const SYSTEM_PROMPT = `You are a precise Sudoku grid reader. You are given an image of a Sudoku puzzle.
Read the 9x9 grid from top-left to bottom-right. Use 0 for any empty cell.
Respond with ONLY a JSON object of the form {"grid": [[...9 numbers...], ... 9 rows ...]}.
Do not include any prose, markdown, or code fences.`;

function extractGrid(text) {
  // Strip code fences if the model added them, then parse the JSON.
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object found in model response");
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  const grid = parsed.grid;

  if (!Array.isArray(grid) || grid.length !== 9) {
    throw new Error("Model did not return a 9-row grid");
  }
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== 9) {
      throw new Error("Model returned a row that is not 9 cells");
    }
    for (let i = 0; i < 9; i++) {
      const n = Number(row[i]);
      if (!Number.isInteger(n) || n < 0 || n > 9) {
        throw new Error("Model returned a cell outside 0-9");
      }
      row[i] = n;
    }
  }
  return grid;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Diagnostic (names/length only, never values) to tell apart the common
    // causes: variable undefined (not attached to this deployment) vs. an
    // empty/mis-pasted value.
    return res.status(500).json({
      error: "Server is missing ANTHROPIC_API_KEY",
      diagnostic: {
        defined: Object.prototype.hasOwnProperty.call(
          process.env,
          "ANTHROPIC_API_KEY"
        ),
        length: (process.env.ANTHROPIC_API_KEY || "").length,
        anthropicVars: Object.keys(process.env).filter((k) =>
          /ANTHROPIC/i.test(k)
        ),
      },
    });
  }

  const { image, media_type = "image/png" } = req.body || {};
  if (!image || typeof image !== "string") {
    return res
      .status(400)
      .json({ error: "Request body must include a base64 `image` string" });
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type, data: image },
            },
            { type: "text", text: "Read this Sudoku grid." },
          ],
        },
      ],
    });

    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const grid = extractGrid(text);
    return res.status(200).json({ grid });
  } catch (err) {
    const status = err?.status && err.status >= 400 ? err.status : 502;
    return res
      .status(status)
      .json({ error: err?.message || "Failed to parse Sudoku image" });
  }
}
