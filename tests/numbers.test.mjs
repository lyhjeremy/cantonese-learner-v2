import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardinalReading,
  digitsReading,
  spellOutNumbers,
} from "../frontend/numbers.js";

test("cardinal readings with 萬/億 grouping and 零 insertion", () => {
  assert.equal(cardinalReading("0"), "零");
  assert.equal(cardinalReading("7"), "七");
  assert.equal(cardinalReading("10"), "十");
  assert.equal(cardinalReading("13"), "十三");
  assert.equal(cardinalReading("30"), "三十");
  assert.equal(cardinalReading("105"), "一百零五");
  assert.equal(cardinalReading("110"), "一百一十");
  assert.equal(cardinalReading("400"), "四百");
  assert.equal(cardinalReading("1005"), "一千零五");
  assert.equal(cardinalReading("2020"), "二千零二十");
  assert.equal(cardinalReading("10000"), "一萬");
  assert.equal(cardinalReading("10500"), "一萬零五百");
  assert.equal(cardinalReading("25000"), "二萬五千");
  assert.equal(cardinalReading("12345"), "一萬二千三百四十五");
  assert.equal(cardinalReading("100000000"), "一億");
  assert.equal(cardinalReading("250060000"), "二億五千零六萬");
});

test("digit-by-digit readings", () => {
  assert.equal(digitsReading("2020"), "二零二零");
  assert.equal(digitsReading("1997"), "一九九七");
});

test("years read digit-by-digit, quantities as cardinals", () => {
  assert.equal(spellOutNumbers("2020年"), "二零二零年");
  assert.equal(spellOutNumbers("1997年香港回歸"), "一九九七年香港回歸");
  assert.equal(spellOutNumbers("賣出2020個"), "賣出二千零二十個");
  // Short year-like durations stay cardinal: 五年計劃, 三十年.
  assert.equal(spellOutNumbers("5年計劃"), "五年計劃");
  assert.equal(spellOutNumbers("30年"), "三十年");
});

test("dates are cardinals", () => {
  assert.equal(spellOutNumbers("7月3日"), "七月三日");
  assert.equal(spellOutNumbers("12月25號"), "十二月二十五號");
});

test("percentages and decimals", () => {
  assert.equal(spellOutNumbers("升15%"), "升百分之十五");
  assert.equal(spellOutNumbers("跌3.5%"), "跌百分之三點五");
  assert.equal(spellOutNumbers("指數報3.75"), "指數報三點七五");
});

test("comma-grouped numbers are quantities", () => {
  assert.equal(spellOutNumbers("1,234人"), "一千二百三十四人");
  assert.equal(spellOutNumbers("恒指報25,000點"), "恒指報二萬五千點");
});

test("year ranges: both sides digit-by-digit", () => {
  assert.equal(spellOutNumbers("2020至2021年"), "二零二零至二零二一年");
  assert.equal(spellOutNumbers("2020至21年"), "二零二零至二一年");
});

test("long unit-less digit runs read digit-by-digit (phone numbers)", () => {
  assert.equal(spellOutNumbers("熱線28463222"), "熱線二八四六三二二二");
});

test("lookahead supplies the unit from the next segment", () => {
  // Segment ends right after the digits; the 年 lives in the next segment.
  assert.equal(spellOutNumbers("到2020", "年底"), "到二零二零");
  assert.equal(spellOutNumbers("賣出500", "個"), "賣出五百");
});

test("text without digits is untouched", () => {
  const s = "恒生指數今日高開。";
  assert.equal(spellOutNumbers(s), s);
});
