import { test } from "node:test";
import assert from "node:assert/strict";
import { alignPairs } from "../backend/align.js";

test("alignPairs: invariants hold (concat f == formal, concat c == colloquial)", () => {
  const cases = [
    ["市場認為他們現在不足以應付", "市場覺得佢哋而家不足以應付"],
    ["該公司宣布季度收益增長15%", "呢間公司公布季度收益升咗15%"],
    ["他說這是一個好機會", "佢話呢個係一個好機會"],
    ["完全相同的句子。", "完全相同的句子。"],
  ];
  for (const [f, c] of cases) {
    const pairs = alignPairs(f, c);
    assert.equal(pairs.map((p) => p.f).join(""), f);
    assert.equal(pairs.map((p) => p.c).join(""), c);
  }
});

test("alignPairs: changed phrases isolated, unchanged runs merged", () => {
  const pairs = alignPairs("市場認為表現理想", "市場覺得表現理想");
  const diff = pairs.filter((p) => p.f !== p.c);
  assert.deepEqual(diff, [{ f: "認為", c: "覺得" }]);
  // 市場 and 表現理想 stay as identity segments.
  assert.ok(pairs.some((p) => p.f === "市場" && p.c === "市場"));
});

test("alignPairs: insertions and deletions land in changed segments", () => {
  const pairs = alignPairs("該公司增長", "嗰間公司有增長");
  assert.equal(pairs.map((p) => p.f).join(""), "該公司增長");
  assert.equal(pairs.map((p) => p.c).join(""), "嗰間公司有增長");
});

test("alignPairs: tiny identity islands are merged into changed neighbours", () => {
  // 一 is shared but sits inside a rewritten phrase — should not split it.
  const pairs = alignPairs("將進行一次會議", "會開一個會");
  const singles = pairs.filter((p) => p.f === p.c && [...p.f].length === 1);
  assert.equal(singles.length, 0, "no one-char identity confetti");
  assert.equal(pairs.map((p) => p.f).join(""), "將進行一次會議");
  assert.equal(pairs.map((p) => p.c).join(""), "會開一個會");
});

test("alignPairs: null on empty input", () => {
  assert.equal(alignPairs("", "x"), null);
  assert.equal(alignPairs("x", ""), null);
});
