// ghmodels.js — FREE keyless LLM rewrite via GitHub Models.
//
// Public-repo GitHub Actions workflows can call the GitHub Models inference
// endpoint (models.github.ai) with the workflow's own GITHUB_TOKEN — just
// `permissions: models: read`. No API key, no billing; the free tier's daily
// request quota comfortably covers ~12 articles × (rewrite + review) per day.
//
// This is the middle quality tier: far more natural than the rule-based
// converter (it restructures grammar, picks anchor vocabulary, adds the right
// particles), below the Anthropic path (which does semantic phrase pairs and a
// stronger verifier). Aligned pairs for tap-to-compare are computed locally
// with the LCS aligner, so the model only has to return plain sentences.
//
// Plain fetch, OpenAI-compatible chat/completions schema, defensive JSON
// parsing, and fail-soft null returns throughout (caller falls back to rules).

import { normalizeDigits } from "../frontend/numbers.js";

export const GH_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";
export const GH_MODEL = "openai/gpt-4o-mini"; // 150 free requests/day tier

const BATCH = 20;
const MAX_TOKENS = 3500;

const REWRITE_SYSTEM = `You rewrite formal written Chinese news into spoken Hong Kong TV-news-anchor Cantonese.

Register: exactly how a Hong Kong TV news anchor SPEAKS a bulletin aloud — natural spoken Cantonese in Traditional characters, with spoken vocabulary and particles where an anchor would use them (係, 嘅, 咗, 呢個, 而家, 話, 佢哋, 喺…), but polished and professional. NOT word-swapped written Chinese, NOT Mandarin phrasing, NOT street slang. Formal compounds an anchor keeps (不足, 不斷, 是否, 參與…) stay as they are — never mechanically change characters inside a compound (不足 must NEVER become 唔足).

Rules:
- Keep numbers (as digits), personal/company/place names, and technical terms EXACTLY as in the original.
- One colloquial sentence per input sentence, same order, same count.
- Respond with STRICT JSON only: {"sentences": ["…", "…"]} — no prose, no markdown fences.`;

const REVIEW_SYSTEM = `You are a native Hong Kong Cantonese reviewer. You are given written-Chinese news sentences and machine rewrites into spoken TV-anchor Cantonese. Return the FULL corrected list: for each item, if the rewrite is natural anchor Cantonese and preserves the meaning/numbers/names exactly, return it unchanged; otherwise return your corrected version (Traditional characters, anchor register). Fix especially: mangled compounds (唔足 for 不足, 其佢 for 其他), Mandarin-flavoured phrasing, wrong particles, and meaning drift.

Respond with STRICT JSON only: {"sentences": ["…", "…"]} — same count and order as the input pairs, no prose, no fences.`;

function parseStrictJson(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The free tier enforces small per-minute request caps, so ALL calls in the
// process are strictly serialised through this queue, and 429/5xx responses
// back off (honouring retry-after) before retrying.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function chat(system, user, { token, model, retries = 3, retryDelayMs = 15000 }, fetchImpl) {
  return enqueue(async () => {
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetchImpl(GH_MODELS_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            model: model || GH_MODEL,
            temperature: 0.3,
            max_tokens: MAX_TOKENS,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (res.status === 429 || res.status >= 500) {
          if (attempt === retries) {
            console.log(`  github-models: HTTP ${res.status} (retries exhausted)`);
            return null;
          }
          const retryAfter = Number(res.headers?.get?.("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : retryDelayMs * (attempt + 1);
          await sleep(Math.min(wait, 120000));
          continue;
        }
        if (!res.ok) {
          console.log(`  github-models: HTTP ${res.status}`);
          return null;
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content || "";
        return parseStrictJson(text);
      }
      return null;
    } catch {
      return null;
    }
  });
}

function batches(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Rewrite formal sentences into anchor Cantonese via GitHub Models, then run a
 * second review pass over the result. Returns an array of colloquial strings
 * aligned to `formals`, or null on any failure (caller falls back to rules).
 */
export async function ghConvertSentences(
  formals,
  { token, model, review = true, retries, retryDelayMs } = {},
  fetchImpl = fetch,
) {
  if (!token || !formals || !formals.length) return null;
  const out = [];
  for (const batch of batches(formals, BATCH)) {
    const list = batch.map((f, i) => `${i + 1}. ${f}`).join("\n");
    const parsed = await chat(
      REWRITE_SYSTEM,
      `Rewrite each of the following ${batch.length} sentences. The "sentences" array MUST have exactly ${batch.length} items, in order.\n\n${list}`,
      { token, model, retries, retryDelayMs },
      fetchImpl,
    );
    const arr = parsed && parsed.sentences;
    if (!Array.isArray(arr) || arr.length !== batch.length) return null;
    let rewritten = arr.map((s, i) => normalizeDigits(String(s || "").trim()) || batch[i]);

    if (review) {
      const pairsList = batch
        .map((f, i) => `${i + 1}.\nWRITTEN: ${f}\nCANTONESE: ${rewritten[i]}`)
        .join("\n\n");
      const reviewed = await chat(
        REVIEW_SYSTEM,
        `Review these ${batch.length} rewrites and return the full corrected list.\n\n${pairsList}`,
        { token, model, retries, retryDelayMs },
        fetchImpl,
      );
      const rArr = reviewed && reviewed.sentences;
      if (Array.isArray(rArr) && rArr.length === batch.length) {
        rewritten = rArr.map((s, i) => normalizeDigits(String(s || "").trim()) || rewritten[i]);
      }
      // Review failure is non-fatal — ship the unreviewed rewrites.
    }
    out.push(...rewritten);
  }
  return out;
}
