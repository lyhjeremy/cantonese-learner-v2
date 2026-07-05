// convert.js — formal written Chinese -> spoken (HK TV-news-anchor) Cantonese
// via the Anthropic SDK. Called once per article per day, server-side, in the
// GitHub Actions build. Never from the browser.
//
// V2 pipeline (when an ANTHROPIC_API_KEY is configured):
//   1. REWRITE  — Claude rewrites each formal sentence into natural anchor
//                 Cantonese AND emits aligned phrase pairs [{f, c}, ...] whose
//                 f-side concatenates exactly to the formal sentence and c-side
//                 to the colloquial one (drives the tap-to-compare UI).
//   2. VERIFY   — a second, independent Claude pass cross-checks every rewrite
//                 (natural spoken Cantonese? meaning/numbers preserved? no
//                 mangled particles like 唔足?) and repairs anything it flags.
//
// Structured outputs (output_config.format) guarantee schema-valid JSON, and
// pair alignment is re-validated in code — anything invalid fails soft (pairs
// dropped / whole article falls back to the rule-based converter).

import Anthropic from "@anthropic-ai/sdk";
import { chunkTextForLearning } from "./chunk.js";
import { normalizeDigits } from "../frontend/numbers.js";

// Opus 4.8 — the most capable Opus-tier model, for the highest-quality rewrite.
// (Cost is cents/day at ~12 articles × 2 passes; the owner sets a monthly cap.)
export const CONVERT_MODEL = "claude-opus-4-8";

const BATCH_SIZE = 30; // sentences per API call
const MAX_TOKENS = 16000;

export function makeClient(apiKey) {
  return new Anthropic({ apiKey });
}

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

// ── Schemas (structured outputs) ──────────────────────────────────────────────

const PAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["f", "c"],
  properties: { f: { type: "string" }, c: { type: "string" } },
};

const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sentences"],
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["colloquial", "pairs"],
        properties: {
          colloquial: { type: "string" },
          pairs: { type: "array", items: PAIR_SCHEMA },
        },
      },
    },
  },
};

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "fixed", "fixed_pairs"],
        properties: {
          ok: { type: "boolean" },
          fixed: { anyOf: [{ type: "string" }, { type: "null" }] },
          fixed_pairs: {
            anyOf: [{ type: "array", items: PAIR_SCHEMA }, { type: "null" }],
          },
        },
      },
    },
  },
};

// ── Prompts ───────────────────────────────────────────────────────────────────

const REWRITE_SYSTEM = `You rewrite formal written Chinese news into spoken Hong Kong TV-news-anchor Cantonese.

Register: exactly how a Hong Kong TV news anchor SPEAKS a bulletin aloud — natural spoken Cantonese with spoken words/particles where an anchor would use them (係, 嘅, 咗, 呢個, 而家, 話, 佢哋…), but still polished and professional. NOT stiff read-off-the-page written Chinese, and NOT street slang. Restructure the wording where a real anchor would; formal compounds an anchor keeps (不足, 不斷, 是否, 參與…) stay as they are — never mechanically swap characters inside a compound (不足 must NEVER become 唔足).

Rules:
- Keep numbers (as digits), company names, personal names, and financial/technical terms EXACTLY as in the original.
- Output one colloquial sentence per formal sentence, in the same order — strict 1:1, same count.
- For every sentence also output "pairs": the two sentences split into short aligned phrase segments, in order. Joining all "f" values MUST reproduce the formal sentence character-for-character (including punctuation); joining all "c" values MUST reproduce your colloquial sentence character-for-character. Segment at natural phrase boundaries (a few characters each). If a phrase is dropped, use an empty "c"; if inserted, use an empty "f".`;

const VERIFY_SYSTEM = `You are an independent native Hong Kong Cantonese reviewer checking machine-produced rewrites of written Chinese news into spoken TV-news-anchor Cantonese. Judge each rewrite strictly:

1. NATURAL — is it genuinely how a HK news anchor would SAY it aloud? Flag word-swapped written Chinese, Mandarin-flavoured phrasing, and above all mangled compounds (e.g. 唔足 for 不足, 其佢 for 其他, 參同 for 參與 — these are always wrong).
2. FAITHFUL — meaning preserved exactly; numbers, names, and technical terms unchanged.
3. REGISTER — polished anchor speech, not street slang, not stiff written Chinese.

For each item return ok=true if it passes all three. If it fails, return ok=false with "fixed" (your corrected anchor-Cantonese sentence) and "fixed_pairs" (the corrected sentence aligned to the ORIGINAL formal sentence as phrase segments: joining "f" values reproduces the formal sentence exactly; joining "c" values reproduces your fixed sentence exactly). When ok=true, set fixed and fixed_pairs to null.`;

// ── Core call helper ──────────────────────────────────────────────────────────

async function structuredCall(client, { system, user, schema, model }) {
  try {
    const response = await client.messages.create({
      model: model || CONVERT_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = (response.content || []).find((b) => b.type === "text");
    if (!text || !text.text) return null;
    return JSON.parse(text.text);
  } catch {
    return null;
  }
}

// Validate that pairs really concatenate to the two sentences; returns the
// pairs (with empty-empty entries dropped) or null when misaligned.
export function validatePairs(formal, colloquial, pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const clean = pairs
    .map((p) => ({ f: String(p?.f ?? ""), c: String(p?.c ?? "") }))
    .filter((p) => p.f !== "" || p.c !== "");
  if (!clean.length) return null;
  const f = clean.map((p) => p.f).join("");
  const c = clean.map((p) => p.c).join("");
  return f === formal && c === colloquial ? clean : null;
}

function batches(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Pass 1: rewrite ───────────────────────────────────────────────────────────

// Rewrite formal sentences into anchor Cantonese with aligned pairs.
// Returns [{colloquial, pairs|null}] aligned to `formals`, or null on failure.
export async function rewriteSentences(formals, client, opts = {}) {
  if (!client || !formals || !formals.length) return null;
  const out = [];
  for (const batch of batches(formals, opts.batchSize || BATCH_SIZE)) {
    const list = batch.map((f, i) => `${i + 1}. ${f}`).join("\n");
    const user = `Rewrite each of the following ${batch.length} formal Chinese sentences into HK news-anchor spoken Cantonese, with aligned phrase pairs. The "sentences" array MUST have exactly ${batch.length} items, in the same order as the input.

Formal sentences:
${list}`;
    const parsed = await structuredCall(client, {
      system: REWRITE_SYSTEM,
      user,
      schema: REWRITE_SCHEMA,
      model: opts.model,
    });
    const arr = parsed && parsed.sentences;
    if (!Array.isArray(arr) || arr.length !== batch.length) return null;
    arr.forEach((s, i) => {
      const colloquial = normalizeDigits(String(s.colloquial || "").trim());
      if (!colloquial) {
        out.push({ colloquial: batch[i], pairs: null });
        return;
      }
      const pairs = Array.isArray(s.pairs)
        ? s.pairs.map((p) => ({ f: p?.f, c: normalizeDigits(String(p?.c ?? "")) }))
        : s.pairs;
      out.push({
        colloquial,
        pairs: validatePairs(batch[i], colloquial, pairs),
      });
    });
  }
  return out;
}

// ── Pass 2: verify (the independent cross-check the rewrites go through) ─────

// Cross-check rewrites; repairs flagged ones. Returns
// {sentences: [{colloquial, pairs|null, ok}], checked: n, repaired: n} or null.
export async function verifyRewrites(formals, rewrites, client, opts = {}) {
  if (!client || !formals?.length || formals.length !== rewrites?.length) return null;
  const out = [];
  let repaired = 0;
  const idxBatches = batches([...formals.keys()], opts.batchSize || BATCH_SIZE);
  for (const idxs of idxBatches) {
    const list = idxs
      .map(
        (i, k) =>
          `${k + 1}.\nFORMAL: ${formals[i]}\nCANTONESE: ${rewrites[i].colloquial}`,
      )
      .join("\n\n");
    const user = `Review the following ${idxs.length} rewrite(s). The "verdicts" array MUST have exactly ${idxs.length} items, in the same order.

${list}`;
    const parsed = await structuredCall(client, {
      system: VERIFY_SYSTEM,
      user,
      schema: VERIFY_SCHEMA,
      model: opts.model,
    });
    const arr = parsed && parsed.verdicts;
    if (!Array.isArray(arr) || arr.length !== idxs.length) return null;
    idxs.forEach((i, k) => {
      const v = arr[k];
      const fixed = v && !v.ok ? normalizeDigits(String(v.fixed || "").trim()) : "";
      if (fixed) {
        repaired++;
        const fixedPairs = Array.isArray(v.fixed_pairs)
          ? v.fixed_pairs.map((p) => ({ f: p?.f, c: normalizeDigits(String(p?.c ?? "")) }))
          : v.fixed_pairs;
        out[i] = {
          colloquial: fixed,
          pairs: validatePairs(formals[i], fixed, fixedPairs),
          ok: false,
        };
      } else {
        out[i] = { ...rewrites[i], ok: v ? !!v.ok : true };
      }
    });
  }
  return { sentences: out, checked: formals.length, repaired };
}

// ── The full pipeline ─────────────────────────────────────────────────────────

/**
 * Rewrite + cross-check one article's formal sentences.
 * Returns { sentences: [{colloquial, pairs|null}], verified: bool } or null
 * (the caller then falls back to the rule-based converter).
 */
export async function convertArticle(formals, client, opts = {}) {
  const rewrites = await rewriteSentences(formals, client, opts);
  if (!rewrites) return null;
  const verdict = await verifyRewrites(formals, rewrites, client, opts);
  if (!verdict) {
    // Verifier unavailable — ship the (unchecked) rewrites rather than fail.
    return { sentences: rewrites, verified: false, repaired: 0 };
  }
  return {
    sentences: verdict.sentences.map(({ colloquial, pairs }) => ({ colloquial, pairs })),
    verified: true,
    repaired: verdict.repaired,
  };
}
