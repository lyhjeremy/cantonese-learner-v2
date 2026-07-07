// gnews.js — keyless "scrape the web" secondary source. When no WeChat bridge
// feed is configured, the build pulls Chinese-language coverage of a topic
// (default: 貝恩資本 / Bain Capital) from Google News' public RSS search feed,
// resolves each item's redirect wrapper to the real publisher URL (splash-page
// signature + batchexecute POST — the documented-in-the-wild decode), fetches
// the publisher page, and extracts the article body generically.
//
// Everything here is best-effort and fails soft: any step that breaks just
// skips that article (or returns []), and the daily build carries on RTHK-only.

import { cjkCount, isCjkIdeograph } from "./chunk.js";
import { parseRss } from "./rss.js";
import { isJunkParagraph } from "./junk.js";

export const DEFAULT_QUERY = "貝恩資本"; // Bain Capital, Traditional Chinese

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Google News titles carry a " - Publisher" suffix; strip the last segment.
// Publisher titles themselves often carry trailing site-nav segments
// ("…簽署諒解備忘錄 | 主頁 - 新聞") — peel those off too, but only when the
// segment is a generic nav word, so real headlines with ｜ topic prefixes
// (e.g. RTHK's 世界盃｜…) are left alone.
const NAV_SEGMENT = /\s*[|｜]\s*(主頁|首頁|新聞|即時新聞|財經新聞|要聞|Home)\s*$/;
export function cleanGoogleTitle(title) {
  let t = String(title || "").replace(/\s+-\s+[^-]+$/, "").trim();
  while (NAV_SEGMENT.test(t)) t = t.replace(NAV_SEGMENT, "").trim();
  return t;
}

// Generic article-body extraction for arbitrary Chinese news pages: harvest
// <p> blocks, keep CJK-dense paragraphs that read like prose (they contain
// Chinese punctuation — nav menus and footers don't), join as paragraphs.
export function extractArticleBody(html, { minCjkPerPara = 12, maxChars = 1600 } = {}) {
  let s = String(html || "");
  if (!s) return "";
  s = s.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ");
  const paras = [];
  for (const m of s.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    let p = m[1]
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ");
    p = decodeBasicEntities(p).replace(/[　]/g, " ").replace(/\s+/g, " ").trim();
    const cjk = cjkCount(p);
    if (cjk < minCjkPerPara) continue;
    if (cjk / Math.max(p.length, 1) < 0.4) continue; // mostly-Latin block
    if (!/[。！？，；：]/.test(p)) continue; // no Chinese punctuation -> nav/footer
    // Nav strips read "新聞 財經 體育 更多…" — spaces BETWEEN two CJK chars,
    // which real Chinese prose essentially never has (spaces around Latin
    // words/digits are fine). Three or more such gaps -> menu, not prose.
    let cjkGaps = 0;
    const chars = [...p];
    for (let i = 1; i < chars.length - 1; i++) {
      if (chars[i] === " " && isCjkIdeograph(chars[i - 1]) && isCjkIdeograph(chars[i + 1])) cjkGaps++;
    }
    if (cjkGaps >= 3) continue;
    // Stale-page banners, disclaimers, paywall prompts and other boilerplate
    // read as fluent prose to the checks above — filter them by pattern.
    if (isJunkParagraph(p)) continue;
    paras.push(p);
    if (paras.join("").length > maxChars) break;
  }
  return paras.join("\n\n");
}

function decodeBasicEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Resolve a news.google.com/rss/articles/... wrapper to the publisher URL:
// GET the splash page for its signature/timestamp, then POST batchexecute.
export async function decodeGoogleLink(link, fetchImpl = fetch) {
  try {
    const idMatch = String(link || "").match(/\/articles\/([^?/]+)/);
    if (!idMatch) return null;
    const artId = idMatch[1];

    const splashRes = await fetchImpl(link, {
      redirect: "follow",
      headers: { "user-agent": UA },
    });
    if (!splashRes.ok) return null;
    const splash = await splashRes.text();
    const ts = splash.match(/data-n-a-ts="([^"]+)"/)?.[1];
    const sg = splash.match(/data-n-a-sg="([^"]+)"/)?.[1];
    if (!ts || !sg) return null;

    const inner = JSON.stringify([
      "garturlreq",
      [
        ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
        "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0,
      ],
      artId, Number(ts), sg,
    ]);
    const fReq = JSON.stringify([[["Fbv4je", inner, null, "generic"]]]);
    const res = await fetchImpl("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": UA,
      },
      body: new URLSearchParams({ "f.req": fReq }).toString(),
    });
    if (!res.ok) return null;
    const body = (await res.text()).replace(/\\\//g, "/");
    const url = body.match(/garturlres\\?",\\?"(https?:[^"\\]+)/)?.[1];
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Fetch up to `max` studyable articles for a topic from Google News (zh-HK),
 * with real publisher URLs and scraped bodies. Deduplicates near-identical
 * stories by title prefix and publisher domain. Returns [] on any failure.
 */
export async function fetchGoogleNewsArticles(
  {
    query = DEFAULT_QUERY,
    max = 4,
    source = "Bain Capital 新聞",
    lookbackDays = 7,
    minChars = 80,
    maxCandidates = 12,
  } = {},
  fetchImpl = fetch,
) {
  try {
    const q = encodeURIComponent(`${query} when:${lookbackDays}d`);
    const rssUrl = `https://news.google.com/rss/search?q=${q}&hl=zh-HK&gl=HK&ceid=HK:zh-Hant`;
    const res = await fetchImpl(rssUrl, { redirect: "follow", headers: { "user-agent": UA } });
    if (!res.ok) return [];
    const items = parseRss(await res.text());

    const out = [];
    const seenTitles = new Set();
    const seenDomains = new Set();
    for (const it of items.slice(0, maxCandidates)) {
      if (out.length >= max) break;
      const title = cleanGoogleTitle(it.title);
      const titleKey = [...title].slice(0, 12).join("");
      if (!title || seenTitles.has(titleKey)) continue;

      const realUrl = await decodeGoogleLink(it.link, fetchImpl);
      if (!realUrl) continue;
      let domain = "";
      try {
        domain = new URL(realUrl).hostname;
      } catch {
        continue;
      }
      if (seenDomains.has(domain)) continue;

      let body = "";
      try {
        const page = await fetchImpl(realUrl, {
          redirect: "follow",
          headers: { "user-agent": UA, "accept-language": "zh-HK,zh;q=0.9" },
        });
        if (page.ok) body = extractArticleBody(await page.text());
      } catch {
        /* skip this article */
      }
      if (cjkCount(body) < minChars) continue;

      seenTitles.add(titleKey);
      seenDomains.add(domain);
      out.push({ title, body, url: realUrl, publishedAt: it.pubDate, source });
    }
    return out;
  } catch {
    return [];
  }
}
