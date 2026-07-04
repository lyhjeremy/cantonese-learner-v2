// tts.js — Cantonese text-to-speech via the browser SpeechSynthesis API.
// Free, on-device, no backend. Uses a single Cantonese voice (prefers "Sinji",
// the macOS zh-HK voice) and degrades gracefully when none is available.
//
// IMPORTANT: Chrome invalidates SpeechSynthesisVoice objects when its voice list
// reloads, so a cached object is silently ignored and playback falls back to the
// default (often English) voice. We store the voice by voiceURI and RE-RESOLVE a
// fresh object from getVoices() at speak time — never cache the object itself.

function getVoicesNow() {
  const synth = window.speechSynthesis;
  return synth ? synth.getVoices() : [];
}

function loadVoices() {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) return resolve([]);
    const have = synth.getVoices();
    if (have.length) return resolve(have);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(synth.getVoices());
    };
    synth.onvoiceschanged = finish;
    setTimeout(finish, 1200);
  });
}

// Rank a voice for Cantonese suitability (higher = better). Non-Chinese -> -1.
// Sinji (macOS zh-HK) is preferred outright.
function cantoneseScore(v) {
  const lang = (v.lang || "").toLowerCase().replace("_", "-");
  const name = (v.name || "").toLowerCase();
  if (/sinji/.test(name)) return 6;
  if (lang === "zh-hk" || lang.startsWith("yue")) return 5;
  if (/cantonese|粵|aasing|aacantonese/.test(name)) return 5;
  if (lang.includes("hk")) return 4;
  if (lang.startsWith("zh")) return 1; // Mandarin voice — usable but not ideal
  return -1; // not Chinese at all
}

// Chosen voice, stored by URI (stable across list reloads).
let selection = { available: false, isCantonese: false, uri: null, name: null, lang: null };

function pickVoice(voices) {
  const ranked = voices
    .map((v) => ({ v, s: cantoneseScore(v) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  if (!ranked.length) return { available: false, isCantonese: false, uri: null, name: null, lang: null };
  const best = ranked[0].v;
  return {
    available: true,
    isCantonese: ranked[0].s >= 4,
    uri: best.voiceURI,
    name: best.name,
    lang: best.lang,
  };
}

export async function initTts() {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    return { available: false, isCantonese: false, name: null };
  }
  selection = pickVoice(await loadVoices());
  return { available: selection.available, isCantonese: selection.isCantonese, name: selection.name };
}

// Re-resolve a fresh voice object from the current list (by URI), re-picking if
// the list changed, then falling back to the best Chinese voice available.
function resolveVoice() {
  const voices = getVoicesNow();
  if (selection.uri) {
    const byUri = voices.find((v) => v.voiceURI === selection.uri);
    if (byUri) return byUri;
    const byName = voices.find((v) => v.name === selection.name);
    if (byName) return byName;
  }
  selection = pickVoice(voices);
  if (selection.uri) {
    const v = voices.find((x) => x.voiceURI === selection.uri || x.name === selection.name);
    if (v) return v;
  }
  const ranked = voices
    .map((v) => ({ v, s: cantoneseScore(v) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  return ranked.length ? ranked[0].v : null;
}

// Speak `text` at `rate` (the speed toggle). Resolves when done. Returns the
// resolved voice name (for diagnostics).
export function speak(text, rate = 1.0) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) return resolve(null);
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = resolveVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = "zh-HK";
    }
    u.rate = rate;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(voice ? voice.name : null);
    };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
  });
}

// The name of the voice that will be used (for the degradation note).
export function voiceName() {
  const v = resolveVoice();
  return v ? v.name : null;
}

export function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}
