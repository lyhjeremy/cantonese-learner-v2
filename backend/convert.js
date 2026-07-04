// convert.js — the core new subsystem: formal written Chinese -> spoken
// (HK TV-news-anchor) Cantonese, via Claude Haiku. Called ONCE per article per
// day, server-side, cached. Never from the browser.

import { chunkTextForLearning } from "./chunk.js";

// Opus 4.8 — Anthropic's most capable model, for the highest-quality rewrite.
// (Cost is a few cents/day at 5 articles; the owner sets a monthly cap.)
export const CONVERT_MODEL = "claude-opus-4-8";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Split a body into paragraphs, chunk each into learning units, and keep the
// paragraph index so the reader can show whole-paragraph context.
export function paragraphsToUnits(body) {
  const paras = String(body || "")
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const source = paras.length ? paras : [String(body || "").trim()].filter(Boolean);
  const units = [];
  source.forEach((para, pid) => {
    for (const u of chunkTextForLearning(para)) {
      units.push({ formal: u.text, paragraph_id: pid });
    }
  });
  return units;
}

const SYSTEM_PROMPT = `You rewrite formal written Chinese finance news into spoken Hong Kong TV-news-anchor Cantonese, and romanise it in jyutping.

Register: exactly how a Hong Kong TV news anchor SPEAKS a bulletin aloud — natural spoken Cantonese with spoken words/particles where an anchor would use them (係, 嘅, 咗, 呢個, 而家, 話…), but still polished. NOT stiff read-off-the-page written Chinese, and NOT street slang.

Rules:
- Keep numbers, company names, financial terms and meaning EXACTLY.
- Output one colloquial sentence per formal sentence, in the same order — strict 1:1 alignment.
- jyutping is an array with ONE entry per character of the colloquial sentence, in order. For non-Chinese characters (punctuation, digits, spaces, Latin letters) use an empty string "".
- Output STRICT JSON only. No prose, no markdown fences.

Examples:
Formal: 該公司宣布季度收益增長15%
Anchor Cantonese: 呢間公司公布季度收益升咗15%
Formal: 市場分析人士指出該趨勢預示著潛在的經濟風險
Anchor Cantonese: 市場分析員話呢個趨勢可能反映經濟有潛在風險`;

// Defensive JSON extraction: models sometimes wrap output in ```json fences.
export function parseStrictJson(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

// Translate an array of formal sentences to spoken Cantonese (colloquial text
// only — jyutping is computed locally by the build). Returns an aligned array of
// strings, or null on any failure / misalignment so the caller can fall back to
// the rule-based converter. Used by the keyless build when an ANTHROPIC_API_KEY
// is present (opt-in higher-quality rewrite). No temperature/top_p — those are
// rejected on Opus 4.8.
export async function translateColloquial(formals, apiKey, opts = {}, fetchImpl = fetch) {
  if (!apiKey || !formals || !formals.length) return null;
  const list = formals.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const user = `Rewrite each of the following ${formals.length} formal Chinese sentences into HK news-anchor spoken Cantonese.
Return STRICT JSON of exactly this shape: {"colloquial":["…","…"]}
The array MUST have exactly ${formals.length} items, in the same order as the input. Keep numbers, company names, and financial/technical terms intact, and preserve meaning exactly.

Formal sentences:
${list}`;

  const requestBody = {
    model: opts.model || CONVERT_MODEL,
    max_tokens: opts.maxTokens || 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: user }],
  };

  try {
    const res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) throw new Error(`Anthropic responded ${res.status}`);
    const payload = await res.json();
    const text = (payload.content || []).map((b) => b.text || "").join("");
    const parsed = parseStrictJson(text);
    const arr = parsed && parsed.colloquial;
    if (Array.isArray(arr) && arr.length === formals.length) {
      return arr.map((x) => String(x || "").trim());
    }
    return null;
  } catch {
    return null;
  }
}
