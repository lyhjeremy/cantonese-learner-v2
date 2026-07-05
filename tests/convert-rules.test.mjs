import { test } from "node:test";
import assert from "node:assert/strict";
import { toColloquial, toColloquialSegments, changed } from "../backend/convert-rules.js";

test("single-char swaps: 是->係 的->嘅 在->喺", () => {
  assert.equal(toColloquial("這是我的書"), "呢個係我嘅書"); // 這是 -> 呢個係 (phrase)
  assert.equal(toColloquial("他在香港"), "佢喺香港");
});

test("multi-char phrases convert as units", () => {
  assert.equal(toColloquial("現在我們沒有錢"), "而家我哋冇錢");
  assert.equal(toColloquial("為什麼"), "點解");
  assert.equal(toColloquial("他們認為這個很好"), "佢哋覺得呢個好好");
});

test("negation converts ONLY as whole phrases (single 不->唔 removed)", () => {
  assert.equal(toColloquial("我不知道"), "我唔知");
  assert.equal(toColloquial("不會出席"), "唔會出席");
  assert.equal(toColloquial("他不是學生"), "佢唔係學生");
  assert.equal(toColloquial("不用擔心"), "唔使擔心");
  // Literary 不-compounds stay written — never 唔慎 / 唔敵 / 唔含.
  assert.equal(toColloquial("不慎跌倒"), "不慎跌倒");
  assert.equal(toColloquial("港隊不敵日本"), "港隊不敵日本");
  assert.equal(toColloquial("新興市場（不含日本）"), "新興市場（不含日本）");
  assert.equal(toColloquial("供應不足"), "供應不足");
});

test("bare demonstratives no longer fire; classifier bigrams do", () => {
  assert.equal(toColloquial("這意味著風險上升"), "這意味著風險上升"); // not 呢意味著
  assert.equal(toColloquial("這位分析員"), "呢位分析員");
  assert.equal(toColloquial("此次會議"), "今次會議");
  assert.equal(toColloquial("那麼多人"), "咁多人");
  assert.equal(toColloquial("巴塞羅那時間"), "巴塞羅那時間"); // transliteration guarded
});

test("quotative 說->話, with compounds and 來說 protected", () => {
  assert.equal(toColloquial("他說，天氣很熱"), "佢話，天氣好熱");
  assert.equal(toColloquial("對我來說"), "對我嚟講");
  assert.equal(toColloquial("據說小說很好"), "據說小說好好");
});

test("表示 -> 話 only as a speech act, not before attitude nouns", () => {
  assert.equal(toColloquial("公司表示，收入上升"), "公司話，收入上升");
  assert.equal(toColloquial("對此表示歡迎"), "對此表示歡迎"); // never 話歡迎
});

test("sentence-final change-of-state 了 becomes 喇, perfective stays 咗", () => {
  assert.equal(toColloquial("已經三年了。"), "已經三年喇。");
  assert.equal(toColloquial("收入增長了兩成"), "收入增長咗兩成");
});

test("quoted spans are never converted (party names, titles)", () => {
  assert.equal(
    toColloquial("候選人來自「一起為了秘魯」政黨"),
    "候選人來自「一起為了秘魯」政黨",
  );
  assert.equal(toColloquial("他說《我們的時代》很好"), "佢話《我們的時代》好好");
});

test("audit additions: connectives, time words, and their boundary guards", () => {
  assert.equal(toColloquial("仍然上升"), "仲上升");
  assert.equal(toColloquial("立即行動"), "即刻行動");
  assert.equal(toColloquial("週四公布"), "星期四公布");
  assert.equal(toColloquial("成本以及匯率"), "成本同埋匯率");
  assert.equal(toColloquial("可以及時完成"), "可以及時完成"); // 可以 guards 以及
  assert.equal(toColloquial("原因此前已交代"), "原因此前已交代"); // 原因 guards 因此
  assert.equal(toColloquial("土耳其後來改口"), "土耳其後來改口"); // guards 其後/來說
  assert.equal(toColloquial("逾三百人"), "超過三百人");
  assert.equal(toColloquial("貸款逾期"), "貸款逾期");
});

test("removed risky rules stay removed: 一點 / 需要 / bare 那", () => {
  assert.equal(toColloquial("下午一點開會"), "下午一點開會");
  assert.equal(toColloquial("市民的需要"), "市民嘅需要");
});

test("在 converts as preposition but not inside compounds", () => {
  assert.equal(toColloquial("問題仍然存在"), "問題仲存在"); // 仍然->仲; 存在 protected
  assert.equal(toColloquial("目的在於改善"), "目的在於改善");
  assert.equal(toColloquial("在港上市"), "在港上市"); // written compound stays
});

test("longest-match protects: 其他 / 參與 / 沒收 / 是否 / 和平 / 了解", () => {
  assert.equal(toColloquial("其他人"), "其他人");
  assert.equal(toColloquial("參與計劃"), "參與計劃");
  assert.equal(toColloquial("警方沒收物品"), "警方沒收物品");
  assert.equal(toColloquial("是否屬實"), "是否屬實");
  assert.equal(toColloquial("和平協議"), "和平協議");
  assert.equal(toColloquial("了解情況"), "了解情況");
  assert.equal(toColloquial("與其他國家"), "與其他國家"); // 與其他 guards 與其
});

test("finance sentence gets a Cantonese flavour, numbers preserved", () => {
  const out = toColloquial("恒生指數升了百分之二，市場認為表現不錯。");
  assert.ok(out.includes("百分之二"), "numbers preserved");
  assert.ok(out.includes("咗"), "了 -> 咗");
  assert.ok(out.includes("覺得"), "認為 -> 覺得");
});

test("segments align — f concatenates to input, c to output", () => {
  const input = "市場認為他們現在不足以應付";
  const segs = toColloquialSegments(input);
  assert.equal(segs.map((s) => s.f).join(""), input);
  assert.equal(segs.map((s) => s.c).join(""), toColloquial(input));
  const changedSegs = segs.filter((s) => s.f !== s.c);
  assert.deepEqual(changedSegs, [
    { f: "認為", c: "覺得" },
    { f: "他們", c: "佢哋" },
    { f: "現在", c: "而家" },
  ]);
});

test("changed() reports whether anything was rewritten", () => {
  assert.equal(changed("是", toColloquial("是")), true);
  assert.equal(changed("港元", toColloquial("港元")), false);
});
