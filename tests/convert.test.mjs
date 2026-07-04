import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paragraphsToUnits,
  validatePairs,
  rewriteSentences,
  verifyRewrites,
  convertArticle,
} from "../backend/convert.js";

test("paragraphsToUnits assigns paragraph_id per blank-line paragraph", () => {
  const body = "第一段第一句。第一段第二句。\n\n第二段句子在這裏。";
  const units = paragraphsToUnits(body);
  assert.ok(units.length >= 2);
  assert.equal(units[0].paragraph_id, 0);
  assert.equal(units[units.length - 1].paragraph_id, 1);
});

test("validatePairs accepts aligned pairs and rejects misaligned ones", () => {
  const ok = validatePairs("市場認為", "市場覺得", [
    { f: "市場", c: "市場" },
    { f: "認為", c: "覺得" },
  ]);
  assert.deepEqual(ok, [
    { f: "市場", c: "市場" },
    { f: "認為", c: "覺得" },
  ]);
  // f-side doesn't reproduce the formal sentence -> null.
  assert.equal(
    validatePairs("市場認為", "市場覺得", [{ f: "市場", c: "市場覺得" }]),
    null,
  );
  // Insertions/deletions via empty sides are allowed.
  const ins = validatePairs("公司宣布", "間公司宣布", [
    { f: "", c: "間" },
    { f: "公司宣布", c: "公司宣布" },
  ]);
  assert.equal(ins.length, 2);
  assert.equal(validatePairs("a", "b", []), null);
});

// A fake Anthropic client whose messages.create returns queued payloads.
function fakeClient(...payloads) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(req) {
        calls.push(req);
        const next = payloads.shift();
        if (next instanceof Error) throw next;
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(next) }],
        };
      },
    },
  };
}

test("rewriteSentences returns colloquial + validated pairs (mocked)", async () => {
  const client = fakeClient({
    sentences: [
      {
        colloquial: "呢間公司升咗。",
        pairs: [
          { f: "該公司", c: "呢間公司" },
          { f: "增長", c: "升咗" },
          { f: "。", c: "。" },
        ],
      },
    ],
  });
  const out = await rewriteSentences(["該公司增長。"], client);
  assert.equal(out.length, 1);
  assert.equal(out[0].colloquial, "呢間公司升咗。");
  assert.equal(out[0].pairs.length, 3);
  // The request used structured outputs + adaptive thinking.
  assert.equal(client.calls[0].output_config.format.type, "json_schema");
  assert.equal(client.calls[0].thinking.type, "adaptive");
});

test("rewriteSentences drops pairs that fail alignment but keeps the rewrite", async () => {
  const client = fakeClient({
    sentences: [
      { colloquial: "呢間公司升咗。", pairs: [{ f: "亂", c: "來" }] },
    ],
  });
  const out = await rewriteSentences(["該公司增長。"], client);
  assert.equal(out[0].colloquial, "呢間公司升咗。");
  assert.equal(out[0].pairs, null);
});

test("rewriteSentences returns null on count mismatch (fallback to rules)", async () => {
  const client = fakeClient({ sentences: [] });
  assert.equal(await rewriteSentences(["一。", "二。"], client), null);
});

test("rewriteSentences returns null on API error", async () => {
  const client = fakeClient(new Error("429"));
  assert.equal(await rewriteSentences(["一。"], client), null);
});

test("verifyRewrites applies the reviewer's fixes", async () => {
  const client = fakeClient({
    verdicts: [
      { ok: true, fixed: null, fixed_pairs: null },
      {
        ok: false,
        fixed: "供應不足。",
        fixed_pairs: [{ f: "供應不足。", c: "供應不足。" }],
      },
    ],
  });
  const formals = ["市場造好。", "供應不足。"];
  const rewrites = [
    { colloquial: "個市造好。", pairs: null },
    { colloquial: "供應唔足。", pairs: null }, // the classic mangled compound
  ];
  const res = await verifyRewrites(formals, rewrites, client);
  assert.equal(res.repaired, 1);
  assert.equal(res.sentences[0].colloquial, "個市造好。");
  assert.equal(res.sentences[1].colloquial, "供應不足。");
  assert.equal(res.sentences[1].pairs.length, 1);
});

test("convertArticle runs rewrite then verify and reports verified", async () => {
  const client = fakeClient(
    {
      sentences: [
        { colloquial: "個市造好。", pairs: [{ f: "市場造好。", c: "個市造好。" }] },
      ],
    },
    { verdicts: [{ ok: true, fixed: null, fixed_pairs: null }] },
  );
  const res = await convertArticle(["市場造好。"], client);
  assert.equal(res.verified, true);
  assert.equal(res.repaired, 0);
  assert.equal(res.sentences[0].colloquial, "個市造好。");
  assert.equal(client.calls.length, 2); // one rewrite call + one verify call
});

test("convertArticle survives a dead verifier (ships unchecked rewrites)", async () => {
  const client = fakeClient(
    { sentences: [{ colloquial: "個市造好。", pairs: null }] },
    new Error("boom"),
  );
  const res = await convertArticle(["市場造好。"], client);
  assert.equal(res.verified, false);
  assert.equal(res.sentences[0].colloquial, "個市造好。");
});

test("convertArticle returns null when the rewrite itself fails", async () => {
  const client = fakeClient(new Error("boom"));
  assert.equal(await convertArticle(["市場造好。"], client), null);
});
