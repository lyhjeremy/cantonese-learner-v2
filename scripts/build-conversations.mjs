// build-conversations.mjs — regenerate frontend/data/conversations.json from
// the hand-authored curriculum in content/conversations-src.json: computes
// per-character jyutping for every spoken line and validates the structure.
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

const scenarios = (src.scenarios || []).map((sc) => {
  if (!sc.id || !sc.title || !Array.isArray(sc.lines) || !sc.lines.length) {
    fail(`scenario missing id/title/lines: ${sc.id || "?"}`);
  }
  const sentences = sc.lines.map((line, i) => {
    if (!line.formal || !line.colloquial) fail(`${sc.id}#${i} missing formal/colloquial`);
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
});

if (errors) {
  console.error(`\n${errors} error(s) in conversations source.`);
  process.exit(1);
}

await writeFile(
  OUT,
  JSON.stringify({ version: 1, scenarios }, null, 2),
  "utf-8",
);
console.log(
  `Wrote conversations.json: ${scenarios.length} scenarios, ` +
    `${scenarios.reduce((n, s) => n + s.sentences.length, 0)} lines.`,
);
