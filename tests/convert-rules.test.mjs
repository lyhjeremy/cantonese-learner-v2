import { test } from "node:test";
import assert from "node:assert/strict";
import { toColloquial, changed } from "../backend/convert-rules.js";

test("single-char swaps: 是->係 不->唔 的->嘅", () => {
  assert.equal(toColloquial("這是我的書"), "呢係我嘅書");
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
