// numbers.js — context-aware Arabic-numeral → Chinese-character readings, the
// way a Hong Kong news anchor says them aloud. Dependency-free ES module shared
// by the browser (grader normalisation) and the Node build (spelling out the
// numbers in the spoken pane so jyutping / TTS / grading all work on them).
//
// The context decides HOW a number is read:
//   2020年   -> 二零二零年     (years are read digit-by-digit)
//   2020個   -> 二千零二十個   (quantities are read as cardinals)
//   15%      -> 百分之十五
//   3.5%     -> 百分之三點五
//   7月3日   -> 七月三日       (dates are cardinals)
//   2846 3222 (8+ digits, no unit) -> digit-by-digit (phone numbers, codes)

const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const SECTION_UNITS = ["", "萬", "億", "兆"];
const PLACE_UNITS = ["", "十", "百", "千"];

// Read a digit string one digit at a time (years, phone numbers): 2020 -> 二零二零.
export function digitsReading(digits) {
  return [...String(digits)].map((d) => DIGITS[+d] ?? d).join("");
}

// Read an integer string as a cardinal with 萬/億 grouping: 2020 -> 二千零二十.
export function cardinalReading(digits) {
  const s = String(digits).replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(s)) return digitsReading(digits);
  if (s === "0") return "零";
  if (s.length > 16) return digitsReading(s); // beyond 兆兆 — just spell it

  // Split into 4-digit sections from the right.
  const sections = [];
  for (let end = s.length; end > 0; end -= 4) {
    sections.unshift(s.slice(Math.max(0, end - 4), end));
  }

  let out = "";
  let needZero = false;
  sections.forEach((sec, idx) => {
    const unit = SECTION_UNITS[sections.length - 1 - idx];
    const n = parseInt(sec, 10);
    if (n === 0) {
      // A whole zero section forces a 零 before the next non-zero section.
      if (out) needZero = true;
      return;
    }
    if (out && (needZero || sec[0] === "0")) out += "零";
    needZero = false;
    out += sectionReading(sec, !out);
    out += unit;
  });
  return out;
}

// Read one 0–9999 section. `isFirst` allows the 10-19 -> 十X contraction.
function sectionReading(sec, isFirst) {
  const n = parseInt(sec, 10);
  const digits = String(n); // strip leading zeros within the section
  let out = "";
  let zeroPending = false;
  for (let i = 0; i < digits.length; i++) {
    const d = +digits[i];
    const place = digits.length - 1 - i;
    if (d === 0) {
      if (out) zeroPending = true;
      continue;
    }
    if (zeroPending) {
      out += "零";
      zeroPending = false;
    }
    // 10-19 at the very start of the whole number: 十三 not 一十三.
    if (d === 1 && place === 1 && i === 0 && isFirst && digits.length === 2) {
      out += "十";
    } else {
      out += DIGITS[d] + PLACE_UNITS[place];
    }
  }
  return out;
}

// Decimal: "3.5" -> 三點五 (integer part cardinal, fraction digit-by-digit).
export function decimalReading(intPart, fracPart) {
  return cardinalReading(intPart) + "點" + digitsReading(fracPart);
}

// Characters that mark the preceding number as a YEAR when it has 3+ digits.
const YEAR_SUFFIX = "年";
// Range connectors between two numbers (2020至2021年 — both read as years).
const RANGE_CONNECTORS = new Set(["至", "到", "-", "–", "—", "－", "~", "～"]);

function nextMeaningfulChar(text, from) {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === " " || ch === "　") continue;
    return { ch, index: i };
  }
  return { ch: "", index: -1 };
}

// Decide the reading for one matched number given what follows it.
function readNumber(raw, following) {
  // Percent: the % is part of the match.
  if (raw.endsWith("%")) {
    const num = raw.slice(0, -1).replace(/,/g, "");
    const [intPart, fracPart] = num.split(".");
    return "百分之" + (fracPart ? decimalReading(intPart, fracPart) : cardinalReading(intPart));
  }

  const hasComma = raw.includes(",");
  const num = raw.replace(/,/g, "");
  const [intPart, fracPart] = num.split(".");

  if (fracPart !== undefined) return decimalReading(intPart, fracPart);

  // What character follows (skipping spaces)?
  let { ch, index } = nextMeaningfulChar(following, 0);

  // Look through a range connector to the unit after the second number:
  // "2020至2021年" — the 至2021年 tells us 2020 is a year too.
  let viaRange = false;
  if (RANGE_CONNECTORS.has(ch)) {
    const rest = following.slice(index + 1);
    const m = rest.match(/^\s*\d[\d,]*/);
    if (m) {
      const after = nextMeaningfulChar(rest, m[0].length + (rest.length - rest.trimStart().length));
      if (after.ch === YEAR_SUFFIX) {
        ch = YEAR_SUFFIX;
        viaRange = true;
      }
    }
  }

  // Years: a 3+ digit number followed by 年 (directly, or through a range
  // connector) reads digit-by-digit — 2020年 -> 二零二零年, 1997年 -> 一九九七年.
  // 2-digit + 年 stays cardinal (五年, 三十年 — durations / decades).
  void viaRange;
  if (ch === YEAR_SUFFIX && !hasComma && intPart.length >= 3) {
    return digitsReading(intPart);
  }

  // Long unit-less digit runs (8+, no comma grouping): phone numbers, codes.
  if (!hasComma && intPart.length >= 8) return digitsReading(intPart);

  return cardinalReading(intPart);
}

const NUM_RE = /\d[\d,]*(?:\.\d+)?%?/g;

/**
 * Replace every Arabic-numeral run in `text` with its Chinese-character
 * reading, using the surrounding context (年/月/%/…) to pick year vs cardinal.
 * `lookahead` is optional extra context that FOLLOWS text (used when converting
 * a segment whose unit character lives in the next segment).
 */
export function spellOutNumbers(text, lookahead = "") {
  const s = String(text || "");
  if (!/\d/.test(s)) return s;
  let out = "";
  let last = 0;
  const full = s + String(lookahead || "");
  for (const m of s.matchAll(NUM_RE)) {
    const start = m.index;
    const raw = m[0];
    out += s.slice(last, start);
    const following = full.slice(start + raw.length);
    let reading = readNumber(raw, following);
    // Codes and tickers — a number straight after a colon (TYO:9433) reads
    // digit-by-digit, never as a quantity.
    const before = s.slice(0, start);
    if (/[:：]$/.test(before) && !raw.includes(".") && !raw.endsWith("%")) {
      reading = digitsReading(raw.replace(/,/g, ""));
    }
    // Special case: a short number that is the SECOND half of a year range —
    // "2020至21年" -> 二零二零至二一年 (the 21 reads digit-by-digit too).
    if (
      /^\d{1,2}$/.test(raw) &&
      nextMeaningfulChar(following, 0).ch === YEAR_SUFFIX &&
      /\d{3,4}\s*[至到\-–—－~～]\s*$/.test(s.slice(0, start))
    ) {
      reading = digitsReading(raw);
    }
    out += reading;
    last = start + raw.length;
  }
  out += s.slice(last);
  return out;
}

export function hasDigits(text) {
  return /\d/.test(String(text || ""));
}

// Split text into number / non-number runs: "降至54.1，" ->
// [{text:"降至"}, {text:"54.1", num:true}, {text:"，"}]. Used by the build to
// keep aligned pairs fine-grained around spelled-out numbers.
export function splitByNumbers(text) {
  const s = String(text || "");
  const out = [];
  let last = 0;
  for (const m of s.matchAll(NUM_RE)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), num: false });
    out.push({ text: m[0], num: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), num: false });
  return out;
}

// Normalise LLM-produced digit typography on the SPOKEN side so the number
// reader sees clean runs: full-width digits/percent, and full-width commas or
// dots INSIDE a number (3，384 → 3,384 — otherwise the run splits and reads
// as two separate numbers).
export function normalizeDigits(text) {
  let s = String(text || "");
  s = s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30));
  s = s.replace(/(\d)，(?=\d)/g, "$1,");
  s = s.replace(/(\d)．(?=\d)/g, "$1.");
  s = s.replace(/(\d)％/g, "$1%");
  return s;
}
