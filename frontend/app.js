// app.js — the karaoke reader: data loading, side-by-side + interleaved panes,
// jyutping ruby, aligned written↔spoken phrase segments (tap to compare),
// auto-play, the everyday-conversations curriculum, transport, toggles,
// keyboard shortcuts, tri-lingual UI, and graceful degradation for missing
// TTS / speech-recognition.

import { LANGS, LANG_LABELS, t } from "./i18n.js";
import { initTts, speak, stopSpeaking, voiceName } from "./tts.js";
import { gradeText, asrAvailable, listen } from "./grader.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ── Persistent settings (client-side only, per the non-goals) ────────────────
const SETTINGS_KEY = "cfl.settings.v2";
const defaults = { lang: "en", theme: "light", speed: 1.0, script: "trad" };
function loadSettings() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...defaults };
  }
}
function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        lang: state.lang,
        theme: state.theme,
        speed: state.speed,
        script: state.script,
      }),
    );
  } catch {
    /* ignore */
  }
}

const state = {
  ...loadSettings(),
  lessons: null,
  conversations: null,
  article: null,
  idx: 0,
  tts: { available: false, voices: {} },
  asrOk: asrAvailable(),
  recording: null,
  autoplay: null, // token while auto-play is running
};

// ── Script conversion (OpenCC via CDN; identity fallback) ────────────────────
let t2s = (s) => s;
let s2t = (s) => s;
let openccOk = false;
function initOpenCC() {
  try {
    if (window.OpenCC && window.OpenCC.Converter) {
      const toSimp = window.OpenCC.Converter({ from: "t", to: "cn" });
      const toTrad = window.OpenCC.Converter({ from: "cn", to: "t" });
      t2s = (s) => toSimp(s);
      s2t = (s) => toTrad(s);
      openccOk = true;
    }
  } catch {
    openccOk = false;
  }
}
// Per-character normaliser used by the grader so 學 == 学 regardless of script.
const normalizeChar = (ch) => (openccOk ? t2s(ch) : ch);
// Convert a string for DISPLAY according to the current script toggle.
function forScript(s) {
  if (!openccOk) return s;
  return state.script === "simp" ? t2s(s) : s2t(s);
}
// Segment-safe display conversion: falls back to the original text when the
// conversion would change the character count (would break jyutping/marks).
function forScriptAligned(s) {
  const converted = forScript(s);
  return [...converted].length === [...s].length ? converted : s;
}

// ── Jyutping dictionary (for homophone-lenient grading) ──────────────────────
let jyutDict = null;
async function loadJyutDict() {
  try {
    const res = await fetch("./data/jyutping.json");
    if (res.ok) jyutDict = await res.json();
  } catch {
    jyutDict = null;
  }
}
// Toneless readings for a character. The dict is Traditional-keyed, so convert
// Simplified input to Traditional first. Returns null when unknown.
function jyutpingOf(ch) {
  if (!jyutDict) return null;
  const key = openccOk ? s2t(ch) : ch;
  const val = jyutDict[key] || jyutDict[ch];
  return val ? val.split(" ") : null;
}

// ── Data loading: daily news + bundled conversations ─────────────────────────
async function loadLessons() {
  // Live news baked daily by GitHub Actions (RSS + rewrite). Falls back to the
  // bundled curated sample so the app always works offline.
  try {
    const res = await fetch("./data/today.json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.articles) && data.articles.length) return data;
    }
  } catch {
    /* fall through to sample */
  }
  const res = await fetch("./data/sample-lessons.json");
  return res.json();
}

async function loadConversations() {
  try {
    const res = await fetch("./data/conversations.json");
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.scenarios) && data.scenarios.length) return data;
    }
  } catch {
    /* conversations are optional */
  }
  return null;
}

// Adapt a conversation scenario to the article shape the reader renders.
function scenarioAsArticle(sc) {
  return {
    id: sc.id,
    conversation: true,
    emoji: sc.emoji || "💬",
    title: (sc.title && (sc.title[state.lang] ?? sc.title.en)) || sc.id,
    source: t("convSection", state.lang),
    url: "",
    converted: true,
    sentences: sc.sentences,
  };
}

// ── Rendering: article list ──────────────────────────────────────────────────
function renderList() {
  state.article = null;
  stopAutoplay();
  $("#reader").hidden = true;
  $("#list").hidden = false;

  const banner = $("#banner");
  if (state.lessons.sample) {
    banner.textContent = t("offlineDemo", state.lang);
  } else {
    banner.textContent = `${state.lessons.source || ""}${state.lessons.date ? " · " + state.lessons.date : ""}`;
  }
  const vb = $("#verified-banner");
  vb.hidden = state.lessons.method !== "llm+verify";
  vb.textContent = t("verifiedNote", state.lang);

  const list = $("#cards");
  list.innerHTML = "";
  $("#list-title").textContent = `${t("newsSection", state.lang)} — ${t("pickArticle", state.lang)}`;
  state.lessons.articles.forEach((a) => {
    const card = el("button", "card");
    card.appendChild(el("h3", "card-title", forScript(a.title)));
    const meta = el("div", "card-meta");
    meta.appendChild(el("span", "src", a.source || ""));
    meta.appendChild(el("span", "cnt", `${a.sentences.length} · ${t("colloquial", state.lang)}`));
    card.appendChild(meta);
    // "Unavailable" only when a real rewrite backend failed — not for the
    // rule-based path, where no-change just means nothing needed swapping.
    if (a.converted === false && a.method !== "rules" && state.lessons.method !== "rules") {
      card.appendChild(el("div", "warn", t("conversionUnavailable", state.lang)));
    }
    card.addEventListener("click", () => openArticle(a));
    list.appendChild(card);
  });

  // Everyday conversations section.
  const block = $("#conv-block");
  if (state.conversations) {
    block.hidden = false;
    $("#conv-title").textContent = t("convSection", state.lang);
    $("#conv-blurb").textContent = t("convBlurb", state.lang);
    const conv = $("#conv-cards");
    conv.innerHTML = "";
    state.conversations.scenarios.forEach((sc) => {
      const a = scenarioAsArticle(sc);
      const card = el("button", "card conv-card");
      const head = el("div", "conv-head");
      head.appendChild(el("span", "conv-emoji", a.emoji));
      head.appendChild(el("h3", "card-title", a.title));
      card.appendChild(head);
      const meta = el("div", "card-meta");
      meta.appendChild(el("span", "src", t("levelNames", state.lang, sc.level || 1)));
      meta.appendChild(el("span", "cnt", `${a.sentences.length} ${t("lines", state.lang)}`));
      card.appendChild(meta);
      card.addEventListener("click", () => openArticle(scenarioAsArticle(sc)));
      conv.appendChild(card);
    });
  } else {
    block.hidden = true;
  }
}

// ── Rendering: reader ────────────────────────────────────────────────────────
function openArticle(a) {
  state.article = a;
  state.idx = 0;
  stopAutoplay();
  $("#list").hidden = true;
  $("#reader").hidden = false;
  renderReader();
}

function paragraphsOf(a) {
  const map = new Map();
  a.sentences.forEach((s) => {
    const pid = s.paragraph_id ?? 0;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid).push(s);
  });
  return [...map.values()];
}

function speakerLabel(s) {
  if (!s.speaker) return null;
  if (typeof s.speaker === "string") return s.speaker;
  return s.speaker[state.lang] ?? s.speaker.hant ?? s.speaker.en;
}

// Toggle the shared phrase highlight across all rendered copies of segment k.
let activeSeg = null;
function activateSeg(k) {
  document.querySelectorAll(".seg.seg-hl").forEach((e) => e.classList.remove("seg-hl"));
  activeSeg = activeSeg === k ? null : k;
  if (activeSeg == null) return;
  document
    .querySelectorAll(`.seg[data-seg="${activeSeg}"]`)
    .forEach((e) => e.classList.add("seg-hl"));
}

function segSpan(k, diff) {
  const s = el("span", "seg" + (diff ? " seg-diff" : ""));
  s.dataset.seg = k;
  s.addEventListener("click", (e) => {
    e.stopPropagation();
    activateSeg(k);
  });
  return s;
}

// Render the FORMAL text of the current sentence as tappable segments.
function renderFormalSegments(sentence) {
  const wrap = el("span");
  sentence.pairs.forEach((p, k) => {
    if (!p.f) return;
    const seg = segSpan(k, p.f !== p.c);
    seg.textContent = forScript(p.f);
    wrap.appendChild(seg);
  });
  return wrap;
}

// Render one colloquial sentence as ruby (char + jyutping). marks (optional) is
// the CJK-only grading result applied in order. When `withSegs` and the
// sentence has aligned pairs, the cells are grouped into tappable segments.
function renderColloquial(sentence, marks, withSegs = false) {
  const wrap = el("span", "cc-sentence");
  const jy = sentence.jyutping || [];
  let cjkSeen = 0;
  let charOffset = 0;

  const emitChars = (text, container) => {
    const display = forScriptAligned(text);
    const origChars = [...text];
    const dispChars = [...display];
    origChars.forEach((origCh, i) => {
      const ch = dispChars[i] ?? origCh;
      const isCjk = /[㐀-䶿一-鿿豈-﫿]/.test(ch);
      // Each character is a uniform, fixed-width cell: jyutping row on top,
      // glyph below — consistent gaps regardless of jyutping length.
      const cell = el("span", "cc" + (isCjk ? "" : " punct"));
      cell.appendChild(el("span", "jp", isCjk ? jy[charOffset] || "" : ""));
      cell.appendChild(el("span", "hz", ch));
      if (isCjk) {
        if (marks) {
          const m = marks[cjkSeen];
          if (m) cell.classList.add(m.ok ? "ok" : m.sound ? "soft" : "bad");
        }
        cjkSeen++;
      }
      charOffset++;
      container.appendChild(cell);
    });
  };

  if (withSegs && sentence.pairs) {
    sentence.pairs.forEach((p, k) => {
      if (!p.c) return;
      const seg = segSpan(k, p.f !== p.c);
      emitChars(p.c, seg);
      wrap.appendChild(seg);
    });
  } else {
    emitChars(sentence.colloquial, wrap);
  }
  return wrap;
}

function renderReader(marks) {
  const a = state.article;
  const cur = a.sentences[state.idx];
  activeSeg = null;

  $("#reader-title").textContent = forScript(a.title);
  $("#reader-src").textContent = a.source || "";
  const link = $("#orig-link");
  link.href = a.url || "#";
  link.textContent = t("readOriginal", state.lang);
  link.hidden = !a.url;
  $("#counter").textContent = t("sentenceOf", state.lang, state.idx + 1, a.sentences.length);
  $("#formal-label").textContent = t("formal", state.lang);
  $("#colloquial-label").textContent = t("colloquial", state.lang);

  const formalPane = $("#formal-pane");
  const ccPane = $("#colloquial-pane");
  const ilPane = $("#interleaved-pane");
  formalPane.innerHTML = "";
  ccPane.innerHTML = "";
  ilPane.innerHTML = "";

  const isCur = (s) => s.id === cur.id && (s.paragraph_id ?? 0) === (cur.paragraph_id ?? 0);

  paragraphsOf(a).forEach((para) => {
    const fp = el("p", "para");
    const cp = el("p", "para");
    para.forEach((s) => {
      const current = isCur(s);
      const spk = speakerLabel(s);

      // Written pane.
      const fspan = el("span", "sentence" + (current ? " current" : ""));
      if (spk) fspan.appendChild(el("span", "spk", spk + "："));
      if (current && s.pairs) fspan.appendChild(renderFormalSegments(s));
      else fspan.appendChild(document.createTextNode(forScript(s.formal)));
      fspan.addEventListener("click", () => jumpTo(a.sentences.indexOf(s)));
      fp.appendChild(fspan);

      // Spoken pane.
      const cspan = el("span", "sentence" + (current ? " current" : ""));
      if (spk) cspan.appendChild(el("span", "spk", spk + "："));
      if (s.colloquial && s.jyutping && s.jyutping.length) {
        cspan.appendChild(renderColloquial(s, current ? marks : null, current));
      } else {
        cspan.appendChild(document.createTextNode(forScript(s.colloquial || s.formal)));
      }
      cspan.addEventListener("click", () => jumpTo(a.sentences.indexOf(s)));
      cp.appendChild(cspan);

      // Interleaved view (narrow screens): written directly above spoken.
      const block = el("div", "il-block" + (current ? " current" : ""));
      if (spk) block.appendChild(el("div", "spk", spk));
      const ilFormal = el("div", "il-formal");
      if (current && s.pairs) ilFormal.appendChild(renderFormalSegments(s));
      else ilFormal.textContent = forScript(s.formal);
      block.appendChild(ilFormal);
      const ilCC = el("div", "il-colloquial");
      if (s.colloquial && s.jyutping && s.jyutping.length) {
        ilCC.appendChild(renderColloquial(s, current ? marks : null, current));
      } else {
        ilCC.textContent = forScript(s.colloquial || s.formal);
      }
      block.appendChild(ilCC);
      block.addEventListener("click", () => jumpTo(a.sentences.indexOf(s)));
      ilPane.appendChild(block);
    });
    formalPane.appendChild(fp);
    ccPane.appendChild(cp);
  });

  // English gloss for conversation lines (when the UI is in English).
  const gloss = $("#gloss");
  if (cur.en && state.lang === "en") {
    gloss.hidden = false;
    gloss.textContent = cur.en;
  } else {
    gloss.hidden = true;
  }

  // Hint that the phrase segments are tappable (only when there's a real diff).
  const hint = $("#tap-hint");
  hint.hidden = !(cur.pairs && cur.pairs.some((p) => p.f !== p.c));
  hint.textContent = t("tapHint", state.lang);

  // Keep the current sentence centred in EVERY visible pane — written and
  // spoken must stay in lockstep. Scrolls only the pane's own scrollbar
  // (never the page), so the two sides can't drift apart.
  for (const pane of [formalPane, ccPane, ilPane]) {
    if (pane.offsetParent) centerCurrent(pane);
  }

  updateControls();
}

// Scroll a pane so its .current sentence sits in the vertical centre. Uses
// rect deltas against the pane's own scroll position — scrollIntoView() would
// also scroll ancestors/the page, which is what let the panes drift.
function centerCurrent(pane) {
  const cur = pane.querySelector(".current");
  if (!cur) return;
  const pr = pane.getBoundingClientRect();
  const cr = cur.getBoundingClientRect();
  const delta = cr.top + cr.height / 2 - (pr.top + pr.height / 2);
  if (Math.abs(delta) < 2) return;
  pane.scrollTo({ top: pane.scrollTop + delta, behavior: "smooth" });
}

function jumpTo(i, keepAutoplay = false) {
  if (i < 0 || i >= state.article.sentences.length) return;
  state.idx = i;
  if (!keepAutoplay) {
    stopAutoplay();
    stopAudio();
    stopSpeaking();
  }
  clearFeedback();
  renderReader();
}

function next() {
  jumpTo(state.idx + 1);
}
function prev() {
  jumpTo(state.idx - 1);
}

// ── Transport actions ────────────────────────────────────────────────────────

// Pre-synthesised neural audio (edge-tts MP3s baked by the daily build). Much
// more natural than the browser's speechSynthesis voice, which stays as the
// offline / missing-clip fallback.
let audioEl = null;
let audioDone = null;
function articleHasAudio() {
  return !!(state.article && state.article.sentences.some((s) => s.audio));
}
function stopAudio() {
  if (!audioEl) return;
  const el = audioEl;
  const done = audioDone;
  audioEl = null;
  audioDone = null;
  try {
    el.pause();
  } catch {
    /* ignore */
  }
  if (done) done(); // release anyone awaiting playback (e.g. auto-play)
}
function playAudioFile(url, rate) {
  return new Promise((resolve, reject) => {
    const el = new Audio(url);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (audioEl === el) {
        audioEl = null;
        audioDone = null;
      }
      resolve();
    };
    audioEl = el;
    audioDone = done;
    el.playbackRate = rate;
    try {
      el.preservesPitch = true;
    } catch {
      /* older browsers */
    }
    el.onended = done;
    el.onerror = () => {
      if (settled) return;
      settled = true;
      if (audioEl === el) {
        audioEl = null;
        audioDone = null;
      }
      reject(new Error("audio failed"));
    };
    el.play().catch((e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
  });
}

async function play() {
  const s = state.article.sentences[state.idx];
  stopAudio();
  stopSpeaking();
  if (s.audio) {
    try {
      await playAudioFile("./audio/" + s.audio, state.speed);
      return;
    } catch {
      /* fall through to the browser voice */
    }
  }
  if (!state.tts.available) return;
  // Voice is re-resolved fresh inside speak() to avoid Chrome's stale-voice ->
  // English fallback bug.
  await speak(forScript(s.colloquial || s.formal), state.speed);
}

// Auto-play: listen through the whole article hands-free — each sentence is
// spoken, then the reader advances, until the end (or the learner stops it).
async function toggleAutoplay() {
  if (state.autoplay) {
    stopAutoplay();
    return;
  }
  if (!state.article || (!state.tts.available && !articleHasAudio())) return;
  const token = Symbol("autoplay");
  state.autoplay = token;
  $("#btn-auto").classList.add("active");
  clearFeedback();
  while (state.autoplay === token && state.article) {
    await play();
    if (state.autoplay !== token) return;
    if (state.idx + 1 >= state.article.sentences.length) break;
    await new Promise((r) => setTimeout(r, 500)); // a beat between sentences
    if (state.autoplay !== token) return;
    jumpTo(state.idx + 1, true);
  }
  if (state.autoplay === token) stopAutoplay();
}

function stopAutoplay() {
  if (!state.autoplay) return;
  state.autoplay = null;
  stopAudio();
  stopSpeaking();
  const btn = $("#btn-auto");
  if (btn) btn.classList.remove("active");
}

function clearFeedback() {
  const fb = $("#feedback");
  fb.hidden = true;
  fb.innerHTML = "";
}

async function record() {
  if (!state.asrOk || state.recording) return;
  stopAutoplay();
  stopAudio();
  const btn = $("#btn-record");
  btn.classList.add("active");
  const fb = $("#feedback");
  fb.hidden = false;
  fb.innerHTML = "";
  fb.appendChild(el("div", "status", t("listening", state.lang)));

  state.recording = listen({
    lang: "yue-Hant-HK",
    onStart: () => btn.classList.add("live"),
  });
  const heard = await state.recording.promise;
  state.recording = null;
  btn.classList.remove("active", "live");

  const s = state.article.sentences[state.idx];
  const result = gradeText(forScript(s.colloquial || s.formal), heard, normalizeChar, jyutpingOf);
  showFeedback(result, heard);
  renderReader(result.marks); // repaint colloquial with green/amber/red marks
  // No auto-advance — the learner moves on manually with Next (→) when ready.
}

function stopRecord() {
  if (state.recording) state.recording.stop();
}

function showFeedback(result, heard) {
  const fb = $("#feedback");
  fb.hidden = false;
  fb.innerHTML = "";
  const pct = Math.round(result.accuracy * 100);
  const row = el("div", "score-row");
  // Informational only — colour is a gentle cue, not a pass/fail gate.
  const badge = el("span", "score" + (pct >= 80 ? " good" : " mid"), `${t("score", state.lang)}: ${pct}%`);
  row.appendChild(badge);
  fb.appendChild(row);
  if (heard) fb.appendChild(el("div", "heard", `${t("heard", state.lang)}: ${heard}`));
}

// ── Controls / labels ────────────────────────────────────────────────────────
function updateControls() {
  $("#btn-play").querySelector(".lbl").textContent = t("play", state.lang);
  $("#btn-auto").querySelector(".lbl").textContent = t("autoplay", state.lang);
  $("#btn-record").querySelector(".lbl").textContent = t("record", state.lang);
  $("#btn-prev").querySelector(".lbl").textContent = t("prev", state.lang);
  $("#btn-next").querySelector(".lbl").textContent = t("next", state.lang);
  $("#btn-replay").querySelector(".lbl").textContent = t("replay", state.lang);
  $("#back-btn").textContent = t("back", state.lang);
  $("#kbd-hint").textContent = t("micHint", state.lang);

  $("#lbl-speed").textContent = t("speed", state.lang);
  $("#lbl-script").textContent = t("script", state.lang);
  $("#opt-trad").textContent = t("trad", state.lang);
  $("#opt-simp").textContent = t("simp", state.lang);

  $("#speed-sel").value = String(state.speed);
  $("#script-sel").value = state.script;
  $("#script-sel").disabled = !openccOk;
  const canPlay = state.tts.available || articleHasAudio();
  $("#btn-play").disabled = !canPlay;
  $("#btn-auto").disabled = !canPlay;
  $("#btn-record").hidden = !state.asrOk;

  // Degradation notes: only relevant when the pre-synthesised neural audio is
  // absent and playback would fall back to the browser voice.
  const noteTts = $("#note-tts");
  if (articleHasAudio()) {
    noteTts.hidden = true;
  } else if (!state.tts.available) {
    noteTts.hidden = false;
    noteTts.textContent = t("noTts", state.lang);
  } else if (!state.tts.isCantonese) {
    noteTts.hidden = false;
    noteTts.textContent = t("nonCantoneseVoice", state.lang, voiceName() || "");
  } else {
    noteTts.hidden = true;
  }
  $("#note-asr").hidden = state.asrOk;
  $("#note-asr").textContent = t("noAsr", state.lang);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("#theme-btn").textContent = state.theme === "dark" ? "☀︎" : "☾";
}

function renderLangButtons() {
  const box = $("#lang-switch");
  box.innerHTML = "";
  LANGS.forEach((l) => {
    const b = el("button", "lang-btn" + (l === state.lang ? " active" : ""), LANG_LABELS[l]);
    b.addEventListener("click", () => {
      state.lang = l;
      saveSettings();
      renderLangButtons();
      if (state.article) renderReader();
      else renderList();
    });
    box.appendChild(b);
  });
  $("#app-title").textContent = t("appTitle", state.lang);
  $("#tagline").textContent = t("tagline", state.lang);
}

// ── Wiring ───────────────────────────────────────────────────────────────────
function wire() {
  $("#back-btn").addEventListener("click", renderList);
  $("#btn-play").addEventListener("click", () => {
    stopAutoplay();
    play();
  });
  $("#btn-replay").addEventListener("click", () => {
    stopAutoplay();
    play();
  });
  $("#btn-auto").addEventListener("click", toggleAutoplay);
  $("#btn-next").addEventListener("click", next);
  $("#btn-prev").addEventListener("click", prev);
  $("#btn-record").addEventListener("click", () => (state.recording ? stopRecord() : record()));

  $("#speed-sel").addEventListener("change", (e) => {
    state.speed = parseFloat(e.target.value);
    saveSettings();
  });
  $("#script-sel").addEventListener("change", (e) => {
    state.script = e.target.value;
    saveSettings();
    if (state.article) renderReader();
    else renderList();
  });
  $("#theme-btn").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    saveSettings();
    applyTheme();
  });

  document.addEventListener("keydown", (e) => {
    if ($("#reader").hidden) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    if (e.code === "Space") {
      e.preventDefault();
      stopAutoplay();
      play();
    } else if (e.key === "r" || e.key === "R") {
      state.recording ? stopRecord() : record();
    } else if (e.key === "a" || e.key === "A") {
      toggleAutoplay();
    } else if (e.key === "ArrowRight") {
      next();
    } else if (e.key === "ArrowLeft") {
      prev();
    } else if (e.key === "Escape") {
      stopAutoplay();
      stopAudio();
      stopSpeaking();
    }
  });
}

async function main() {
  initOpenCC();
  applyTheme();
  renderLangButtons();
  wire();
  $("#banner").textContent = t("loading", state.lang);

  state.tts = await initTts();
  const [lessons, conversations] = await Promise.all([
    loadLessons(),
    loadConversations(),
    loadJyutDict(),
  ]);
  state.lessons = lessons;
  state.conversations = conversations;
  renderList();
  updateControls();
  window.__CFL_READY = true; // signal for e2e tests
}

main();
