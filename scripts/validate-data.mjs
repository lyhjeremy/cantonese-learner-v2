// Validate the bundled sample lessons: shape + jyutping alignment.
import { readFile } from "node:fs/promises";

function isCjk(ch) {
  const o = ch.codePointAt(0);
  return (o >= 0x4e00 && o <= 0x9fff) || (o >= 0x3400 && o <= 0x4dbf) || (o >= 0xf900 && o <= 0xfaff);
}

const path = new URL("../frontend/data/sample-lessons.json", import.meta.url);
const data = JSON.parse(await readFile(path, "utf-8"));

let errors = 0;
const fail = (m) => {
  errors++;
  console.error("✖", m);
};

if (!Array.isArray(data.articles) || !data.articles.length) fail("no articles");

for (const a of data.articles) {
  if (!a.id || !a.title) fail(`article missing id/title: ${JSON.stringify(a).slice(0, 60)}`);
  if (!Array.isArray(a.sentences) || !a.sentences.length) fail(`article ${a.id} has no sentences`);
  for (const s of a.sentences) {
    if (typeof s.formal !== "string" || !s.formal) fail(`${a.id}#${s.id} missing formal`);
    if (typeof s.colloquial !== "string" || !s.colloquial) fail(`${a.id}#${s.id} missing colloquial`);
    const chars = [...s.colloquial];
    if (!Array.isArray(s.jyutping) || s.jyutping.length !== chars.length) {
      fail(`${a.id}#${s.id} jyutping length ${s.jyutping?.length} != colloquial length ${chars.length}`);
      continue;
    }
    chars.forEach((ch, i) => {
      if (isCjk(ch) && !s.jyutping[i]) fail(`${a.id}#${s.id} CJK char "${ch}" (pos ${i}) has no jyutping`);
      if (!isCjk(ch) && s.jyutping[i] !== "") fail(`${a.id}#${s.id} non-CJK "${ch}" (pos ${i}) should have "" jyutping`);
    });
  }
}

if (errors) {
  console.error(`\n${errors} data error(s).`);
  process.exit(1);
}
console.log(`✓ sample-lessons.json valid: ${data.articles.length} articles, ${data.articles.reduce((n, a) => n + a.sentences.length, 0)} sentences, jyutping aligned.`);
