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
// Primary rewriter: GPT-4.1 (free "high" tier, ~50 requests/day) — the only
// free-tier model that genuinely RESTRUCTURES into spoken Cantonese rather
// than swapping characters. When its daily quota runs dry mid-build, each
// remaining batch falls back to GPT-4.1-mini (free "low" tier, ~150/day),
// which is nearly as deep; the review pass always runs on the mini so the
// primary's quota is spent on rewriting only.
export const GH_MODEL = "openai/gpt-4.1";
export const GH_FALLBACK_MODEL = "openai/gpt-4.1-mini";
export const GH_REVIEW_MODEL = "openai/gpt-4.1-mini";

const BATCH = 20;
const MAX_TOKENS = 3500;

const REWRITE_SYSTEM = `You rewrite formal written Chinese news into spoken Hong Kong TV-news-anchor Cantonese.

Register: exactly how a Hong Kong TV news anchor SPEAKS a bulletin aloud — natural spoken Cantonese in Traditional characters. That means genuinely spoken grammar and vocabulary throughout: 嘅 for 的, 喺 for 在, 同/同埋 for 與/及/和, 係 for 是, 咗 for perfective 了, 冇 for 沒有, 唔 for 不, 而家 for 現在, 話 for 表示/指出, 佢/佢哋 for 他/他們, 呢個/嗰個 for 這個/那個, 畀 for 給, restructured word order where an anchor would rephrase. Polished and professional — NOT street slang, but absolutely NOT word-swapped written Chinese either. If your output reads like the input with one or two characters changed, you have failed the task.

Formal compounds an anchor keeps (不足, 不斷, 是否, 不過, 參與…) stay as they are — never mechanically change characters inside a compound (不足 must NEVER become 唔足).

Examples of the required depth:
WRITTEN: 政府發言人表示，當局將於下月推出新措施，協助受影響的市民。
SPOKEN: 政府發言人話，當局下個月就會推出新措施，幫受影響嘅市民。
WRITTEN: 他指出，公司在過去一年錄得虧損，情況並不理想。
SPOKEN: 佢指出，公司喺過去一年錄得虧損，情況唔係咁理想。
WRITTEN: 行政長官今日與代表團會面，就雙方共同關注的議題交換意見。
SPOKEN: 行政長官今日同代表團會面，就雙方都關注嘅議題交換意見。

Rules:
- Keep numbers (as digits), personal/company/place names, and technical terms EXACTLY as in the original.
- One colloquial sentence per input sentence, same order, same count.
- Respond with STRICT JSON only: {"sentences": ["…", "…"]} — no prose, no markdown fences.`;

const REVIEW_SYSTEM = `You are a native Hong Kong Cantonese reviewer. You are given written-Chinese news sentences and machine rewrites into spoken TV-anchor Cantonese. Return the FULL corrected list: for each item, if the rewrite is natural anchor Cantonese and preserves the meaning/numbers/names exactly, return it unchanged; otherwise return your corrected version (Traditional characters, anchor register). Fix especially: mangled compounds (唔足 for 不足, 其佢 for 其他), Mandarin-flavoured phrasing, wrong particles, and meaning drift.

NEVER make a rewrite LESS colloquial: do not revert spoken forms back to written ones (同 must not become 與, 嘅 must not become 的, 咗 must not become 了, 話 must not become 表示). If a rewrite is correct spoken Cantonese, return it untouched.

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

// Circuit breaker: when a model's DAILY quota is exhausted, every call to it
// 429s until midnight UTC — retrying each one through the whole backoff
// ladder would stall the build for an hour. Once one call exhausts its
// retries (or the server asks for a minutes-long wait), stop calling THAT
// MODEL for the rest of the process. Quotas are per rate-limit tier, so the
// fallback model (a different tier) keeps working after the primary trips.
const quotaExhausted = new Set();

// The free tier enforces small per-minute request caps, so ALL calls in the
// process are strictly serialised through this queue, and 429/5xx responses
// back off (honouring retry-after) before retrying.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function chat(system, user, { token, model = GH_MODEL, retries = 3, retryDelayMs = 15000 }, fetchImpl) {
  return enqueue(async () => {
    if (quotaExhausted.has(model)) return null;
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
            model,
            temperature: 0.3,
            max_tokens: MAX_TOKENS,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers?.get?.("retry-after"));
          // A minutes-long retry-after on 429 means the DAILY quota is gone,
          // not a per-minute blip — give up on this model for the whole build.
          if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 300) {
            quotaExhausted.add(model);
            console.log(`  github-models: ${model} daily quota exhausted (retry-after ${retryAfter}s)`);
            return null;
          }
          if (attempt === retries) {
            console.log(`  github-models: ${model} HTTP ${res.status} (retries exhausted)`);
            if (res.status === 429) {
              quotaExhausted.add(model);
              console.log(`  github-models: treating ${model} quota as exhausted — no further calls to it this build`);
            }
            return null;
          }
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : retryDelayMs * (attempt + 1);
          await sleep(Math.min(wait, 120000));
          continue;
        }
        if (!res.ok) {
          console.log(`  github-models: ${model} HTTP ${res.status}`);
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
 * second review pass over the result. Each batch tries the primary model
 * first, then the fallback model (a separate free-tier daily quota), so a
 * mid-build quota exhaustion degrades quality one notch instead of dropping
 * whole articles to the rule-based converter. Returns an array of colloquial
 * strings aligned to `formals`, or null on any failure (caller falls back to
 * rules).
 */
export async function ghConvertSentences(
  formals,
  { token, model, fallbackModel, reviewModel, review = true, retries, retryDelayMs } = {},
  fetchImpl = fetch,
) {
  if (!token || !formals || !formals.length) return null;
  const rewriteModels = [...new Set([model || GH_MODEL, fallbackModel || GH_FALLBACK_MODEL])];
  const out = [];
  for (const batch of batches(formals, BATCH)) {
    const list = batch.map((f, i) => `${i + 1}. ${f}`).join("\n");
    let arr = null;
    for (const m of rewriteModels) {
      const parsed = await chat(
        REWRITE_SYSTEM,
        `Rewrite each of the following ${batch.length} sentences. The "sentences" array MUST have exactly ${batch.length} items, in order.\n\n${list}`,
        { token, model: m, retries, retryDelayMs },
        fetchImpl,
      );
      const got = parsed && parsed.sentences;
      if (Array.isArray(got) && got.length === batch.length) {
        arr = got;
        break;
      }
    }
    if (!arr) return null;
    let rewritten = arr.map((s, i) => normalizeDigits(String(s || "").trim()) || batch[i]);

    if (review) {
      const pairsList = batch
        .map((f, i) => `${i + 1}.\nWRITTEN: ${f}\nCANTONESE: ${rewritten[i]}`)
        .join("\n\n");
      const reviewed = await chat(
        REVIEW_SYSTEM,
        `Review these ${batch.length} rewrites and return the full corrected list.\n\n${pairsList}`,
        { token, model: reviewModel || GH_REVIEW_MODEL, retries, retryDelayMs },
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
