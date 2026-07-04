// rss.js — KEYLESS news ingestion from an RSS feed (no API key). Parses items,
// cleans the text, and selects studyable Chinese finance stories. Designed for
// RTHK's Chinese finance feed but works with any RSS 2.0 feed.

import { cjkFraction, cjkCount } from "./chunk.js";

// Free, keyless RTHK Chinese feeds across topics. We pool all of them and pick a
// balanced spread (round-robin across sources in the build), so lessons cover
// local HK news, greater-China, world, finance, and sport — not just finance.
// (RTHK has no separate arts/culture express feed; sport carries the lighter,
// cultural stories.)
export const NEWS_FEEDS = [
  { url: "https://rthk.hk/rthk/news/rss/c_expressnews_clocal.xml", source: "RTHK 本地" },
  { url: "https://rthk.hk/rthk/news/rss/c_expressnews_greaterchina.xml", source: "RTHK 兩岸" },
  { url: "https://rthk.hk/rthk/news/rss/c_expressnews_cinternational.xml", source: "RTHK 國際" },
  { url: "https://rthk.hk/rthk/news/rss/c_expressnews_cfinance.xml", source: "RTHK 財經" },
  { url: "https://rthk.hk/rthk/news/rss/c_expressnews_csport.xml", source: "RTHK 體育" },
];

const decodeEntities = (s) =>
  String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

// Strip CDATA wrappers, HTML tags, entities, editor credits and full-width
// spaces; collapse whitespace.
export function cleanText(raw) {
  let s = String(raw || "");
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[　 ]/g, " "); // full-width / nbsp -> space
  s = s.replace(/\s*編輯\s*[:：].*$/s, ""); // RTHK "編輯：XXX" credit
  s = s.replace(/\s*記者\s*[:：].*$/s, "");
  return s.replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? m[1] : "";
}

// Parse RSS 2.0 XML into raw items.
export function parseRss(xml) {
  const items = [];
  const blocks = String(xml || "").match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    items.push({
      title: cleanText(tag(block, "title")),
      link: cleanText(tag(block, "link")),
      description: cleanText(tag(block, "description")),
      pubDate: cleanText(tag(block, "pubDate")),
    });
  }
  return items;
}

// Study body = the article text ONLY (the description here; the full story body
// is fetched later in the build). The title is deliberately excluded so it's
// never spoken/graded — it's shown separately as the reader heading.
export function itemBody(item) {
  return (item.description || "").trim();
}

// Studyable = majority-CJK and long enough. RSS summaries are short, so the
// floor is lower than the full-article threshold (a compromise for keyless news).
export function isStudyable(body, { minChars = 20, minCjkFraction = 0.5 } = {}) {
  return cjkFraction(body) >= minCjkFraction && cjkCount(body) >= minChars;
}

// Select the first `max` studyable items, normalised for the pipeline.
export function selectFromRss(xml, { max = 5, sourceName = "RTHK", ...filter } = {}) {
  const items = parseRss(xml);
  const picked = [];
  for (const it of items) {
    const body = itemBody(it);
    if (!isStudyable(body, filter)) continue;
    picked.push({
      title: it.title,
      body,
      url: it.link,
      publishedAt: it.pubDate,
      source: sourceName,
    });
    if (picked.length >= max) break;
  }
  return picked;
}

// ── Newsworthiness scoring (keyless heuristic) ───────────────────────────────
// Prefer genuine news (policy, deals, company events, economic developments)
// over pure market-ticker reports ("恒指升400點，跌幅1.5%…").

const REPORT_MARKERS =
  /恒指|恒生指數|國指|滬指|深證|創業板|道指|期指|納指|標普|日經|收市|半日|初段|午市|升幅|跌幅|個百分點|成交額|成交金額|報\d/g;
const NEWS_MARKERS =
  /宣布|公布|收購|併購|合併|監管|政策|裁員|上市|招股|加息|減息|降準|降息|調查|破產|融資|罷工|制裁|關稅|協議|簽署|推出|計劃|預算|失業|通脹|通縮|央行|議息|訴訟|罰款|停牌|派息|盈利|虧損|重組|入股|擴張|發布|合作|禁令|審批|牌照|違規|欺詐|洗黑錢|需求|供應|樓市|地產|收入|業績|預測|警告|風險|就業|貿易/g;

export function digitDensity(text) {
  const chars = [...String(text || "")];
  if (!chars.length) return 0;
  const digits = chars.filter((c) => /[0-9]/.test(c)).length;
  const pct = (String(text).match(/%|百分/g) || []).length;
  return (digits + pct) / chars.length;
}

// Higher = more newsworthy. Rewards news vocabulary; penalises ticker markers
// and raw number density.
export function newsScore(title, body) {
  const t = `${title || ""} ${body || ""}`;
  const report = (t.match(REPORT_MARKERS) || []).length;
  const news = (t.match(NEWS_MARKERS) || []).length;
  return news * 3 - report * 1.5 - digitDensity(t) * 20;
}

// Extract the full article body from an RTHK story page (much longer than the
// RSS summary), preserving paragraph breaks as blank lines. Returns "" if the
// expected container isn't found.
export function extractRthkBody(html) {
  const m = String(html || "").match(/class="itemFullText"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return "";
  let s = m[1]
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s).replace(/[　]/g, " ");
  s = s.replace(/\s*編輯\s*[:：].*$/s, "").replace(/\s*記者\s*[:：].*$/s, "");
  const paras = s
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]*\n[ \t]*/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  return paras.join("\n\n");
}

// Fetch a story page and extract its full body. fetchImpl injectable.
export async function fetchArticleBody(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { redirect: "follow" });
    if (!res.ok) return "";
    const html = await res.text();
    return extractRthkBody(html);
  } catch {
    return "";
  }
}

// Fetch and POOL studyable articles across all feeds, de-duplicated by URL.
// Returns a broad candidate list; the caller ranks + trims. fetchImpl injectable.
export async function fetchRssArticles(opts = {}, fetchImpl = fetch) {
  const { feeds = NEWS_FEEDS, perFeed = 8, ...filter } = opts;
  const out = [];
  const seen = new Set();
  for (const feed of feeds) {
    const url = typeof feed === "string" ? feed : feed.url;
    const source = typeof feed === "string" ? (url.includes("rthk") ? "RTHK" : "News") : feed.source;
    try {
      const res = await fetchImpl(url, { redirect: "follow" });
      if (!res.ok) continue;
      const xml = await res.text();
      const picked = selectFromRss(xml, { max: perFeed, sourceName: source, ...filter });
      for (const a of picked) {
        const key = a.url || a.title;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(a);
      }
    } catch {
      /* try next feed */
    }
  }
  return out;
}
