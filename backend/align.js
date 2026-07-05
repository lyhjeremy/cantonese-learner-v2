// align.js — deterministic written↔spoken phrase alignment. Given a formal
// sentence and its colloquial rewrite (from ANY source — an LLM that can't be
// trusted to emit aligned pairs, or a repaired sentence), produce the
// {f, c} segment pairs that power the tap-to-compare UI, via a character-level
// LCS alignment. Invariants: concat(f) === formal, concat(c) === colloquial.

/**
 * Align two sentences into segment pairs. Runs of common characters become
 * identity segments; everything between becomes changed {f, c} pairs. Tiny
 * one-character identity islands between changed segments are merged into
 * them so the UI shows phrases, not confetti. Returns null on empty input.
 */
export function alignPairs(formal, colloquial) {
  const a = [...String(formal || "")];
  const b = [...String(colloquial || "")];
  if (!a.length || !b.length) return null;
  const m = a.length;
  const n = b.length;

  // LCS lengths, dp[i][j] = LCS of a[i:], b[j:].
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the alignment into an op list.
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ t: "=", ch: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: "-", ch: a[i] });
      i++;
    } else {
      ops.push({ t: "+", ch: b[j] });
      j++;
    }
  }
  while (i < m) ops.push({ t: "-", ch: a[i++] });
  while (j < n) ops.push({ t: "+", ch: b[j++] });

  // Group ops into segments.
  const segs = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === "=") {
      let s = "";
      while (k < ops.length && ops[k].t === "=") s += ops[k++].ch;
      segs.push({ f: s, c: s });
    } else {
      let f = "";
      let c = "";
      while (k < ops.length && ops[k].t !== "=") {
        if (ops[k].t === "-") f += ops[k].ch;
        else c += ops[k].ch;
        k++;
      }
      segs.push({ f, c });
    }
  }

  // Merge one-character identity islands sandwiched between changed segments
  // (LCS artifacts — a stray shared 一/個 inside a rewritten phrase).
  for (let x = 1; x < segs.length - 1; x++) {
    const s = segs[x];
    const prev = segs[x - 1];
    const next = segs[x + 1];
    if (s.f === s.c && [...s.f].length <= 1 && prev.f !== prev.c && next.f !== next.c) {
      segs[x - 1] = { f: prev.f + s.f + next.f, c: prev.c + s.c + next.c };
      segs.splice(x, 2);
      x--;
    }
  }
  return segs;
}
