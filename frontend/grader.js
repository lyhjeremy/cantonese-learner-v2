// grader.js — on-device speech grading.
// Recognition: browser SpeechRecognition (Chrome), Cantonese (yue-Hant-HK).
// Scoring: lenient, script-normalised, character-level compare ported from the
// Mandarin Reader's `grade()`. Aligns via edit-distance (not a naive zip) so one
// missed character doesn't cascade, compares in a common script so 學 == 学, AND
// accepts homophones — if the recogniser hears a different character with the
// same/similar Cantonese pronunciation, it still counts (right sound, wrong
// character = a soft/amber match).
//
// V2: the recogniser often returns Arabic digits ("2020年") while the target
// displays the anchor reading (二零二零年), so the heard text is passed through
// the same context-aware numeral speller before comparing.

import { spellOutNumbers } from "./numbers.js";

function isCjkIdeograph(ch) {
  const o = ch.codePointAt(0);
  return (
    (o >= 0x4e00 && o <= 0x9fff) ||
    (o >= 0x3400 && o <= 0x4dbf) ||
    (o >= 0xf900 && o <= 0xfaff) ||
    (o >= 0x20000 && o <= 0x2ebef) || // Extensions B-F (Cantonese 𨋢 etc.)
    (o >= 0x2f800 && o <= 0x2fa1f) ||
    (o >= 0x30000 && o <= 0x3134a)
  );
}

function cjkOnly(text) {
  return [...String(text || "")].filter(isCjkIdeograph);
}

// Spoken-Cantonese -> standard-written equivalents. Browser speech recognition
// usually returns standard forms even when a Cantonese sentence is read aloud
// (是 for 係, 的 for 嘅, 了 for 咗 …). We collapse both the target and the heard
// text through this map before comparing, so a correct read is not penalised for
// the register the recogniser happens to output. Applying the SAME map to both
// sides can only merge equivalent characters — it never breaks a real match.
const COLLOQ_TO_STD = {
  係: "是", 喺: "在", 嘅: "的", 咗: "了", 唔: "不", 冇: "沒", 佢: "他", 哋: "們",
  畀: "給", 食: "吃", 飲: "喝", 睇: "看", 嚟: "來", 諗: "想", 搵: "找", 揾: "找",
  攞: "拿", 郁: "動", 嗰: "那", 呢: "這", 同: "和", 講: "說", 話: "說", 乜: "甚",
};

// Edit-distance alignment with backtrace. Returns pairs over (a, b): each entry
// is {ai, bj, match} where ai/bj are indices (or -1 for an insert/delete), and
// `match` is true when a[ai] === b[bj]. Diagonal is preferred so a wrong
// character aligns with the character it was misheard as (enabling homophone
// checks), rather than showing up as a delete + insert.
function alignSequences(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j - 1] + cost, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }
  const pairs = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    if (dp[i][j] === dp[i - 1][j - 1] + cost) {
      pairs.push({ ai: i - 1, bj: j - 1, match: cost === 0 });
      i--;
      j--;
    } else if (dp[i][j] === dp[i - 1][j] + 1) {
      pairs.push({ ai: i - 1, bj: -1, match: false });
      i--;
    } else {
      pairs.push({ ai: -1, bj: j - 1, match: false });
      j--;
    }
  }
  while (i > 0) pairs.push({ ai: --i, bj: -1, match: false });
  while (j > 0) pairs.push({ ai: -1, bj: --j, match: false });
  return pairs;
}

// Two characters are homophones if any of their toneless jyutping readings
// coincide. jyutpingOf(char) -> string[] of toneless syllables, or null/[]
// when unknown (then no leniency is applied).
function homophone(t, h, jyutpingOf) {
  if (!jyutpingOf) return false;
  const ts = jyutpingOf(t);
  const hs = jyutpingOf(h);
  if (!ts || !hs || !ts.length || !hs.length) return false;
  return ts.some((x) => hs.includes(x));
}

// Grade the heard transcript against the target sentence.
//   normalizeChar(ch) -> ch : maps both sides into a common script (e.g. t2s) so
//     Traditional/Simplified differences don't count as errors. Identity default.
//   jyutpingOf(ch) -> string[] : toneless readings, for homophone leniency.
// Returns { accuracy, heard, marks:[{char, ok, sound}] } where ok = exact match
// (green) and sound = homophone match (amber); both count toward accuracy.
export function gradeText(target, heard, normalizeChar = (c) => c, jyutpingOf = null) {
  // Canonicalise: collapse spoken->standard forms, then apply the caller's
  // script normaliser (e.g. Traditional->Simplified) so 學 == 学 too.
  const canon = (ch) => normalizeChar(COLLOQ_TO_STD[ch] || ch);
  const orig = cjkOnly(target);
  // Digits in the transcript become their spoken reading (2020年 -> 二零二零年)
  // so reading a spelled-out number correctly is never marked wrong.
  const heardChars = cjkOnly(spellOutNumbers(heard));
  const pairs = alignSequences(orig.map(canon), heardChars.map(canon));
  const marks = orig.map((char) => ({ char, ok: false, sound: false }));
  for (const p of pairs) {
    if (p.ai < 0) continue; // an extra heard character with no target slot
    if (p.match) {
      marks[p.ai].ok = true;
    } else if (p.bj >= 0 && homophone(orig[p.ai], heardChars[p.bj], jyutpingOf)) {
      marks[p.ai].sound = true; // right sound, wrong character
    }
  }
  const correct = marks.filter((m) => m.ok || m.sound).length;
  const accuracy = orig.length ? correct / orig.length : 0;
  return { accuracy, heard: heardChars.join(""), marks };
}

// ── SpeechRecognition wrapper ────────────────────────────────────────────────

export function asrAvailable() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Start listening; resolves with the final transcript. Pause-tolerant: it keeps
// recording across short pauses (e.g. commas) and only finalises after
// `silenceMs` of no new speech, or when the caller calls stop(). This fixes the
// "cuts me off mid-sentence when I pause" problem.
//   silenceMs   how long a pause is allowed before finishing (default 2.5s)
//   minStartMs  grace period to begin speaking before silence can trigger
//   maxMs       hard cap so we always resolve
export function listen({ lang = "yue-Hant-HK", onStart, silenceMs = 3500, preSpeechMs = 8000, maxMs = 45000 } = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return { promise: Promise.resolve(""), stop() {} };

  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true; // needed to detect ongoing speech during pauses
  rec.maxAlternatives = 1;
  rec.continuous = true; // keep going across pauses instead of stopping

  let settled = false;
  let manualStop = false;
  let hasSpoken = false; // true once we've heard any actual speech
  let committed = ""; // finals from previous (restarted) sessions
  let sessionFinal = ""; // finals from the current session
  let interim = "";
  let restarts = 0;
  const startTime = Date.now();
  let lastSpeech = startTime;
  let watchdog = null;
  let startedOnce = false;

  // Should we stop now? Give a long grace to BEGIN speaking; once speaking, only
  // stop after a real pause (silenceMs). This is what lets the learner pause to
  // think between characters without being cut off.
  const shouldStop = (now) => {
    if (now - startTime > maxMs) return true;
    if (!hasSpoken) return now - startTime > preSpeechMs;
    return now - lastSpeech > silenceMs;
  };

  const transcriptNow = () => (committed + sessionFinal + interim).trim();

  const promise = new Promise((resolve) => {
    const finalize = () => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      resolve(transcriptNow());
    };

    rec.onstart = () => {
      if (!startedOnce) {
        startedOnce = true;
        onStart && onStart();
      }
    };

    rec.onresult = (e) => {
      let f = "";
      let it = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) f += r[0].transcript;
        else it += r[0].transcript;
      }
      sessionFinal = f;
      interim = it;
      if ((committed + f + it).trim()) {
        hasSpoken = true;
        lastSpeech = Date.now(); // only reset the pause clock on real speech
      }
    };

    rec.onerror = (e) => {
      // Fatal permission/hardware errors: give up. Others (no-speech, network,
      // aborted) fall through to onend, which restarts or finalises.
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(e.error)) {
        manualStop = true;
        finalize();
      }
    };

    rec.onend = () => {
      if (settled) return;
      if (manualStop || shouldStop(Date.now()) || restarts > 60) {
        finalize();
      } else {
        // Chrome ended the session on its own but the learner hasn't paused
        // long enough (or hasn't started yet) — keep listening.
        committed += sessionFinal;
        sessionFinal = "";
        interim = "";
        restarts += 1;
        try {
          rec.start();
        } catch {
          finalize();
        }
      }
    };

    watchdog = setInterval(() => {
      if (shouldStop(Date.now())) {
        manualStop = true;
        try {
          rec.stop();
        } catch {
          finalize();
        }
      }
    }, 250);

    try {
      rec.start();
    } catch {
      finalize();
    }
  });

  return {
    promise,
    stop() {
      manualStop = true;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
