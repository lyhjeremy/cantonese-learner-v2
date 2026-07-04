// chunk.js — CJK sentence chunking + packing, ported to JS from the Mandarin
// Reader's `chunk_text_for_learning`. Pure, dependency-free ES module so the
// Cloudflare Worker AND the Node unit tests can both import it.

// Sentence terminators (hard breaks) and secondary breakers (commas/colons).
// Per the spec: split on terminators (。！？；…) AND commas/colons (，、：),
// then re-pack fragments that are too short into speakable units.
const HARD_TERMINATORS = new Set(["。", "！", "？", "；", "…", "!", "?", ";"]);
const SOFT_BREAKERS = new Set(["，", "、", "：", ",", ":"]);
const ALL_BREAKERS = new Set([...HARD_TERMINATORS, ...SOFT_BREAKERS]);

export function isCjkIdeograph(ch) {
  const o = ch.codePointAt(0);
  return (
    (o >= 0x4e00 && o <= 0x9fff) || // CJK Unified Ideographs
    (o >= 0x3400 && o <= 0x4dbf) || // Extension A
    (o >= 0xf900 && o <= 0xfaff) // Compatibility Ideographs
  );
}

export function cjkCount(text) {
  let n = 0;
  for (const ch of text) if (isCjkIdeograph(ch)) n++;
  return n;
}

// Fraction of alphabetic characters that are CJK ideographs.
export function cjkFraction(text) {
  let cjk = 0;
  let letters = 0;
  for (const ch of text) {
    if (isCjkIdeograph(ch)) {
      cjk++;
      letters++;
    } else if (/\p{L}/u.test(ch)) {
      letters++;
    }
  }
  return letters ? cjk / letters : 0;
}

// Split text into raw sentences at breakers, keeping the breaker attached to the
// sentence it ends. Newlines also break a unit. Runs of consecutive breakers
// (…… / ！？) are absorbed onto one piece.
export function splitRawSentences(text) {
  const out = [];
  let buf = [];
  const chars = [...text];
  const n = chars.length;
  let i = 0;
  while (i < n) {
    const ch = chars[i];
    if (ch === "\n") {
      const piece = buf.join("").trim();
      if (piece) out.push(piece);
      buf = [];
      i++;
      continue;
    }
    buf.push(ch);
    if (ALL_BREAKERS.has(ch)) {
      while (i + 1 < n && ALL_BREAKERS.has(chars[i + 1])) {
        i++;
        buf.push(chars[i]);
      }
      const piece = buf.join("").trim();
      if (piece) out.push(piece);
      buf = [];
    }
    i++;
  }
  const tail = buf.join("").trim();
  if (tail) out.push(tail);
  return out;
}

// Split Chinese text into learning units. Packs SHORT neighbours together while
// under target_min and the merged unit still fits under target_max. Never splits
// a real sentence. Returns [{ text, chars }].
export function chunkTextForLearning(text, targetMin = 7, targetMax = 15) {
  const sentences = splitRawSentences(text);
  const units = [];
  const n = sentences.length;
  let i = 0;
  while (i < n) {
    let cur = sentences[i];
    let curLen = cjkCount(cur);
    i++;
    while (
      i < n &&
      curLen < targetMin &&
      curLen + cjkCount(sentences[i]) <= targetMax
    ) {
      cur += sentences[i];
      curLen += cjkCount(sentences[i]);
      i++;
    }
    units.push({ text: cur, chars: curLen });
  }
  return units;
}
