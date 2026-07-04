import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanGoogleTitle,
  extractArticleBody,
  decodeGoogleLink,
  fetchGoogleNewsArticles,
} from "../backend/gnews.js";

test("cleanGoogleTitle strips the trailing publisher segment", () => {
  assert.equal(cleanGoogleTitle("貝恩資本收購案升溫 - Yahoo 財經"), "貝恩資本收購案升溫");
  assert.equal(cleanGoogleTitle("無來源後綴"), "無來源後綴");
});

test("extractArticleBody keeps prose, drops nav junk and Latin blocks", () => {
  const html = `
    <html><head><style>p{color:red}</style></head><body>
    <p>跳至導覽 跳過主要內容 雅虎香港財經 新聞 財經 體育 更多</p>
    <p>貝恩資本今日宣布，以每股三千七百日圓提出收購要約，較市價有溢價。</p>
    <p><b>管理層表示</b>，交易完成後將維持現有品牌，並繼續投資技術平台。</p>
    <p>This is an English-only paragraph that should be dropped entirely.</p>
    <p>版權所有 不得轉載</p>
    </body></html>`;
  const body = extractArticleBody(html);
  assert.ok(body.includes("貝恩資本今日宣布"));
  assert.ok(body.includes("管理層表示"));
  assert.ok(body.includes("\n\n"), "paragraph break kept");
  assert.ok(!body.includes("跳至導覽"), "nav junk dropped (no Chinese punctuation)");
  assert.ok(!body.includes("English-only"), "Latin block dropped");
  assert.ok(!body.includes("版權所有"), "footer dropped");
});

test("extractArticleBody drops nav strips even when they contain punctuation", () => {
  const html = `
    <p>跳至導覽 跳過主要內容 新聞 財經 體育 更多 港聞 娛樂圈 電影 國際 專欄 天氣，登入 電郵。</p>
    <p>該銀行預計南韓和台灣到 2027 年將展現最強勁的獲利成長，主要受惠於記憶體價格上升。</p>`;
  const body = extractArticleBody(html);
  assert.ok(!body.includes("跳至導覽"), "punctuated nav strip still dropped (CJK-space-CJK gaps)");
  assert.ok(body.includes("該銀行預計"), "prose with spaced digits kept");
});

// Mock fetch that dispatches by URL.
function routedFetch(routes) {
  return async (url, opts = {}) => {
    for (const [match, respond] of routes) {
      if (String(url).includes(match)) return respond(url, opts);
    }
    return { ok: false, status: 404, text: async () => "" };
  };
}

const SPLASH = `<html><c-wiz data-n-a-ts="1783141222" data-n-a-sg="AVvZt1Etest"></c-wiz></html>`;
const BATCH_OK = `)]}'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https:\\/\\/publisher.example\\/story1\\"]",null,null,null,"generic"]]`;

test("decodeGoogleLink resolves the wrapper via splash + batchexecute (mocked)", async () => {
  const fetchImpl = routedFetch([
    ["news.google.com/rss/articles/", async () => ({ ok: true, text: async () => SPLASH })],
    ["batchexecute", async (url, opts) => {
      assert.equal(opts.method, "POST");
      assert.ok(opts.body.includes("garturlreq"));
      return { ok: true, text: async () => BATCH_OK };
    }],
  ]);
  const url = await decodeGoogleLink("https://news.google.com/rss/articles/CBMiTEST?oc=5", fetchImpl);
  assert.equal(url, "https://publisher.example/story1");
});

test("decodeGoogleLink fails soft on any breakage", async () => {
  const dead = async () => ({ ok: false, status: 500, text: async () => "" });
  assert.equal(await decodeGoogleLink("https://news.google.com/rss/articles/CBMiX", dead), null);
  assert.equal(await decodeGoogleLink("https://not-a-wrapper.example/x", dead), null);
});

const GNEWS_RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>貝恩資本提出收購要約，交易升溫 - Yahoo 財經</title>
<link>https://news.google.com/rss/articles/CBMiTEST?oc=5</link>
<description>snippet</description><pubDate>Thu, 02 Jul 2026 06:00:00 GMT</pubDate></item>
<item><title>貝恩資本提出收購要約，交易升溫 - 香港01</title>
<link>https://news.google.com/rss/articles/CBMiDUP?oc=5</link>
<description>snippet</description><pubDate>Thu, 02 Jul 2026 07:00:00 GMT</pubDate></item>
</channel></rss>`;

const ARTICLE_HTML = `<html><body>
<p>貝恩資本今日宣布，以每股三千七百日圓提出收購要約，較市價有明顯溢價，交易總值約六千億日圓。</p>
<p>管理層表示，交易完成之後將維持現有品牌，並繼續投資技術平台，擴展亞太區業務，創造長遠價值。</p>
</body></html>`;

test("fetchGoogleNewsArticles: end-to-end with mocks, dedupes same story", async () => {
  const fetchImpl = routedFetch([
    ["news.google.com/rss/search", async (url) => {
      assert.ok(String(url).includes("when%3A7d") || String(url).includes("when:7d"));
      return { ok: true, text: async () => GNEWS_RSS };
    }],
    ["news.google.com/rss/articles/", async () => ({ ok: true, text: async () => SPLASH })],
    ["batchexecute", async () => ({ ok: true, text: async () => BATCH_OK })],
    ["publisher.example", async () => ({ ok: true, text: async () => ARTICLE_HTML })],
  ]);
  const out = await fetchGoogleNewsArticles({ query: "貝恩資本", max: 4 }, fetchImpl);
  assert.equal(out.length, 1, "second item is the same story (title prefix) — deduped");
  assert.equal(out[0].url, "https://publisher.example/story1");
  assert.equal(out[0].title, "貝恩資本提出收購要約，交易升溫");
  assert.equal(out[0].source, "Bain Capital 新聞");
  assert.ok(out[0].body.includes("\n\n"));
});

test("fetchGoogleNewsArticles fails soft to []", async () => {
  const dead = async () => { throw new Error("offline"); };
  assert.deepEqual(await fetchGoogleNewsArticles({}, dead), []);
});
