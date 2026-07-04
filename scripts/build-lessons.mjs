// build-lessons.mjs — KEYLESS daily lesson builder. Runs in GitHub Actions (or
// locally). Fetches free RSS finance news, chunks it, converts to rough spoken
// Cantonese (rule-based), adds jyutping (to-jyutping), and writes
// frontend/data/today.json. Fail-soft: on ANY error it writes nothing and exits
// 0, so the site falls back to the bundled sample lessons.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getJyutpingList } from "to-jyutping";
import { fetchRssArticles, fetchArticleBody, newsScore } from "../backend/rss.js";
import { paragraphsToUnits, translateColloquial } from "../backend/convert.js";
import { cjkCount } from "../backend/chunk.js";
import { toColloquial, changed } from "../backend/convert-rules.js";

const MIN_BODY_CHARS = 80; // prefer longer articles (full story bodies)
const MAX_ARTICLES = 12; // how many lessons per day

// Pick up to `max` articles with a balanced spread across sources: rank each
// source's articles by newsworthiness, then round-robin across sources. This
// guarantees variety (local / China / world / finance / sport) rather than a
// dozen finance stories.
function pickBalanced(pool, max) {
  const bySource = new Map();
  for (const a of pool) {
    if (!bySource.has(a.source)) bySource.set(a.source, []);
    bySource.get(a.source).push(a);
  }
  for (const list of bySource.values()) {
    list.sort((x, y) => newsScore(y.title, y.body) - newsScore(x.title, x.body));
  }
  const queues = [...bySource.values()];
  const picked = [];
  let progressed = true;
  while (picked.length < max && progressed) {
    progressed = false;
    for (const q of queues) {
      if (!q.length) continue;
      picked.push(q.shift());
      progressed = true;
      if (picked.length >= max) break;
    }
  }
  return picked;
}

// Optional higher-quality rewrite: if an ANTHROPIC_API_KEY is present (e.g. a
// GitHub Actions secret), translate via Claude; otherwise stay keyless and use
// the rule-based converter.
const LLM_KEY = process.env.ANTHROPIC_API_KEY || "";
const LLM_MODEL = process.env.CONVERT_MODEL || undefined;

const OUT = fileURLToPath(new URL("../frontend/data/today.json", import.meta.url));

// Per-character jyutping aligned to the string (non-Cantonese -> "").
function jyutpingFor(text) {
  return getJyutpingList(text).map(([, jyut]) => jyut || "");
}

async function buildArticle(a, idx) {
  const units = paragraphsToUnits(a.body);
  // Prefer the LLM rewrite when a key is configured; fall back to rules.
  let llm = null;
  if (LLM_KEY) {
    llm = await translateColloquial(units.map((u) => u.formal), LLM_KEY, { model: LLM_MODEL });
  }
  const method = llm ? "llm" : "rules";
  let anyChanged = false;
  const sentences = units.map((u, i) => {
    const colloquial = (llm && llm[i]) || toColloquial(u.formal);
    if (changed(u.formal, colloquial)) anyChanged = true;
    return {
      id: i,
      paragraph_id: u.paragraph_id,
      formal: u.formal,
      colloquial,
      jyutping: jyutpingFor(colloquial),
    };
  });
  return {
    id: `a${idx}`,
    title: a.title,
    source: a.source,
    url: a.url,
    publishedAt: a.publishedAt,
    converted: anyChanged,
    method,
    sentences,
  };
}

async function main() {
  // Pool candidates across all RTHK topic feeds, enrich with full article bodies.
  const candidates = await fetchRssArticles({ perFeed: 8, minChars: 10 });
  if (!candidates.length) {
    console.log("No studyable articles fetched — leaving today.json absent (sample fallback).");
    return;
  }
  for (const a of candidates) {
    if (a.url) {
      const full = await fetchArticleBody(a.url);
      if (cjkCount(full) > cjkCount(a.body)) a.body = full; // use fuller story text
    }
  }
  // Prefer substantial bodies; relax if too few qualify.
  let pool = candidates.filter((a) => cjkCount(a.body) >= MIN_BODY_CHARS);
  if (pool.length < 6) pool = candidates;
  const articles = pickBalanced(pool, MAX_ARTICLES);
  console.log("Selected:", articles.map((a) => `[${a.source}] ${a.title}`).join(" | "));
  const built = await Promise.all(articles.map((a, i) => buildArticle(a, i)));
  const usedLlm = built.some((a) => a.method === "llm");
  const lessons = {
    // NOTE: date is stamped by the runner via env to stay deterministic here.
    date: process.env.BUILD_DATE || "",
    source: "RTHK 香港電台",
    method: usedLlm ? "llm" : "rules",
    note: usedLlm
      ? "Converted to spoken Cantonese by Claude (Opus 4.8) from live RSS news."
      : "Auto-converted to Cantonese (rule-based, rough) from live RSS news.",
    generatedAt: process.env.BUILD_TIME || "",
    articles: built,
  };
  await writeFile(OUT, JSON.stringify(lessons, null, 2), "utf-8");
  console.log(
    `Wrote today.json: ${lessons.articles.length} articles, ` +
      `${lessons.articles.reduce((n, a) => n + a.sentences.length, 0)} sentences from ${lessons.source} ` +
      `(rewrite: ${lessons.method}${LLM_KEY ? "" : " — no ANTHROPIC_API_KEY, using rules"}).`,
  );
}

main().catch((err) => {
  console.error("build-lessons failed (soft):", String(err));
  process.exit(0); // never fail the deploy; site falls back to sample.
});
