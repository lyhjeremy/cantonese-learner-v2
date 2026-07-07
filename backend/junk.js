// junk.js — boilerplate/junk detection for scraped article text. Generic
// article extraction (gnews.js) harvests CJK-dense <p> blocks, which lets
// site chrome slip through when a publisher serves an interstitial instead of
// the story: stale-page banners ("網頁已經閒置了一段時間…請重新載入頁面"),
// editorial disclaimers ("所刊的署名及/或不署名文章…並不代表本網立場"),
// cookie/privacy notices, paywall prompts, and copyright footers. These read
// as fluent Chinese prose to the density heuristics, so they need explicit
// pattern matching. A paragraph matching ANY pattern is junk; an article whose
// paragraphs are all junk ends up empty and is skipped by the caller's
// minimum-length check.

const JUNK_PATTERNS = [
  // Stale/idle-page interstitials and reload prompts.
  /網頁.{0,6}閒置|閒置(了|咗)?一段時間/,
  /重新載入|重新整理|立即載入|請刷新/,
  /網頁已過期|頁面已過期|載入頁面/,
  // Browser/JS requirements.
  /請啟用\s*JavaScript|不支援.{0,6}瀏覽器|升級.{0,6}瀏覽器/i,
  // Editorial disclaimers and boilerplate footers.
  /署名(及|或|及\/或).{0,8}文章|不署名文章/,
  /作者個人意見|並不代表.{0,12}(立場|觀點)|不代表本(網|台|報)/,
  /免責聲明|使用條款|私隱政策|隱私政策|版權所有|不得轉載|All rights reserved/i,
  /\bcookies?\b|Cookie政策/i,
  // Paywall / account prompts.
  /請先登入|登入後(繼續|閱讀)|成為會員|全文只供|訂戶專享/,
  /立即訂閱|訂閱.{0,8}(電子報|通訊|頻道)|訂閱我們/,
  // Site chrome.
  /廣告查詢|聯絡我們|返回(主頁|首頁)|相關(文章|新聞)[:：]?$/,
];

// True when a paragraph is site boilerplate rather than story prose.
export function isJunkParagraph(p) {
  const s = String(p || "").trim();
  if (!s) return true;
  return JUNK_PATTERNS.some((re) => re.test(s));
}

// Remove junk paragraphs from a blank-line-separated body. Returns the
// surviving paragraphs re-joined (possibly ""), preserving paragraph breaks.
export function stripJunkParagraphs(body) {
  return String(body || "")
    .split(/\n{2,}/)
    .filter((p) => !isJunkParagraph(p))
    .join("\n\n");
}
