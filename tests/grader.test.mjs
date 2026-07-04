import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeText } from "../frontend/grader.js";

// A tiny fake jyutping lookup for homophone tests (toneless readings).
const JYUT = { 詩: ["si"], 私: ["si"], 試: ["si"], 書: ["syu"], 工: ["gung"], 公: ["gung"] };
const jyutpingOf = (ch) => JYUT[ch] || null;

test("perfect read scores 100%", () => {
  const r = gradeText("呢間公司升咗。", "呢間公司升咗");
  assert.equal(r.accuracy, 1);
  assert.ok(r.marks.every((m) => m.ok));
});

test("one wrong character does NOT cascade (alignment)", () => {
  // target 6 CJK chars; heard drops one -> 5/6 correct, not 1/6.
  const r = gradeText("我今日好開心", "我今好開心");
  assert.equal(r.marks.length, 6);
  const correct = r.marks.filter((m) => m.ok || m.sound).length;
  assert.equal(correct, 5); // only 日 missing
  assert.ok(Math.abs(r.accuracy - 5 / 6) < 1e-9);
});

test("script normalisation makes 學 == 学", () => {
  const map = { 學: "学", 習: "习" };
  const norm = (ch) => map[ch] || ch;
  const r = gradeText("學習", "学习", norm);
  assert.equal(r.accuracy, 1);
  assert.deepEqual(r.marks.map((m) => m.char), ["學", "習"]);
});

test("register leniency: colloquial target vs standard ASR output scores 100%", () => {
  const r = gradeText("呢間公司升咗", "這間公司升了");
  assert.equal(r.accuracy, 1);
});

test("register leniency: 係/嘅/佢/話 collapse to standard equivalents", () => {
  const r = gradeText("佢話係我嘅", "他說是我的");
  assert.equal(r.accuracy, 1);
});

test("homophone counts as correct (soft/amber match)", () => {
  // Target 詩; recogniser heard 私 — same sound (si). Should count, marked sound.
  const r = gradeText("詩", "私", (c) => c, jyutpingOf);
  assert.equal(r.accuracy, 1);
  assert.equal(r.marks[0].ok, false);
  assert.equal(r.marks[0].sound, true);
});

test("homophone leniency inside a sentence, non-homophone stays wrong", () => {
  // 詩->試 (si, homophone: ok) ; 書 mis-heard as 公 (syu vs gung: wrong)
  const r = gradeText("詩書", "試公", (c) => c, jyutpingOf);
  assert.equal(r.marks[0].sound, true); // 詩 ~ 試
  assert.equal(r.marks[1].ok, false);
  assert.equal(r.marks[1].sound, false); // 書 != 公
  assert.ok(Math.abs(r.accuracy - 0.5) < 1e-9);
});

test("no jyutpingOf -> no homophone leniency (backwards compatible)", () => {
  const r = gradeText("詩", "私"); // no dict passed
  assert.equal(r.accuracy, 0);
  assert.equal(r.marks[0].sound, false);
});

test("empty heard scores 0, no crash", () => {
  const r = gradeText("市場造好。", "");
  assert.equal(r.accuracy, 0);
});

test("punctuation is ignored in scoring", () => {
  const r = gradeText("升咗！", "升咗");
  assert.equal(r.marks.length, 2);
  assert.equal(r.accuracy, 1);
});
