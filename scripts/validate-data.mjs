// Validate the bundled data files: shape, jyutping alignment, and (V2) aligned
// written↔spoken pair invariants. Checks sample-lessons.json, the everyday
// conversations, and — when present — the generated today.json.
import { readFile } from "node:fs/promises";

function isCjk(ch) {
  const o = ch.codePointAt(0);
  return (o >= 0x4e00 && o <= 0x9fff) || (o >= 0x3400 && o <= 0x4dbf) || (o >= 0xf900 && o <= 0xfaff);
}

let errors = 0;
const fail = (m) => {
  errors++;
  console.error("✖", m);
};

function checkSentence(where, s) {
  if (typeof s.formal !== "string" || !s.formal) fail(`${where} missing formal`);
  if (typeof s.colloquial !== "string" || !s.colloquial) fail(`${where} missing colloquial`);
  const chars = [...s.colloquial];
  if (!Array.isArray(s.jyutping) || s.jyutping.length !== chars.length) {
    fail(`${where} jyutping length ${s.jyutping?.length} != colloquial length ${chars.length}`);
    return;
  }
  chars.forEach((ch, i) => {
    if (isCjk(ch) && !s.jyutping[i]) fail(`${where} CJK char "${ch}" (pos ${i}) has no jyutping`);
    if (!isCjk(ch) && s.jyutping[i] !== "") fail(`${where} non-CJK "${ch}" (pos ${i}) should have "" jyutping`);
  });
  // V2: aligned pairs must reproduce both sentences exactly.
  if (s.pairs != null) {
    if (!Array.isArray(s.pairs) || !s.pairs.length) fail(`${where} pairs present but empty`);
    else {
      const f = s.pairs.map((p) => p.f ?? "").join("");
      const c = s.pairs.map((p) => p.c ?? "").join("");
      if (f !== s.formal) fail(`${where} pairs f-side != formal`);
      if (c !== s.colloquial) fail(`${where} pairs c-side != colloquial`);
    }
  }
}

async function checkLessonsFile(name, { optional = false } = {}) {
  const path = new URL(`../frontend/data/${name}`, import.meta.url);
  let data;
  try {
    data = JSON.parse(await readFile(path, "utf-8"));
  } catch {
    if (!optional) fail(`${name} missing or unparseable`);
    else console.log(`(${name} absent — skipped)`);
    return;
  }
  if (!Array.isArray(data.articles) || !data.articles.length) {
    fail(`${name}: no articles`);
    return;
  }
  for (const a of data.articles) {
    if (!a.id || !a.title) fail(`${name}: article missing id/title`);
    if (!Array.isArray(a.sentences) || !a.sentences.length) fail(`${name}: article ${a.id} has no sentences`);
    for (const s of a.sentences) checkSentence(`${name} ${a.id}#${s.id}`, s);
  }
  console.log(
    `✓ ${name}: ${data.articles.length} articles, ` +
      `${data.articles.reduce((n, a) => n + a.sentences.length, 0)} sentences OK.`,
  );
}

async function checkConversations() {
  const path = new URL("../frontend/data/conversations.json", import.meta.url);
  let data;
  try {
    data = JSON.parse(await readFile(path, "utf-8"));
  } catch {
    fail("conversations.json missing or unparseable");
    return;
  }
  if (!Array.isArray(data.scenarios) || !data.scenarios.length) {
    fail("conversations.json: no scenarios");
    return;
  }
  for (const sc of data.scenarios) {
    if (!sc.id || !sc.title || !sc.title.en || !sc.title.hant || !sc.title.hans) {
      fail(`conversations ${sc.id || "?"}: missing id or tri-lingual title`);
    }
    if (!Array.isArray(sc.sentences) || !sc.sentences.length) {
      fail(`conversations ${sc.id}: no sentences`);
      continue;
    }
    for (const s of sc.sentences) {
      checkSentence(`conversations ${sc.id}#${s.id}`, s);
      if (!s.speaker) fail(`conversations ${sc.id}#${s.id} missing speaker`);
    }
  }
  console.log(
    `✓ conversations.json: ${data.scenarios.length} scenarios, ` +
      `${data.scenarios.reduce((n, s) => n + s.sentences.length, 0)} lines OK.`,
  );
}

await checkLessonsFile("sample-lessons.json");
await checkConversations();
await checkLessonsFile("today.json", { optional: true });

if (errors) {
  console.error(`\n${errors} data error(s).`);
  process.exit(1);
}
console.log("✓ all data valid.");
