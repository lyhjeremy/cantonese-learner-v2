// convert-rules.js — KEYLESS, rule-based formal-written -> spoken-Cantonese
// conversion. The last-resort fallback when neither the Claude nor the free
// GitHub Models rewrite is available: longest-match lexical swaps (是->係,
// 的->嘅, 沒有->冇, 現在->而家, 我們->我哋 …). It cannot restructure grammar.
//
// Design principle (from a two-reviewer audit against real RTHK output): for
// HK news register a MISSED conversion is inaudible — an anchor keeps plenty
// of written vocabulary — while a WRONG conversion (唔足, 巴塞羅嗰, 話歡迎) is
// glaring. So risky single-character rules are inverted into explicit phrase
// whitelists (這位->呢位 … instead of 這->呢), the protect table is large, and
// text inside 「」/《》/『』 quotes (party names, titles, verbatim speech) is
// never converted at all.
//
// Implementation: a SINGLE left-to-right longest-match pass over a combined
// rule table. Multi-character keys are tried before shorter ones at each
// position, so compound words are converted (or protected) as a unit and their
// characters are never re-converted piecemeal.
//
// toColloquialSegments() returns the ALIGNED SEGMENT PAIRS the conversion
// walked through — [{f, c}, ...] whose f-side concatenates to the input and
// c-side to the output — powering the tap-to-compare UI.

// Identity entries protect written forms whose characters would otherwise be
// mis-converted by the char/phrase rules. Grouped by the rule they guard.
const PROTECT_WORDS = [
  // 不 — the single-char 不->唔 rule was REMOVED (its residue was dominated by
  // literary compounds: 不慎/不敵/不俗/不丹…). These entries remain to guard
  // OTHER rules from firing inside 不-compounds (e.g. the 了 in 不得了) and as
  // cheap insurance for the negation PHRASES below.
  "不過", "不足", "不斷", "不同", "不少", "不再", "不僅", "不宜", "不利",
  "不明", "不必", "不外乎", "不排除", "不大", "不良", "不幸", "不時",
  "不論", "不但", "不至於", "不合", "不涉", "不設", "不日", "不適",
  "不法", "不禁", "不妨", "不容", "不得", "不如", "不滿", "不錯", "不便",
  "不治", "不果", "不遂", "不濟", "不景", "不當", "不一", "不肖", "不無",
  "不在", "不和", "不與", "不了", "不了了之", "不得了",
  // 的 — attributive 的->嘅 must not fire inside these (incl. transliterations).
  "目的", "的確", "的士", "標的", "目的地",
  "波羅的海", "的黎波里", "亞的斯亞貝巴", "眾矢之的", "一語中的", "無的放矢",
  // 了 — 了 as a morpheme, not the aspect marker.
  "了解", "了結", "未了", "罷了", "私了", "算了", "了無", "了事", "了斷",
  // 是 — copula 是->係 must not fire inside these.
  "是否", "於是", "是次", "或是", "還是", "凡是", "是非", "是日", "是項",
  "實事求是", "自以為是",
  // 他 / 她 — incl. transliterations (他信, 馬耳他…).
  "其他", "他人", "他殺", "他日", "他國", "他鄉", "排他",
  "他信", "猶他", "馬耳他", "維他命", "維他奶", "吉他", "利他",
  // 和 — the conjunction rule 和->同 must not fire inside these.
  "和平", "和解", "和議", "共和", "飽和", "緩和", "溫和", "和諧", "和約",
  "求和", "議和", "和局", "和談", "和暖", "和好", "附和", "總和", "和尚",
  "和牛", "令和", "昭和", "和歌山", "和記", "大和證券",
  // 與 — 與其他 MUST accompany 與其 (longest-match), per the audit.
  "參與", "與會", "與此同時", "與其他", "與其", "與否", "給與",
  "與日俱增", "事與願違", "與生俱來", "與時並進",
  // 說 — quotative 說->話 must not fire inside these; 後來/原來 stop the
  // 來說->嚟講 phrase matching across a word boundary.
  "說明", "說法", "說服", "小說", "演說", "學說", "據說", "遊說",
  "說話", "再說", "傳說", "解說", "訴說", "述說", "雖說", "說客",
  "後來", "原來",
  // 給 / 吃 / 喝 / 沒 compounds.
  "給予", "補給", "給付", "吃力", "吃虧", "吃緊", "吃驚",
  "喝彩", "喝采", "喝止", "喝令", "喝罵",
  "沒收", "沒落", "埋沒", "出沒", "沉沒", "淹沒", "吞沒", "覆沒", "湮沒",
  "神出鬼沒",
  // 也 — rare but real.
  "也許", "也門", "亦然",
  // 在 — the preposition rule 在->喺 must not fire inside these. 在港/在華
  // stay written (在港上市 read as-is); 在美國 etc. still convert.
  "存在", "正在", "在於", "實在", "潛在", "在場", "在職", "在內", "在此",
  "在座", "所在", "內在", "外在", "旨在", "志在", "意在", "在意", "在乎",
  "在案", "自在", "在任", "在世", "在生", "在望", "在即", "在囚", "在學",
  "在讀", "好在", "何在", "在野", "在朝", "重在", "貴在", "在逃",
  "在所難免", "在港", "在華",
  // 表示 + attitude noun is NOT a speech act — 話歡迎 is broken Cantonese.
  "表示歡迎", "表示遺憾", "表示不滿", "表示哀悼", "表示關注", "表示支持",
  "表示反對", "表示感謝", "表示歉意", "表示慰問", "表示同情", "表示祝賀",
  "表示擔憂", "表示憂慮", "表示尊重", "表示滿意",
  // 認為 — passive 被認為 must not become 被覺得.
  "被認為",
  // 一起 as mainland-wire measure word (一起事故) — never 一齊.
  "一起事故", "一起案件", "一起事件",
  // Demonstrative-phrase guards (transliterations & fixed forms).
  "剎那", "巴塞羅那",
  // Left-boundary guards so the new phrase rules can't match across words:
  "可以", "所以", "難以", "得以", "足以", "予以", "加以",            // ↛ 以及
  "原因", "死因", "成因", "起因", "誘因", "主因", "病因",            // ↛ 因此
  "其後果", "土耳其",                                                // ↛ 其後
  "任何", "幾何", "曾幾何時",                                        // ↛ 何時/如何
  "隨即",                                                            // ↛ 即將
  "頻仍",                                                            // ↛ 仍
  "逾期", "逾越",                                                    // ↛ 逾
  "統一",                                                            // ↛ 一同
  "提早", "及早", "趁早", "遲早",                                    // ↛ 早上
  "今晚", "前晚", "當晚", "傍晚",                                    // ↛ 晚上
  "直至", "截至", "時至今日",                                        // ↛ 至今
  // 看 — the 看->睇 rule must not fire inside these.
  "觀看", "收看", "查看", "察看", "翻看", "看守", "看待", "看護",
  "看管", "看漲", "看跌", "看似", "看台", "看更", "看板", "小看",
  "眼看", "看好", "看淡",
  // 講話 (a speech, noun) must stay whole.
  "講話",
];

const PROTECT = Object.fromEntries(PROTECT_WORDS.map((w) => [w, w]));

// Multi-character conversions (spoken vocabulary, HK news-anchor register).
const PHRASES = {
  // Question words.
  為什麼: "點解",
  為甚麼: "點解",
  為何: "點解",
  怎麼樣: "點樣",
  怎麼: "點樣",
  怎樣: "點樣",
  如何: "點樣",
  何時: "幾時",
  什麼時候: "幾時",
  多少: "幾多",
  什麼: "咩",
  甚麼: "咩",
  誰: "邊個",
  // Time.
  現在: "而家",
  現時: "而家",
  目前: "而家",
  至今: "到而家",
  較早時: "早前",
  剛才: "頭先",
  剛剛: "啱啱",
  剛好: "啱啱好",
  立即: "即刻",
  立刻: "即刻",
  馬上: "即刻",
  即將: "就嚟",
  隨後: "跟住",
  其後: "之後",
  稍後: "遲啲",
  首次: "第一次",
  昨天: "尋日",
  昨日: "尋日",
  今天: "今日",
  明天: "聽日",
  明日: "聽日",
  前天: "前日",
  昨晚: "尋晚",
  明晚: "聽晚",
  今早: "今朝",
  明早: "聽朝",
  昨早: "尋朝",
  早上: "朝早",
  晚上: "夜晚",
  週一: "星期一",
  週二: "星期二",
  週三: "星期三",
  週四: "星期四",
  週五: "星期五",
  週六: "星期六",
  週日: "星期日",
  上週: "上星期",
  下週: "下星期",
  本週: "今個星期",
  // Demonstratives — explicit 這/那+classifier whitelist (the bare 這->呢 /
  // 那->嗰 rules were removed: 呢/嗰 need a classifier, and bare news 這
  // subjects like 這意味著 became ungrammatical 呢意味著).
  這個: "呢個",
  這些: "呢啲",
  這裡: "呢度",
  這裏: "呢度",
  這樣: "咁樣",
  這位: "呢位",
  這項: "呢項",
  這種: "呢種",
  這場: "呢場",
  這宗: "呢宗",
  這批: "呢批",
  這名: "呢名",
  這間: "呢間",
  這輪: "呢輪",
  這筆: "呢筆",
  這部: "呢部",
  這座: "呢座",
  這隻: "呢隻",
  這邊: "呢邊",
  這麼: "咁",
  這是: "呢個係",
  這次: "今次",
  此次: "今次",
  本次: "今次",
  那個: "嗰個",
  那些: "嗰啲",
  那裡: "嗰度",
  那裏: "嗰度",
  那樣: "噉樣",
  那位: "嗰位",
  那次: "嗰次",
  那種: "嗰種",
  那場: "嗰場",
  那名: "嗰名",
  那時: "嗰時",
  那邊: "嗰邊",
  那麼: "咁",
  那是: "嗰個係",
  // Pronouns.
  我們: "我哋",
  你們: "你哋",
  他們: "佢哋",
  她們: "佢哋",
  咱們: "我哋",
  // Negation — the safe spoken-negation wins live HERE, as whole phrases
  // (the single-char 不->唔 rule was removed after the audit).
  不知道: "唔知",
  不會: "唔會",
  不能: "唔能夠",
  不可以: "唔可以",
  不要: "唔好",
  不是: "唔係",
  不用: "唔使",
  不需要: "唔需要",
  沒關係: "冇關係",
  沒有: "冇",
  沒能: "未能",
  // Verbs / connectives / misc.
  知道: "知",
  為了: "為咗",
  除了: "除咗",
  表示: "話",
  認為: "覺得",
  例如: "譬如",
  以及: "同埋",
  因此: "所以",
  因此次: "因今次",
  也就是說: "即係話",
  一直: "一路",
  一起: "一齊",
  一同: "一齊",
  仍然: "仲",
  仍舊: "仲",
  許多: "好多",
  喜歡: "鍾意",
  逾: "超過",
  來說: "嚟講",
  聽說: "聽講",
  看來: "睇嚟",
  看到: "見到",
  看見: "見到",
  回去: "返去",
  回來: "返嚟",
  回家: "返屋企",
  裡面: "入面",
  裏面: "入面",
  外面: "出面",
};

// Single-character conversions — only the ones the audit judged net-positive
// for news register. (Removed as net-negative: 不, 這, 那.)
const CHARS = {
  是: "係",
  的: "嘅",
  了: "咗", // sentence-final change-of-state 了 becomes 喇 (see scanner)
  他: "佢",
  她: "佢",
  和: "同",
  與: "同",
  說: "話", // quotative — HK speech reporting uses 話, not 講
  很: "好",
  也: "都",
  亦: "都",
  仍: "仲",
  給: "畀",
  吃: "食",
  喝: "飲",
  沒: "冇",
  在: "喺",
  看: "睇",
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

// Quoted spans are copied through verbatim: party names, book/film titles and
// verbatim speech must never be word-swapped (「一起為了秘魯」 stays intact).
const QUOTE_CLOSERS = { "「": "」", "《": "》", "『": "』" };

// Sentence-final change-of-state 了 maps to 喇, not the perfective 咗.
const FINAL_PUNCT = new Set(["。", "！", "？"]);

/**
 * Convert one string of written Chinese to rough spoken Cantonese, returning
 * the aligned segment pairs the conversion produced:
 *   [{f: "市場", c: "市場"}, {f: "認為", c: "覺得"}, ...]
 * Invariants: concat(f) === input, concat(c) === output. Runs of unchanged
 * text (including PROTECT hits and quoted spans) merge into identity segments.
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
    // Copy quoted spans through untouched.
    const closer = QUOTE_CLOSERS[chars[i]];
    if (closer) {
      let j = i + 1;
      while (j < n && chars[j] !== closer) j++;
      if (j < n) j++; // include the closing quote
      plain += chars.slice(i, j).join("");
      i = j;
      continue;
    }
    let matched = false;
    for (let len = Math.min(MAX_KEY, n - i); len >= 1; len--) {
      const bucket = BY_LEN.get(len);
      if (!bucket) continue;
      const slice = chars.slice(i, i + len).join("");
      if (bucket.has(slice)) {
        let repl = RULES[slice];
        if (slice === "了") {
          const next = chars[i + len];
          if (next === undefined || FINAL_PUNCT.has(next)) repl = "喇";
        }
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
