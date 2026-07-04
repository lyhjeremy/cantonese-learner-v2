import { test } from "node:test";
import assert from "node:assert/strict";
import { paragraphsToUnits, parseStrictJson, translateColloquial } from "../backend/convert.js";

test("paragraphsToUnits assigns paragraph_id per blank-line paragraph", () => {
  const body = "第一段第一句。第一段第二句。\n\n第二段句子在這裏。";
  const units = paragraphsToUnits(body);
  assert.ok(units.length >= 2);
  assert.equal(units[0].paragraph_id, 0);
  assert.equal(units[units.length - 1].paragraph_id, 1);
});

test("parseStrictJson tolerates ```json fences and surrounding prose", () => {
  const withFence = 'Sure!\n```json\n{"colloquial":["呢句嘢"]}\n```';
  const parsed = parseStrictJson(withFence);
  assert.equal(parsed.colloquial[0], "呢句嘢");
});

test("translateColloquial returns null without an API key (keeps build keyless)", async () => {
  assert.equal(await translateColloquial(["該公司增長。"], ""), null);
});

test("translateColloquial returns an aligned array on success (mocked Claude)", async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      content: [{ text: JSON.stringify({ colloquial: ["呢間公司升咗。", "個市造好。"] }) }],
    }),
  });
  const out = await translateColloquial(["該公司增長。", "市場造好。"], "sk-test", {}, mockFetch);
  assert.deepEqual(out, ["呢間公司升咗。", "個市造好。"]);
});

test("translateColloquial returns null on count mismatch (caller falls back to rules)", async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ text: JSON.stringify({ colloquial: ["只有一句。"] }) }] }),
  });
  assert.equal(await translateColloquial(["一。", "二。"], "sk-test", {}, mockFetch), null);
});

test("translateColloquial returns null on API error", async () => {
  const mockFetch = async () => ({ ok: false, status: 429 });
  assert.equal(await translateColloquial(["一。"], "sk-test", {}, mockFetch), null);
});
