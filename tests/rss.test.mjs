import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  parseRss,
  itemBody,
  isStudyable,
  selectFromRss,
  fetchRssArticles,
  extractRthkBody,
  fetchArticleBody,
  newsScore,
  digitDensity,
} from "../backend/rss.js";

const SAMPLE_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>財經</title>
<item>
  <title><![CDATA[恒指曾升逾400點　科技及金融股推高大市]]></title>
  <link>https://news.rthk.hk/a/1.htm</link>
  <description><![CDATA[港股在下半年首個交易日顯著造好，恒生指數重返23000點以上，曾升逾400點。
編輯：宋家樑]]></description>
  <pubDate>Thu, 02 Jul 2026 10:02:35 +0800</pubDate>
</item>
<item>
  <title><![CDATA[Markets rally in New York on tech optimism today]]></title>
  <link>https://news.rthk.hk/a/2.htm</link>
  <description><![CDATA[English only story, should be filtered out.]]></description>
  <pubDate>Thu, 02 Jul 2026 09:00:00 +0800</pubDate>
</item>
<item>
  <title><![CDATA[滬指半日跌近1%　深證成指跌逾2%]]></title>
  <link>https://news.rthk.hk/a/3.htm</link>
  <description><![CDATA[滬深股市半日跌近1%至逾3%，券商等股份下跌；黃金等股份上升。記者：張三]]></description>
  <pubDate>Thu, 02 Jul 2026 11:48:01 +0800</pubDate>
</item>
</channel></rss>`;

test("cleanText strips CDATA, tags, entities, editor/reporter credits, full-width spaces", () => {
  assert.equal(cleanText("<![CDATA[恒指　升]]>"), "恒指 升");
  assert.equal(cleanText("港股造好。編輯：宋家樑"), "港股造好。");
  assert.equal(cleanText("跌逾3%。記者：張三"), "跌逾3%。");
  assert.equal(cleanText("A &amp; B <b>bold</b>"), "A & B bold");
});

test("parseRss extracts items", () => {
  const items = parseRss(SAMPLE_XML);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "恒指曾升逾400點 科技及金融股推高大市");
  assert.ok(items[0].description.includes("恒生指數"));
  assert.ok(!items[0].description.includes("編輯"));
});

test("itemBody is the description only — the title is NOT spoken", () => {
  const body = itemBody({ title: "港股造好", description: "恒指升逾400點。" });
  assert.equal(body, "恒指升逾400點。");
  assert.ok(!body.includes("港股造好"));
});

test("isStudyable filters English and too-short", () => {
  assert.equal(isStudyable("Markets rally in New York today on optimism"), false);
  assert.equal(isStudyable("港股"), false); // too short
  assert.equal(isStudyable("港股在下半年首個交易日顯著造好恒生指數重返兩萬三千點"), true);
});

test("selectFromRss keeps studyable Chinese items in order, drops English", () => {
  const picked = selectFromRss(SAMPLE_XML, { max: 5 });
  assert.equal(picked.length, 2); // English item filtered
  assert.ok(picked[0].title.includes("恒指"));
  assert.ok(picked[0].body.includes("恒生指數"));
  assert.equal(picked[0].url, "https://news.rthk.hk/a/1.htm");
});

test("fetchRssArticles pools feeds and de-duplicates by URL", async () => {
  const mockFetch = async () => ({ ok: true, text: async () => SAMPLE_XML });
  // Two explicit feeds both return SAMPLE_XML -> 2 studyable items, deduped once.
  const feeds = [
    { url: "https://x/finance.xml", source: "RTHK 財經" },
    { url: "https://x/local.xml", source: "RTHK 本地" },
  ];
  const out = await fetchRssArticles({ feeds, perFeed: 8 }, mockFetch);
  assert.equal(out.length, 2); // deduped across both feeds
  assert.equal(out[0].source, "RTHK 財經"); // first feed's source
});

test("fetchRssArticles returns [] when all feeds fail", async () => {
  const mockFetch = async () => ({ ok: false });
  const out = await fetchRssArticles({}, mockFetch);
  assert.deepEqual(out, []);
});

const ARTICLE_HTML = `<html><body>
<div class="itemFullText">港股顯著造好，恒生指數重返23000點以上。<br><br>
金融及科技股推高大市，美團升近6%。<br><br>
編輯：宋家樑</div>
</body></html>`;

test("extractRthkBody returns multi-paragraph body without the editor credit", () => {
  const body = extractRthkBody(ARTICLE_HTML);
  assert.ok(body.includes("港股顯著造好"));
  assert.ok(body.includes("金融及科技股"));
  assert.ok(!body.includes("編輯"), "editor credit stripped");
  assert.ok(body.includes("\n\n"), "paragraph breaks preserved");
});

test("extractRthkBody returns '' when no article container present", () => {
  assert.equal(extractRthkBody("<html><body>nothing</body></html>"), "");
});

test("fetchArticleBody uses injected fetch and extracts body", async () => {
  const mockFetch = async () => ({ ok: true, text: async () => ARTICLE_HTML });
  const body = await fetchArticleBody("https://news.rthk.hk/x.htm", mockFetch);
  assert.ok(body.includes("恒生指數"));
});

test("newsScore ranks a policy story above a pure market-ticker report", () => {
  const ticker = "恒指升400點 收市報23232點 升幅1.54% 滬指跌1%";
  const news = "政府宣布推出新政策 監管機構調查一宗大型收購 涉及通脹及就業";
  assert.ok(newsScore("恒指升400點", ticker) < newsScore("政府宣布新政策", news));
});

test("digitDensity is higher for number-heavy text", () => {
  assert.ok(digitDensity("升400點 1.54% 23232點") > digitDensity("政府宣布推出新的監管政策"));
});
