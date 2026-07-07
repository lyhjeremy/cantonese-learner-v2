import { test } from "node:test";
import assert from "node:assert/strict";
import { isJunkParagraph, stripJunkParagraphs } from "../backend/junk.js";
import { extractArticleBody, cleanGoogleTitle } from "../backend/gnews.js";

test("isJunkParagraph: stale-page banners, disclaimers, paywalls, chrome", () => {
  const junk = [
    "網頁已經閒置了一段時間，為確保不會錯過最新的內容。請重新載入頁面。立即重新載入",
    "《經濟通》所刊的署名及/或不署名文章，相關內容屬作者個人意見，並不代表《經濟通》立場。",
    "本網頁內容版權所有，未經授權不得轉載。",
    "請先登入或成為會員，即可閱讀全文。",
    "立即訂閱我們的電子報，緊貼市場動態。",
    "本網站使用Cookies以提升瀏覽體驗，繼續使用即表示同意私隱政策。",
    "請啟用JavaScript以獲得最佳瀏覽體驗。",
  ];
  for (const p of junk) assert.equal(isJunkParagraph(p), true, p);

  const prose = [
    "協合新能源與貝恩資本旗下Bridge Data Centres今日簽署諒解備忘錄，共同開發數據中心項目。",
    "行政長官表示，政府會繼續推動創新科技發展，吸引更多企業落戶香港。",
    "恒生指數今日收市升200點，成交額增加。",
  ];
  for (const p of prose) assert.equal(isJunkParagraph(p), false, p);
});

test("stripJunkParagraphs: keeps prose, drops boilerplate, preserves breaks", () => {
  const body = [
    "網頁已經閒置了一段時間，為確保不會錯過最新的內容。請重新載入頁面。",
    "協合新能源今日宣布，與貝恩資本旗下公司簽署合作協議，金額達10億元。",
    "《經濟通》所刊的署名及/或不署名文章，相關內容屬作者個人意見，並不代表《經濟通》立場。",
    "雙方將在數據中心領域展開合作，項目預計明年動工。",
  ].join("\n\n");
  const out = stripJunkParagraphs(body);
  assert.equal(
    out,
    "協合新能源今日宣布，與貝恩資本旗下公司簽署合作協議，金額達10億元。\n\n雙方將在數據中心領域展開合作，項目預計明年動工。",
  );
});

test("stripJunkParagraphs: an idle-page interstitial strips to empty", () => {
  const body = [
    "網頁已經閒置了一段時間，為確保不會錯過最新的內容。請重新載入頁面。立即重新載入",
    "《經濟通》所刊的署名及/或不署名文章，相關內容屬作者個人意見，並不代表《經濟通》立場。",
  ].join("\n\n");
  assert.equal(stripJunkParagraphs(body), "");
});

test("extractArticleBody: filters junk paragraphs during extraction", () => {
  const html = `
    <html><body>
      <p>網頁已經閒置了一段時間，為確保不會錯過最新的內容。請重新載入頁面。立即重新載入</p>
      <p>協合新能源與貝恩資本旗下Bridge Data Centres今日簽署諒解備忘錄，共同開發亞太區數據中心項目。</p>
      <p>《經濟通》所刊的署名及/或不署名文章，相關內容屬作者個人意見，並不代表《經濟通》立場。</p>
    </body></html>`;
  const body = extractArticleBody(html);
  assert.match(body, /簽署諒解備忘錄/);
  assert.doesNotMatch(body, /閒置|重新載入|個人意見/);
});

test("cleanGoogleTitle: strips publisher suffix and trailing nav segments", () => {
  assert.equal(
    cleanGoogleTitle("協合新能源與貝恩資本旗下Bridge Data Centres簽署諒解備忘錄 | 主頁 - 新聞"),
    "協合新能源與貝恩資本旗下Bridge Data Centres簽署諒解備忘錄",
  );
  assert.equal(cleanGoogleTitle("公司公布業績 - 經濟日報"), "公司公布業績");
  // Legit ｜-prefixed headlines keep their topic prefix.
  assert.equal(cleanGoogleTitle("世界盃｜佛得角足球隊回國獲英雄式歡迎"), "世界盃｜佛得角足球隊回國獲英雄式歡迎");
});
