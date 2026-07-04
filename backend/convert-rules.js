// convert-rules.js — KEYLESS, rule-based formal-written -> spoken-Cantonese
// conversion. The fallback path when no ANTHROPIC_API_KEY is configured: it
// applies well-known written->spoken lexical swaps (是->係, 不->唔, 沒有->冇,
// 現在->而家, 我們->我哋 …). Rougher than the Claude rewrite — it won't
// restructure grammar — but it makes the text read/sound noticeably more
// Cantonese, and V2 hardens it with a much larger PROTECT table so compounds
// like 不足 / 其他 / 參與 / 沒收 are never mangled by the single-char rules.
//
// Implementation: a SINGLE left-to-right longest-match pass over a combined
// rule table. Multi-character keys are tried before shorter ones at each
// position, so compound words are converted (or protected) as a unit and their
// characters are never re-converted piecemeal.
//
// V2 also exposes toColloquialSegments(), which returns the ALIGNED SEGMENT
// PAIRS the conversion walked through — [{f, c}, ...] whose f-side concatenates
// to the input and c-side to the output — powering the tap-to-compare UI.

// Identity entries protect written forms whose characters would otherwise be
// mis-converted by the single-char rules (e.g. the 不 in 不足, the 他 in 其他,
// the 與 in 參與, the 沒 in 沒收). Being identity rules, they also merge into
// the surrounding unchanged text in the segment output.
const PROTECT_WORDS = [
  // 不 — compounds that are fine (or required) in spoken HK news register.
  "不過", "不足", "不斷", "不同", "不少", "不再", "不僅", "不宜", "不利",
  "不明", "不必", "不外乎", "不排除", "不大", "不良", "不幸", "不時",
  "不論", "不但", "不至於", "不合", "不涉", "不設", "不日", "不適",
  "不法", "不禁", "不妨", "不容", "不得", "不如", "不滿", "不錯", "不便",
  "不治", "不果", "不遂", "不濟", "不景", "不當", "不一", "不肖", "不無",
  // 的 — attributive 的->嘅 must not fire inside these.
  "目的", "的確", "的士", "標的", "目的地",
  // 了 — 了 as a morpheme, not the aspect marker.
  "了解", "了結", "未了", "不得了",
  // 是 — copula 是->係 must not fire inside these.
  "是否", "於是", "是次", "或是", "還是", "凡是", "是非",
  // 他 / 她 — 其他->其佢 was a real bug class.
  "其他", "他人", "他殺", "他日", "他國", "他鄉", "排他",
  // 和 — the conjunction rule 和->同 must not fire inside these.
  "和平", "和解", "和議", "共和", "飽和", "緩和", "溫和", "和諧", "和約",
  "求和", "議和", "和局",
  // 與 — 參與->參同 was a real bug class.
  "參與", "與會", "與此同時",
  // 說 — 說->講 must not fire inside these.
  "說明", "說法", "說服", "小說", "演說", "學說", "據說", "遊說",
  // 給 / 吃 / 喝 / 沒 compounds.
  "給予", "補給", "吃力", "吃虧", "喝彩", "喝止", "沒收", "沒落", "埋沒",
  "出沒", "沉沒", "淹沒", "神出鬼沒",
  // 也 — rare but real.
  "也許", "也門",
  // 在 — the preposition rule 在->喺 must not fire inside these.
  "存在", "正在", "在於", "實在", "潛在", "在場", "在職", "在內", "在此",
  "在座", "所在", "內在", "外在", "旨在", "志在", "意在", "在意", "在乎",
  "在案", "自在", "在任", "在世", "在生", "在望", "在即", "在囚", "在學",
  "在讀", "好在", "何在", "在野", "在朝", "重在", "貴在",
  // 看好/看淡 are proper finance vocabulary — keep them whole.
  "看好", "看淡",
  // 講話 (a speech, noun) must stay whole.
  "講話",
];

const PROTECT = Object.fromEntries(PROTECT_WORDS.map((w) => [w, w]));

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
  剛才: "頭先",
  但是: "但係",
  可是: "但係",
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
  這是: "呢個係",
  那是: "嗰個係",
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
  除了: "除咗",
  表示: "話",
  認為: "覺得",
  一點: "少少",
  多少: "幾多",
  什麼: "咩",
  甚麼: "咩",
  誰: "邊個",
  一起: "一齊",
  裡面: "入面",
  裏面: "入面",
  外面: "出面",
  昨天: "尋日",
  昨日: "尋日",
  今天: "今日",
  明天: "聽日",
  明日: "聽日",
  昨晚: "尋晚",
  看到: "見到",
  看見: "見到",
  回去: "返去",
  回來: "返嚟",
  回家: "返屋企",
  不會: "唔會",
  不能: "唔能夠",
  不可以: "唔可以",
  不要: "唔好",
  不是: "唔係",
  不用: "唔使",
  不需要: "唔需要",
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
  在: "喺",
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

/**
 * Convert one string of written Chinese to rough spoken Cantonese, returning
 * the aligned segment pairs the conversion produced:
 *   [{f: "市場", c: "市場"}, {f: "認為", c: "覺得"}, ...]
 * Invariants: concat(f) === input, concat(c) === output. Runs of unchanged
 * text (including PROTECT hits) are merged into single identity segments.
 */
export function toColloquialSegments(text) {
  const chars = [...String(text || "")];
  const n = chars.length;
  const segs = [];
  let plain = ""; // pending unchanged run

  const flushPlain = () => {
    if (plain) {
      segs.push({ f: plain, c: plain });
      plain = "";
    }
  };

  let i = 0;
  while (i < n) {
    let matched = false;
    for (let len = Math.min(MAX_KEY, n - i); len >= 1; len--) {
      const bucket = BY_LEN.get(len);
      if (!bucket) continue;
      const slice = chars.slice(i, i + len).join("");
      if (bucket.has(slice)) {
        const repl = RULES[slice];
        if (repl === slice) {
          plain += slice; // identity/PROTECT — part of the unchanged run
        } else {
          flushPlain();
          segs.push({ f: slice, c: repl });
        }
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      plain += chars[i];
      i += 1;
    }
  }
  flushPlain();
  return segs;
}

// Convert one string of written Chinese to rough spoken Cantonese.
export function toColloquial(text) {
  return toColloquialSegments(text)
    .map((s) => s.c)
    .join("");
}

// True if conversion actually changed anything (for honest labelling).
export function changed(formal, colloquial) {
  return formal !== colloquial;
}
