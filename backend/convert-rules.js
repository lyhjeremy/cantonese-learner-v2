// convert-rules.js — KEYLESS, rule-based formal-written -> spoken-Cantonese
// conversion. A pragmatic COMPROMISE for running with no Claude API key: it
// applies well-known written->spoken lexical swaps (是->係, 不->唔, 沒有->冇,
// 現在->而家, 我們->我哋 …). Rougher than an LLM rewrite — it won't restructure
// grammar — but it makes the text read/sound noticeably more Cantonese.
//
// Implementation: a SINGLE left-to-right longest-match pass over a combined
// rule table. Multi-character keys are tried before shorter ones at each
// position, so compound words are converted (or protected) as a unit and their
// characters are never re-converted piecemeal.

// Identity entries protect written forms whose characters would otherwise be
// mis-converted by the single-char rules (e.g. the 不 in 不過, the 的 in 目的).
const PROTECT = {
  不過: "不過",
  目的: "目的",
  的確: "的確",
  存在: "存在",
  的士: "的士",
  說明: "說明",
};

// Multi-character conversions (spoken vocabulary).
const PHRASES = {
  為什麼: "點解",
  為甚麼: "點解",
  怎麼樣: "點樣",
  怎麼: "點樣",
  怎樣: "點樣",
  現在: "而家",
  現時: "而家",
  目前: "而家",
  較早時: "頭先",
  但是: "但係",
  需要: "要",
  例如: "好似",
  一直: "一路",
  這個: "呢個",
  那個: "嗰個",
  這些: "呢啲",
  那些: "嗰啲",
  這裡: "呢度",
  這裏: "呢度",
  那裡: "嗰度",
  那裏: "嗰度",
  這樣: "咁樣",
  那樣: "噉樣",
  我們: "我哋",
  你們: "你哋",
  他們: "佢哋",
  她們: "佢哋",
  它們: "佢哋",
  咱們: "我哋",
  不知道: "唔知",
  知道: "知",
  沒關係: "冇關係",
  沒有: "冇",
  為了: "為咗",
  表示: "話",
  認為: "覺得",
  一點: "少少",
  多少: "幾多",
  什麼: "咩",
  甚麼: "咩",
};

// Single-character conversions.
const CHARS = {
  是: "係",
  不: "唔",
  的: "嘅",
  了: "咗",
  他: "佢",
  她: "佢",
  和: "同",
  與: "同",
  說: "講",
  很: "好",
  也: "都",
  這: "呢",
  那: "嗰",
  給: "畀",
  吃: "食",
  喝: "飲",
  沒: "冇",
};

// Combined table with keys sorted longest-first for the single-pass matcher.
const RULES = { ...CHARS, ...PHRASES, ...PROTECT };
const KEYS_BY_LEN = Object.keys(RULES).sort((a, b) => b.length - a.length);
const MAX_KEY = KEYS_BY_LEN.reduce((m, k) => Math.max(m, k.length), 1);
// Bucket keys by length for quick lookup during the scan.
const BY_LEN = new Map();
for (const k of KEYS_BY_LEN) {
  if (!BY_LEN.has(k.length)) BY_LEN.set(k.length, new Set());
  BY_LEN.get(k.length).add(k);
}

// Convert one string of written Chinese to rough spoken Cantonese.
export function toColloquial(text) {
  const chars = [...String(text || "")];
  const n = chars.length;
  let out = "";
  let i = 0;
  while (i < n) {
    let matched = false;
    for (let len = Math.min(MAX_KEY, n - i); len >= 1; len--) {
      const bucket = BY_LEN.get(len);
      if (!bucket) continue;
      const slice = chars.slice(i, i + len).join("");
      if (bucket.has(slice)) {
        out += RULES[slice];
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += chars[i];
      i += 1;
    }
  }
  return out;
}

// True if conversion actually changed anything (for honest labelling).
export function changed(formal, colloquial) {
  return formal !== colloquial;
}
