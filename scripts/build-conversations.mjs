// build-conversations.mjs — regenerate frontend/data/conversations.json from
// the hand-authored curriculum in content/conversations-src.json: computes
// per-character jyutping for every spoken line and validates the structure.
// The curriculum is organised as ~8 CATEGORIES, each holding 4-6 scenario
// dialogues (each category gets its own sub-page in the app).
// Run whenever the source file changes:  npm run build:conversations
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getJyutpingList } from "to-jyutping";

const SRC = fileURLToPath(new URL("../content/conversations-src.json", import.meta.url));
const OUT = fileURLToPath(new URL("../frontend/data/conversations.json", import.meta.url));

function jyutpingFor(text) {
  return getJyutpingList(text).map(([, jyut]) => jyut || "");
}

const src = JSON.parse(await readFile(SRC, "utf-8"));

let errors = 0;
const fail = (m) => {
  errors++;
  console.error("✖", m);
};

const CANTO_ONLY = /[嘅咗唔哋喺畀嚟搵嘢冇啲㗎蚊]/;

function buildScenario(sc, catId) {
  if (!sc.id || !sc.title || !Array.isArray(sc.lines) || !sc.lines.length) {
    fail(`scenario missing id/title/lines: ${catId}/${sc.id || "?"}`);
  }
  const sentences = (sc.lines || []).map((line, i) => {
    if (!line.formal || !line.colloquial) fail(`${catId}/${sc.id}#${i} missing formal/colloquial`);
    if (CANTO_ONLY.test(line.formal || "")) {
      fail(`${catId}/${sc.id}#${i} Cantonese-only character leaked into the WRITTEN layer: ${line.formal}`);
    }
    if (/\d/.test((line.formal || "") + (line.colloquial || ""))) {
      fail(`${catId}/${sc.id}#${i} digits found — conversations must spell numbers as characters`);
    }
    return {
      id: i,
      // Each dialogue line is its own paragraph so the reader renders the
      // conversation line by line.
      paragraph_id: i,
      speaker: line.speaker,
      formal: line.formal,
      colloquial: line.colloquial,
      jyutping: jyutpingFor(line.colloquial),
      en: line.en || "",
    };
  });
  return {
    id: sc.id,
    emoji: sc.emoji || "💬",
    level: sc.level || 1,
    title: sc.title,
    sentences,
  };
}

const categories = (src.categories || []).map((cat) => {
  if (!cat.id || !cat.title || !cat.title.en || !cat.title.hant || !cat.title.hans) {
    fail(`category missing id or tri-lingual title: ${cat.id || "?"}`);
  }
  if (!Array.isArray(cat.scenarios) || cat.scenarios.length < 4) {
    fail(`category ${cat.id}: needs at least 4 scenarios, has ${cat.scenarios?.length ?? 0}`);
  }
  return {
    id: cat.id,
    emoji: cat.emoji || "💬",
    title: cat.title,
    scenarios: (cat.scenarios || []).map((sc) => buildScenario(sc, cat.id)),
  };
});

if (errors) {
  console.error(`\n${errors} error(s) in conversations source.`);
  process.exit(1);
}

await writeFile(OUT, JSON.stringify({ version: 2, categories }, null, 2), "utf-8");
const nScen = categories.reduce((n, c) => n + c.scenarios.length, 0);
const nLines = categories.reduce(
  (n, c) => n + c.scenarios.reduce((m, s) => m + s.sentences.length, 0),
  0,
);
console.log(
  `Wrote conversations.json: ${categories.length} categories, ${nScen} scenarios, ${nLines} lines.`,
);
