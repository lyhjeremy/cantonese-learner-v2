import { test } from "node:test";
import assert from "node:assert/strict";
import { ghConvertSentences, GH_MODELS_ENDPOINT } from "../backend/ghmodels.js";

function queuedFetch(...payloads) {
  const calls = [];
  return {
    calls,
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      const next = payloads.shift();
      if (next instanceof Error) throw next;
      if (next && next.status) return { ok: false, status: next.status, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(next) } }] }),
      };
    },
  };
}

test("ghConvertSentences: rewrite then review, returns reviewed sentences", async () => {
  const q = queuedFetch(
    { sentences: ["供應唔足。", "個市造好。"] }, // rewrite (with a classic error)
    { sentences: ["供應不足。", "個市造好。"] }, // review repairs it
  );
  const out = await ghConvertSentences(["供應不足。", "市場造好。"], { token: "tok" }, q.fetch);
  assert.deepEqual(out, ["供應不足。", "個市造好。"]);
  assert.equal(q.calls.length, 2);
  assert.equal(q.calls[0].url, GH_MODELS_ENDPOINT);
  assert.match(q.calls[0].opts.headers.authorization, /^Bearer tok$/);
  const body = JSON.parse(q.calls[0].opts.body);
  assert.equal(body.messages[0].role, "system");
});

test("ghConvertSentences: review failure is non-fatal (ships rewrites)", async () => {
  const q = queuedFetch({ sentences: ["個市造好。"] }, { status: 400 });
  const out = await ghConvertSentences(["市場造好。"], { token: "tok" }, q.fetch);
  assert.deepEqual(out, ["個市造好。"]);
});

test("ghConvertSentences: 429s are retried with backoff and then succeed", async () => {
  const q = queuedFetch(
    { status: 429 },
    { sentences: ["個市造好。"] },
  );
  const out = await ghConvertSentences(
    ["市場造好。"],
    { token: "tok", review: false, retries: 2, retryDelayMs: 1 },
    q.fetch,
  );
  assert.deepEqual(out, ["個市造好。"]);
  assert.equal(q.calls.length, 2);
});

test("ghConvertSentences: rewrite failure returns null (fallback to rules)", async () => {
  const q1 = queuedFetch({ status: 401 });
  assert.equal(await ghConvertSentences(["一。"], { token: "tok" }, q1.fetch), null);
  const q2 = queuedFetch({ sentences: ["只有一句"] });
  assert.equal(await ghConvertSentences(["一。", "二。"], { token: "tok" }, q2.fetch), null);
  assert.equal(await ghConvertSentences(["一。"], { token: "" }), null);
});

test("ghConvertSentences: tolerates markdown fences in the model output", async () => {
  const q = queuedFetch("```json\n{\"sentences\": [\"個市造好。\"]}\n```");
  // queuedFetch stringifies objects; emulate a fenced string payload directly:
  q.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '```json\n{"sentences": ["個市造好。"]}\n```' } }],
    }),
  });
  const out = await ghConvertSentences(["市場造好。"], { token: "tok", review: false }, q.fetch);
  assert.deepEqual(out, ["個市造好。"]);
});

test("model fallback: when the primary model's quota is gone, the batch reruns on the fallback model", async () => {
  const models = [];
  const fetchImpl = async (url, opts) => {
    models.push(JSON.parse(opts.body).model);
    if (models.length === 1) {
      // Primary model: daily quota exhausted (long retry-after trips the breaker).
      return { ok: false, status: 429, headers: { get: () => "86400" }, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"sentences": ["個市造好。"]}' } }] }),
    };
  };
  const out = await ghConvertSentences(
    ["市場造好。"],
    { token: "tok", review: false, model: "m-primary", fallbackModel: "m-fallback" },
    fetchImpl,
  );
  assert.deepEqual(out, ["個市造好。"]);
  assert.deepEqual(models, ["m-primary", "m-fallback"]);
});

test("daily-quota circuit breaker: after retries exhaust on 429, later calls skip instantly", async () => {
  // Fresh import state is per-process; this test runs after earlier ones, so
  // simulate: first call exhausts 429 retries -> breaker trips -> second call
  // makes NO fetch at all.
  const calls = [];
  const always429 = async (url, opts) => {
    calls.push(url);
    return { ok: false, status: 429, headers: { get: () => "86400" }, json: async () => ({}) };
  };
  const out1 = await ghConvertSentences(["一。"], { token: "tok", review: false, retries: 1, retryDelayMs: 1 }, always429);
  assert.equal(out1, null);
  const before = calls.length;
  const out2 = await ghConvertSentences(["二。"], { token: "tok", review: false, retries: 1, retryDelayMs: 1 }, always429);
  assert.equal(out2, null);
  assert.equal(calls.length, before, "no further HTTP calls after the breaker trips");
});
