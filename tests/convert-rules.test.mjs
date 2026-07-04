import { test } from "node:test";
import assert from "node:assert/strict";
import { toColloquial, changed } from "../backend/convert-rules.js";

test("single-char swaps: 是->係 不->唔 的->嘅", () => {
  assert.equal(toColloquial("這是我的書"), "呢個係我嘅書"); // 這是 -> 呢個係 (phrase)
  assert.equal(toColloquial("我不知道"), "我唔知"); // 不知道 -> 唔知 (phrase)
});

test("multi-char phrases convert as a unit", () => {
  assert.equal(toColloquial("現在我們沒有錢"), "而家我哋冇錢");
  assert.equal(toColloquial("為什麼"), "點解");
  assert.equal(toColloquial("他們認為這個很好"), "佢哋覺得呢個好好");
});

test("longest-match protects compounds (不過, 目的) from single-char rules", () => {
  // 不過 must NOT become 唔過; 目的 must NOT become 目嘅.
  assert.equal(toColloquial("不過"), "不過");
  assert.equal(toColloquial("目的"), "目的");
  assert.equal(toColloquial("不過他不去"), "不過佢唔去");
});

test("finance sentence gets a Cantonese flavour, numbers preserved", () => {
  const out = toColloquial("恒生指數升了百分之二，市場認為表現不錯。");
  assert.ok(out.includes("百分之二"), "numbers preserved");
  assert.ok(out.includes("咗"), "了 -> 咗");
  assert.ok(out.includes("覺得"), "認為 -> 覺得");
});

test("changed() reports whether anything was rewritten", () => {
  assert.equal(changed("是", toColloquial("是")), true);
  assert.equal(changed("港元", toColloquial("港元")), false); // nothing to convert
});

// ── V2: hardened protect table + aligned segments ─────────────────────────────

import { toColloquialSegments } from "../backend/convert-rules.js";

test("V2 protect table: 不足 and friends survive the 不->唔 rule", () => {
  assert.equal(toColloquial("供應不足"), "供應不足"); // the reported bug
  assert.equal(toColloquial("不斷上升"), "不斷上升");
  assert.equal(toColloquial("其他人"), "其他人"); // not 其佢人
  assert.equal(toColloquial("參與計劃"), "參與計劃"); // not 參同計劃
  assert.equal(toColloquial("警方沒收物品"), "警方沒收物品"); // not 冇收
  assert.equal(toColloquial("是否屬實"), "是否屬實"); // not 係否
  assert.equal(toColloquial("和平協議"), "和平協議"); // not 同平
  assert.equal(toColloquial("了解情況"), "了解情況"); // not 咗解
});

test("V2: negation phrases convert as units", () => {
  assert.equal(toColloquial("不會出席"), "唔會出席");
  assert.equal(toColloquial("他不是學生"), "佢唔係學生");
  assert.equal(toColloquial("不用擔心"), "唔使擔心");
});

test("V2: 在 converts as preposition but not inside compounds", () => {
  assert.equal(toColloquial("他在香港"), "佢喺香港");
  assert.equal(toColloquial("問題仍然存在"), "問題仍然存在"); // not 存喺
  assert.equal(toColloquial("目的在於改善"), "目的在於改善"); // not 喺於
});

test("V2: segments align — f concatenates to input, c to output", () => {
  const input = "市場認為他們現在不足以應付";
  const segs = toColloquialSegments(input);
  assert.equal(segs.map((s) => s.f).join(""), input);
  assert.equal(segs.map((s) => s.c).join(""), toColloquial(input));
  // Changed segments are isolated; unchanged runs are merged.
  const changedSegs = segs.filter((s) => s.f !== s.c);
  assert.deepEqual(
    changedSegs,
    [
      { f: "認為", c: "覺得" },
      { f: "他們", c: "佢哋" },
      { f: "現在", c: "而家" },
    ],
  );
});
