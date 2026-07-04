import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chunkTextForLearning,
  cjkCount,
  cjkFraction,
  splitRawSentences,
  isCjkIdeograph,
} from "../backend/chunk.js";

test("isCjkIdeograph / cjkCount", () => {
  assert.equal(isCjkIdeograph("學"), true);
  assert.equal(isCjkIdeograph("A"), false);
  assert.equal(cjkCount("學習abc很重要。"), 5);
});

test("cjkFraction: majority-CJK vs Latin", () => {
  assert.ok(cjkFraction("恒生指數今日高開") > 0.9);
  assert.ok(cjkFraction("Hello world mostly english") < 0.1);
  assert.equal(cjkFraction(""), 0);
});

test("splitRawSentences keeps terminators, splits on commas", () => {
  const s = splitRawSentences("我很開心。你呢？");
  assert.deepEqual(s, ["我很開心。", "你呢？"]);
  const c = splitRawSentences("恒生指數今日高開，收市升咗。");
  assert.deepEqual(c, ["恒生指數今日高開，", "收市升咗。"]);
});

test("chunkTextForLearning packs short neighbours, never splits long", () => {
  const units = chunkTextForLearning("我很開心。你呢？");
  assert.equal(units.length, 1); // both short -> packed into one speakable unit
  assert.equal(units[0].chars, 6);

  const long = chunkTextForLearning("學習很重要。這是一個關於中文學習的很長句子。");
  assert.equal(long.length, 2);
  assert.equal(long[0].text, "學習很重要。");
  assert.equal(long[1].chars, 15);
});

test("chunkTextForLearning never splits a single long sentence", () => {
  const one = "這是一個非常非常非常非常非常非常長的句子沒有任何中間標點符號。";
  const units = chunkTextForLearning(one);
  assert.equal(units.length, 1);
});
