// app.js — the karaoke reader: data loading, side-by-side panes, jyutping ruby,
// transport, toggles, keyboard shortcuts, tri-lingual UI, and graceful
// degradation for missing TTS / speech-recognition.

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
const SETTINGS_KEY = "cfl.settings.v1";
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
  article: null,
  idx: 0,
  tts: { available: false, voices: {} },
  asrOk: asrAvailable(),
  recording: null,
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

// ── Data loading: backend if configured, else bundled sample ─────────────────
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

// ── Rendering: article list ──────────────────────────────────────────────────
function renderList() {
  state.article = null;
  $("#reader").hidden = true;
  $("#list").hidden = false;

  const banner = $("#banner");
  if (state.lessons.sample) {
    banner.textContent = t("offlineDemo", state.lang);
  } else {
    banner.textContent = `${state.lessons.source || ""}${state.lessons.date ? " · " + state.lessons.date : ""}`;
  }

  const list = $("#cards");
  list.innerHTML = "";
  $("#list-title").textContent = t("pickArticle", state.lang);
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
}

// ── Rendering: reader ────────────────────────────────────────────────────────
function openArticle(a) {
  state.article = a;
  state.idx = 0;
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

// Render one colloquial sentence as ruby (char + jyutping). marks (optional) is
// the CJK-only grading result applied in order.
function renderColloquial(sentence, marks) {
  const wrap = el("span", "cc-sentence");
  const chars = [...forScript(sentence.colloquial)];
  const jy = sentence.jyutping || [];
  let cjkSeen = 0;
  chars.forEach((ch, i) => {
    const isCjk = /[㐀-䶿一-鿿豈-﫿]/.test(ch);
    // Each character is a uniform, fixed-width cell: jyutping row on top, glyph
    // below — consistent gaps regardless of jyutping length.
    const cell = el("span", "cc" + (isCjk ? "" : " punct"));
    cell.appendChild(el("span", "jp", isCjk ? jy[i] || "" : ""));
    cell.appendChild(el("span", "hz", ch));
    if (isCjk) {
      if (marks) {
        const m = marks[cjkSeen];
        if (m) cell.classList.add(m.ok ? "ok" : m.sound ? "soft" : "bad");
      }
      cjkSeen++;
    }
    wrap.appendChild(cell);
  });
  return wrap;
}

function renderReader(marks) {
  const a = state.article;
  const cur = a.sentences[state.idx];

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
  formalPane.innerHTML = "";
  ccPane.innerHTML = "";

  paragraphsOf(a).forEach((para) => {
    const fp = el("p", "para");
    const cp = el("p", "para");
    para.forEach((s) => {
      const isCur = s.id === cur.id && s.paragraph_id === cur.paragraph_id;
      const fspan = el("span", "sentence" + (isCur ? " current" : ""), forScript(s.formal));
      fspan.addEventListener("click", () => jumpTo(a.sentences.indexOf(s)));
      fp.appendChild(fspan);

      const cspan = el("span", "sentence" + (isCur ? " current" : ""));
      if (s.colloquial && s.jyutping && s.jyutping.length) {
        cspan.appendChild(renderColloquial(s, isCur ? marks : null));
      } else {
        cspan.textContent = forScript(s.colloquial || s.formal);
      }
      cspan.addEventListener("click", () => jumpTo(a.sentences.indexOf(s)));
      cp.appendChild(cspan);
    });
    formalPane.appendChild(fp);
    ccPane.appendChild(cp);
  });

  // Scroll current sentence into view.
  const curEl = ccPane.querySelector(".current");
  if (curEl) curEl.scrollIntoView({ block: "center", behavior: "smooth" });

  updateControls();
}

function jumpTo(i) {
  if (i < 0 || i >= state.article.sentences.length) return;
  state.idx = i;
  stopSpeaking();
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
async function play() {
  if (!state.tts.available) return;
  const s = state.article.sentences[state.idx];
  // Voice is re-resolved fresh inside speak() to avoid Chrome's stale-voice ->
  // English fallback bug.
  await speak(forScript(s.colloquial || s.formal), state.speed);
}

function clearFeedback() {
  const fb = $("#feedback");
  fb.hidden = true;
  fb.innerHTML = "";
}

async function record() {
  if (!state.asrOk || state.recording) return;
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
  $("#btn-play").disabled = !state.tts.available;
  $("#btn-record").hidden = !state.asrOk;

  // Degradation notes: no voice at all, OR only a non-Cantonese fallback voice.
  const noteTts = $("#note-tts");
  if (!state.tts.available) {
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
  $("#btn-play").addEventListener("click", play);
  $("#btn-replay").addEventListener("click", play);
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
      play();
    } else if (e.key === "r" || e.key === "R") {
      state.recording ? stopRecord() : record();
    } else if (e.key === "ArrowRight") {
      next();
    } else if (e.key === "ArrowLeft") {
      prev();
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
  const [lessons] = await Promise.all([loadLessons(), loadJyutDict()]);
  state.lessons = lessons;
  renderList();
  updateControls();
  window.__CFL_READY = true; // signal for e2e tests
}

main();
