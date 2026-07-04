// Generate frontend/data/jyutping.json: a compact char -> space-joined TONELESS
// jyutping readings map, used by the grader for homophone-leniency (right sound,
// wrong character still counts). Toneless so tone-confusion by the recogniser is
// forgiven too. Deterministic; committed to the repo (regenerate if to-jyutping
// updates). Run: node scripts/build-jyutping-dict.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getJyutpingCandidates } from "to-jyutping";

const OUT = fileURLToPath(new URL("../frontend/data/jyutping.json", import.meta.url));
const toneless = (s) => s.replace(/\d+$/, "");

const dict = {};
// CJK Unified (0x4E00–0x9FFF) + Extension A (0x3400–0x4DBF).
for (const [lo, hi] of [[0x3400, 0x4dbf], [0x4e00, 0x9fff]]) {
  for (let cp = lo; cp <= hi; cp++) {
    const ch = String.fromCodePoint(cp);
    const cand = getJyutpingCandidates(ch);
    const readings = cand && cand[0] && Array.isArray(cand[0][1]) ? cand[0][1] : [];
    if (!readings.length) continue;
    const uniq = [...new Set(readings.map(toneless).filter(Boolean))];
    if (uniq.length) dict[ch] = uniq.join(" ");
  }
}

await writeFile(OUT, JSON.stringify(dict), "utf-8");
console.log(`Wrote jyutping.json: ${Object.keys(dict).length} characters.`);
