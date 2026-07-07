// build-lessons.mjs — daily lesson builder. Runs in GitHub Actions (or
// locally). Fetches free RTHK RSS news (plus an optional secondary feed, e.g. a
// WeChat 公眾號 bridge), chunks it, converts each sentence to spoken Cantonese
// (Claude rewrite + independent Claude verifier when ANTHROPIC_API_KEY is set;
// the hardened rule-based converter otherwise), spells out numerals the way an
// anchor reads them (2020年 -> 二零二零年, 2020個 -> 二千零二十個), adds
// jyutping (to-jyutping) and aligned written↔spoken phrase pairs, and writes
// frontend/data/today.json. Fail-soft: on ANY error it writes nothing and exits
// 0, so the site falls back to the bundled sample lessons.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getJyutpingList } from "to-jyutping";
import {
  fetchRssArticles,
  fetchArticleBody,
  fetchCustomFeedArticles,
  newsScore,
} from "../backend/rss.js";
import { paragraphsToUnits, convertArticle, makeClient } from "../backend/convert.js";
import { ghConvertSentences } from "../backend/ghmodels.js";
import { alignPairs } from "../backend/align.js";
import { fetchGoogleNewsArticles, DEFAULT_QUERY } from "../backend/gnews.js";
import { cjkCount } from "../backend/chunk.js";
import { stripJunkParagraphs } from "../backend/junk.js";
import { toColloquialSegments } from "../backend/convert-rules.js";
import { spellOutNumbers, splitByNumbers } from "../frontend/numbers.js";

const MIN_BODY_CHARS = 80; // prefer longer articles (full story bodies)
const MAX_ARTICLES = 12; // how many lessons per day
const MAX_WECHAT = 4; // guaranteed slots for the secondary feed

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

// Rewrite quality tiers, best available wins:
//   1. ANTHROPIC_API_KEY        — Claude rewrite + verifier, semantic pairs.
//   2. GITHUB_TOKEN (free)      — GitHub Models rewrite + review pass; pairs
//                                 computed locally with the LCS aligner. Zero
//                                 cost on public-repo Actions.
//   3. neither                  — hardened rule-based converter.
const LLM_KEY = process.env.ANTHROPIC_API_KEY || "";
const LLM_MODEL = process.env.CONVERT_MODEL || undefined;
const GH_TOKEN = process.env.GH_MODELS_TOKEN || process.env.GITHUB_TOKEN || "";
const GH_MODEL_OVERRIDE = process.env.GH_MODELS_MODEL || undefined;

// Secondary source. Preferred: a WeChat 公眾號 → RSS bridge (WECHAT_FEED_URL).
// Fallback when no bridge is configured: scrape the public web via Google News
// for Chinese coverage of the topic (default 貝恩資本 — Bain Capital), so the
// Bain-relevant lessons work with zero setup. Set BAIN_NEWS_QUERY to change
// the topic, or BAIN_NEWS_QUERY="off" to disable the fallback entirely.
const WECHAT_FEED_URL = process.env.WECHAT_FEED_URL || "";
const WECHAT_SOURCE_NAME = process.env.WECHAT_SOURCE_NAME || "";
const BAIN_NEWS_QUERY = process.env.BAIN_NEWS_QUERY || DEFAULT_QUERY;

const OUT = fileURLToPath(new URL("../frontend/data/today.json", import.meta.url));

// Per-character jyutping aligned to the string (non-Cantonese -> "").
function jyutpingFor(text) {
  return getJyutpingList(text).map(([, jyut]) => jyut || "");
}

// Spell out Arabic numerals on the SPOKEN side only, segment by segment so the
// aligned pairs stay valid (the f side keeps the digits, matching the article).
// Each segment sees the following segments as lookahead, so a unit character
// (年/個/%) in the next segment still informs the reading.
function spellOutPairs(pairs) {
  // Split identity segments around digit runs first, so each number becomes
  // its own tight aligned pair (f: "54.1", c: "五十四點一") instead of turning
  // a long unchanged segment into one big changed pair.
  const expanded = [];
  for (const p of pairs) {
    if (p.f === p.c && /\d/.test(p.f)) {
      for (const part of splitByNumbers(p.f)) expanded.push({ f: part.text, c: part.text });
    } else {
      expanded.push(p);
    }
  }
  return expanded.map((p, k) => {
    const lookahead = expanded.slice(k + 1).map((q) => q.c).join("");
    return { f: p.f, c: spellOutNumbers(p.c, lookahead) };
  });
}

async function buildArticle(a, idx, client) {
  const units = paragraphsToUnits(a.body);
  const formals = units.map((u) => u.formal);
  // Quality tiers: Claude rewrite+verifier -> free GitHub Models rewrite+review
  // -> rule-based converter. Each tier fails soft to the next.
  let llm = null;
  if (client) {
    llm = await convertArticle(formals, client, { model: LLM_MODEL });
  }
  let gh = null;
  if (!llm && GH_TOKEN) {
    gh = await ghConvertSentences(formals, { token: GH_TOKEN, model: GH_MODEL_OVERRIDE });
  }
  const method = llm ? (llm.verified ? "llm+verify" : "llm") : gh ? "llm" : "rules";
  let anyChanged = false;
  const sentences = units.map((u, i) => {
    let pairs;
    let colloquial;
    if (llm) {
      colloquial = llm.sentences[i].colloquial;
      // Semantic pairs from Claude; LCS alignment when they failed validation.
      pairs = llm.sentences[i].pairs || alignPairs(u.formal, colloquial);
    } else if (gh) {
      colloquial = gh[i];
      if (colloquial === u.formal) {
        // The model left this sentence untouched — apply the rule-based
        // converter as a floor so the LLM tier never reads LESS spoken than
        // the rules tier would.
        pairs = toColloquialSegments(u.formal);
        colloquial = pairs.map((p) => p.c).join("");
      } else {
        pairs = alignPairs(u.formal, colloquial);
      }
    } else {
      pairs = toColloquialSegments(u.formal);
      colloquial = pairs.map((p) => p.c).join("");
    }
    if (pairs) {
      pairs = spellOutPairs(pairs);
      colloquial = pairs.map((p) => p.c).join("");
    } else {
      colloquial = spellOutNumbers(colloquial);
    }
    if (u.formal !== colloquial) anyChanged = true;
    const s = {
      id: i,
      paragraph_id: u.paragraph_id,
      formal: u.formal,
      colloquial,
      jyutping: jyutpingFor(colloquial),
    };
    if (pairs && pairs.length > 1) s.pairs = pairs;
    return s;
  });
  return {
    id: `a${idx}`,
    title: a.title,
    source: a.source,
    url: a.url,
    publishedAt: a.publishedAt,
    converted: anyChanged,
    method,
    ...(llm && llm.verified ? { verified: true, repaired: llm.repaired } : {}),
    sentences,
  };
}

async function main() {
  // Secondary source first (it gets guaranteed slots): the WeChat bridge when
  // configured, else the Google News web-scrape fallback for Bain coverage.
  let wechat = [];
  if (WECHAT_FEED_URL) {
    wechat = await fetchCustomFeedArticles({
      url: WECHAT_FEED_URL,
      source: WECHAT_SOURCE_NAME || "Bain Portfolio News 朋友圈",
      max: MAX_WECHAT,
      minChars: 40,
    });
    console.log(`Secondary feed (bridge): ${wechat.length} article(s)`);
  }
  if (!wechat.length && BAIN_NEWS_QUERY && BAIN_NEWS_QUERY !== "off") {
    wechat = await fetchGoogleNewsArticles({
      query: BAIN_NEWS_QUERY,
      max: MAX_WECHAT,
      source: WECHAT_SOURCE_NAME || "Bain Capital 新聞",
    });
    console.log(`Secondary feed (web scrape "${BAIN_NEWS_QUERY}"): ${wechat.length} article(s)`);
  }

  const candidates = await fetchRssArticles({ perFeed: 8, minChars: 10 });
  if (!candidates.length && !wechat.length) {
    console.log("No studyable articles fetched — leaving today.json absent (sample fallback).");
    return;
  }
  for (const a of candidates) {
    if (a.url) {
      const full = await fetchArticleBody(a.url);
      if (cjkCount(full) > cjkCount(a.body)) a.body = full; // use fuller story text
    }
  }
  // Final junk guard for EVERY source path: strip stale-page banners,
  // disclaimers and other boilerplate paragraphs; drop articles with no real
  // prose left (e.g. a publisher served an idle-page interstitial instead of
  // the story).
  for (const a of [...wechat, ...candidates]) a.body = stripJunkParagraphs(a.body);
  wechat = wechat.filter((a) => cjkCount(a.body) >= 40);

  // Prefer substantial bodies; relax if too few qualify.
  const studyable = candidates.filter((a) => cjkCount(a.body) >= 20);
  let pool = studyable.filter((a) => cjkCount(a.body) >= MIN_BODY_CHARS);
  if (pool.length < 6) pool = studyable;
  const articles = [...wechat, ...pickBalanced(pool, MAX_ARTICLES - wechat.length)];
  console.log("Selected:", articles.map((a) => `[${a.source}] ${a.title}`).join(" | "));

  const client = LLM_KEY ? makeClient(LLM_KEY) : null;
  const built = await Promise.all(articles.map((a, i) => buildArticle(a, i, client)));
  const usedLlm = built.some((a) => a.method !== "rules");
  const verified = built.some((a) => a.verified);
  const lessons = {
    // NOTE: date is stamped by the runner via env to stay deterministic here.
    date: process.env.BUILD_DATE || "",
    source: wechat.length ? `RTHK 香港電台 + ${wechat[0].source}` : "RTHK 香港電台",
    method: verified ? "llm+verify" : usedLlm ? "llm" : "rules",
    note: verified
      ? "Rewritten to spoken Cantonese by Claude and cross-checked by an independent Claude reviewer."
      : usedLlm
        ? "Rewritten to spoken Cantonese by an AI model with a second review pass, from live news."
        : "Auto-converted to Cantonese (rule-based, rough) from live RSS news.",
    generatedAt: process.env.BUILD_TIME || "",
    articles: built,
  };
  await writeFile(OUT, JSON.stringify(lessons, null, 2), "utf-8");
  const repaired = built.reduce((n, a) => n + (a.repaired || 0), 0);
  const tier = LLM_KEY
    ? `anthropic, verifier repaired ${repaired}`
    : GH_TOKEN
      ? "github-models (free) + review pass"
      : "no ANTHROPIC_API_KEY / GITHUB_TOKEN, using rules";
  console.log(
    `Wrote today.json: ${lessons.articles.length} articles, ` +
      `${lessons.articles.reduce((n, a) => n + a.sentences.length, 0)} sentences ` +
      `(rewrite: ${lessons.method} — ${tier}).`,
  );
}

main().catch((err) => {
  console.error("build-lessons failed (soft):", String(err));
  process.exit(0); // never fail the deploy; site falls back to sample.
});
