// i18n.js — tri-lingual UI labels: English / Traditional / Simplified.
// The learner picks the UI language; all three are first-class.

export const LANGS = ["en", "hant", "hans"];

export const LANG_LABELS = { en: "EN", hant: "繁", hans: "简" };

export const STR = {
  appTitle: {
    en: "Cantonese Learner",
    hant: "粵語學習",
    hans: "粤语学习",
  },
  tagline: {
    en: "Today's Hong Kong & world news, the way HK news anchors speak it.",
    hant: "今日香港及國際新聞，用香港新聞主播嘅講法。",
    hans: "今日香港及国际新闻，用香港新闻主播的讲法。",
  },
  pickArticle: { en: "Choose an article", hant: "揀一篇文章", hans: "选一篇文章" },
  formal: { en: "Written Chinese", hant: "書面語", hans: "书面语" },
  colloquial: { en: "Spoken Cantonese", hant: "廣東話口語", hans: "广东话口语" },
  play: { en: "Play", hant: "播放", hans: "播放" },
  record: { en: "Record", hant: "錄音", hans: "录音" },
  stop: { en: "Stop", hant: "停止", hans: "停止" },
  prev: { en: "Prev", hant: "上一句", hans: "上一句" },
  next: { en: "Next", hant: "下一句", hans: "下一句" },
  replay: { en: "Replay", hant: "重播", hans: "重播" },
  speed: { en: "Speed", hant: "語速", hans: "语速" },
  script: { en: "Script", hant: "字體", hans: "字体" },
  trad: { en: "Traditional", hant: "繁體", hans: "繁体" },
  simp: { en: "Simplified", hant: "簡體", hans: "简体" },
  uiLang: { en: "Language", hant: "介面語言", hans: "界面语言" },
  listening: {
    en: "Listening… take your time — press R when you're done",
    hant: "聆聽緊…慢慢嚟，講完㩒 R 完成",
    hans: "聆听中…慢慢来，讲完按 R 完成",
  },
  score: { en: "Score", hant: "分數", hans: "分数" },
  heard: { en: "Heard", hant: "聽到", hans: "听到" },
  readOriginal: { en: "Read original at source", hant: "閱讀原文", hans: "阅读原文" },
  loading: { en: "Loading today's lessons…", hant: "載入緊今日課程…", hans: "载入今日课程…" },
  offlineDemo: {
    en: "Offline demo — curated sample lessons (no live news / no API key).",
    hant: "離線示範 — 精選示例課程（非即時新聞，無需 API key）。",
    hans: "离线演示 — 精选示例课程（非实时新闻，无需 API key）。",
  },
  conversionUnavailable: {
    en: "Cantonese conversion unavailable — showing formal text.",
    hant: "粵語轉換暫時無法提供 — 顯示書面語。",
    hans: "粤语转换暂时无法提供 — 显示书面语。",
  },
  noTts: {
    en: "No zh-HK voice in this browser — install a Cantonese voice, or try Chrome/Safari.",
    hant: "此瀏覽器沒有粵語語音 — 請安裝粵語語音，或試用 Chrome/Safari。",
    hans: "此浏览器没有粤语语音 — 请安装粤语语音，或试用 Chrome/Safari。",
  },
  nonCantoneseVoice: {
    en: (v) => `No Cantonese voice found — using “${v}”, which may not be Cantonese. Install a zh-HK voice for best results.`,
    hant: (v) => `搵唔到粵語語音 — 而家用緊「${v}」，可能唔係粵語。安裝 zh-HK 語音效果最好。`,
    hans: (v) => `找不到粤语语音 — 正在使用「${v}」，可能不是粤语。安装 zh-HK 语音效果最好。`,
  },
  noAsr: {
    en: "Speech grading needs Chrome (SpeechRecognition). Listening & reading still work.",
    hant: "語音評分需要 Chrome（語音辨識）。聆聽同閱讀仍然可用。",
    hans: "语音评分需要 Chrome（语音识别）。聆听和阅读仍然可用。",
  },
  micHint: { en: "Space Play · R Record · ← Prev · → Next", hant: "空白鍵 播放 · R 錄音 · ← 上一句 · → 下一句", hans: "空格 播放 · R 录音 · ← 上一句 · → 下一句" },
  back: { en: "← All articles", hant: "← 所有文章", hans: "← 所有文章" },
  sentenceOf: { en: (a, b) => `Sentence ${a} of ${b}`, hant: (a, b) => `第 ${a} 句，共 ${b} 句`, hans: (a, b) => `第 ${a} 句，共 ${b} 句` },
};

export function t(key, lang, ...args) {
  const entry = STR[key];
  if (!entry) return key;
  const v = entry[lang] ?? entry.en;
  return typeof v === "function" ? v(...args) : v;
}
