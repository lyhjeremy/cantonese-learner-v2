// End-to-end browser test: loads the real frontend in headless Chromium and
// exercises the app path (list -> reader -> navigation -> toggles -> graceful
// degradation). Skips cleanly if Playwright/Chromium isn't installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/serve.mjs";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  chromium = null;
}

const maybe = chromium ? test : test.skip;

let server;
let browser;
let baseURL;

before(async () => {
  if (!chromium) return;
  const s = await startServer(0);
  server = s.server;
  baseURL = `http://localhost:${s.port}/`;
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

async function ready(page) {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__CFL_READY === true, { timeout: 15000 });
}

// Force the bundled-sample data path (404 the daily today.json), so tests are
// deterministic regardless of whether a generated today.json exists on disk.
async function forceSample(page) {
  await page.route("**/data/today.json", (r) => r.fulfill({ status: 404, body: "no daily data" }));
}

// Serve a fixed "live daily" today.json so we can test the rules-method path.
const TODAY_FIXTURE = {
  date: "2026-07-02",
  source: "RTHK 財經",
  method: "rules",
  articles: [
    {
      id: "a0",
      title: "恒指升逾400點",
      source: "RTHK 財經",
      url: "https://news.rthk.hk/x",
      converted: false, // terse market data — no swaps needed
      method: "rules",
      sentences: [
        {
          id: 0,
          paragraph_id: 0,
          formal: "港股顯著造好。",
          colloquial: "港股顯著造好。",
          jyutping: ["gong2", "guk1", "hin2", "zoek6", "zou6", "hou2", ""],
        },
      ],
    },
  ],
};
async function forceToday(page) {
  await page.route("**/data/today.json", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TODAY_FIXTURE) }),
  );
}

maybe("renders the article list from bundled sample data", async () => {
  const page = await browser.newPage();
  await forceSample(page);
  await ready(page);
  const cards = await page.$$("#cards .card");
  assert.equal(cards.length, 3, "expected 3 sample article cards");
  const banner = await page.textContent("#banner");
  assert.match(banner, /demo|示範|演示/i);
  await page.close();
});

maybe("live today.json renders with a plain source/date banner", async () => {
  const page = await browser.newPage();
  await forceToday(page);
  await ready(page);
  const banner = await page.textContent("#banner");
  assert.match(banner, /RTHK/);
  assert.doesNotMatch(banner, /rough|粗略/i, "no rough-conversion disclaimer");
  assert.equal((await page.$$("#cards .card")).length, 1);
  await page.click("#cards .card:first-child");
  const rt = await page.$$eval(".colloquial .current .cc .jp", (els) => els.filter((e) => e.textContent.trim()).length);
  assert.ok(rt > 3, "jyutping present on live data");
  await page.close();
});

maybe("opening an article shows both panes with jyutping ruby", async () => {
  const page = await browser.newPage();
  await forceSample(page);
  await ready(page);
  await page.click("#cards .card:first-child");
  assert.equal(await page.isHidden("#list"), true);
  assert.equal(await page.isVisible("#reader"), true);

  const formalText = (await page.textContent("#formal-pane")).trim();
  const ccText = (await page.textContent("#colloquial-pane")).trim();
  assert.ok(formalText.length > 5, "formal pane has text");
  assert.ok(ccText.length > 5, "colloquial pane has text");

  // Current colloquial sentence renders per-character cells with jyutping.
  const rtCount = await page.$$eval(".colloquial .current .cc .jp", (els) => els.filter((e) => e.textContent.trim()).length);
  assert.ok(rtCount > 3, `expected jyutping annotations, got ${rtCount}`);

  // The current sentence is highlighted in BOTH panes.
  assert.equal(await page.$$eval(".current", (e) => e.length) >= 2, true);
  await page.close();
});

maybe("Next advances the current sentence; counter updates", async () => {
  const page = await browser.newPage();
  await forceSample(page);
  await ready(page);
  await page.click("#cards .card:first-child");
  const before = await page.textContent("#counter");
  await page.click("#btn-next");
  const afterText = await page.textContent("#counter");
  assert.notEqual(before, afterText, "counter should change after Next");
  await page.close();
});

maybe("when SpeechRecognition exists, the record button is shown", async () => {
  const page = await browser.newPage();
  await forceSample(page);
  await ready(page);
  await page.click("#cards .card:first-child");
  // Chromium exposes webkitSpeechRecognition, so grading is offered.
  assert.equal(await page.isVisible("#btn-record"), true);
  await page.close();
});

maybe("graceful degradation: strip SpeechRecognition -> record hidden + note shown", async () => {
  const page = await browser.newPage();
  // Remove the ASR API BEFORE the app's modules run.
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
  });
  await forceSample(page);
  await ready(page);
  await page.click("#cards .card:first-child");
  assert.equal(await page.isHidden("#btn-record"), true, "record button hidden without ASR");
  assert.equal(await page.isVisible("#note-asr"), true, "ASR degradation note shown");
  // Listening/reading still work: Play button still present.
  assert.ok(await page.$("#btn-play"), "play button still present");
  await page.close();
});

maybe("script toggle (Trad->Simp) changes displayed characters when OpenCC loads", async () => {
  const page = await browser.newPage();
  await forceSample(page);
  await ready(page);
  await page.click("#cards .card:first-child");
  const disabled = await page.$eval("#script-sel", (e) => e.disabled);
  if (disabled) {
    // OpenCC CDN unavailable in this environment — toggle correctly disabled.
    return;
  }
  const before = (await page.textContent("#colloquial-pane")).trim();
  await page.selectOption("#script-sel", "simp");
  const afterText = (await page.textContent("#colloquial-pane")).trim();
  assert.notEqual(before, afterText, "Simplified conversion should change text");
});

// ── V2 features ───────────────────────────────────────────────────────────────

const PAIRS_FIXTURE = {
  date: "2026-07-03",
  source: "RTHK 香港電台",
  method: "llm+verify",
  articles: [
    {
      id: "a0",
      title: "測試文章",
      source: "RTHK 財經",
      url: "https://news.rthk.hk/x",
      converted: true,
      method: "llm+verify",
      verified: true,
      sentences: [
        {
          id: 0,
          paragraph_id: 0,
          formal: "市場認為2020年表現理想。",
          colloquial: "市場覺得二零二零年表現理想。",
          jyutping: ["si5","coeng4","gok3","dak1","ji6","ling4","ji6","ling4","nin4","biu2","jin6","lei5","soeng2",""],
          pairs: [
            { f: "市場", c: "市場" },
            { f: "認為", c: "覺得" },
            { f: "2020", c: "二零二零" },
            { f: "年表現理想。", c: "年表現理想。" },
          ],
        },
      ],
    },
  ],
};

async function forcePairs(page) {
  await page.route("**/data/today.json", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PAIRS_FIXTURE) }),
  );
}

maybe("aligned pairs render as segments; tapping highlights both panes", async () => {
  const page = await browser.newPage();
  await forcePairs(page);
  await ready(page);
  await page.click("#cards .card:first-child");
  // Segments exist in both panes for the current sentence.
  const formalSegs = await page.$$("#formal-pane .current .seg");
  const ccSegs = await page.$$("#colloquial-pane .current .seg");
  assert.ok(formalSegs.length >= 4, "formal pane has segments");
  assert.ok(ccSegs.length >= 4, "colloquial pane has segments");
  // The changed phrase (認為→覺得) is marked as a diff and tappable.
  await page.click('#formal-pane .seg-diff[data-seg="1"]');
  const hl = await page.$$eval('.seg-hl[data-seg="1"]', (els) => els.length);
  assert.ok(hl >= 2, "tapping a phrase highlights it in BOTH panes (and interleaved)");
  // The spelled-out number has jyutping over every character.
  const numJp = await page.$$eval('#colloquial-pane .current .seg[data-seg="2"] .jp',
    (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
  assert.deepEqual(numJp, ["ji6", "ling4", "ji6", "ling4"]);
  // Verified banner is shown for llm+verify data (on the list page).
  await page.click("#back-btn");
  assert.equal(await page.isVisible("#verified-banner"), true);
  await page.close();
});

maybe("auto-play button is present and labelled", async () => {
  const page = await browser.newPage();
  await forceSample(page);
  await ready(page);
  await page.click("#cards .card:first-child");
  assert.ok(await page.$("#btn-auto"), "auto-play button exists");
  const key = await page.textContent("#btn-auto .key");
  assert.equal(key.trim(), "A");
  await page.close();
});

maybe("conversations: 8 category cards, sub-page with ≥4 scenarios, reader, back-routing", async () => {
  const page = await browser.newPage();
  await forceSample(page);
  await ready(page);
  assert.equal(await page.isVisible("#conv-block"), true, "conversations section visible");
  const cards = await page.$$("#conv-cards .card");
  assert.equal(cards.length, 8, `expected 8 category cards, got ${cards.length}`);
  // Category sub-page.
  await page.click("#conv-cards .card:first-child");
  assert.equal(await page.isVisible("#catpage"), true, "category sub-page visible");
  assert.equal(await page.isHidden("#list"), true);
  const scen = await page.$$("#cat-cards .card");
  assert.ok(scen.length >= 4, `expected ≥4 scenarios in category, got ${scen.length}`);
  // Open a scenario: speaker labels, jyutping, English gloss.
  await page.click("#cat-cards .card:first-child");
  assert.equal(await page.isVisible("#reader"), true);
  const spk = await page.$$eval("#colloquial-pane .spk", (els) => els.length);
  assert.ok(spk >= 2, "speaker labels rendered");
  const rt = await page.$$eval("#colloquial-pane .current .jp", (els) => els.filter((e) => e.textContent.trim()).length);
  assert.ok(rt > 3, "jyutping on conversation lines");
  assert.equal(await page.isVisible("#gloss"), true, "English gloss shown");
  // Back goes reader -> category page -> home.
  await page.click("#back-btn");
  assert.equal(await page.isVisible("#catpage"), true, "reader back returns to the category page");
  await page.click("#cat-back");
  assert.equal(await page.isVisible("#list"), true, "category back returns home");
  await page.close();
});

maybe("narrow viewport: two panes hide, interleaved view shows written above spoken", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await forcePairs(page);
  await ready(page);
  await page.click("#cards .card:first-child");
  assert.equal(await page.isHidden("#formal-pane"), true, "side-by-side panes hidden on mobile");
  assert.equal(await page.isVisible("#interleaved-pane"), true, "interleaved pane visible");
  // Written line and its spoken counterpart are adjacent inside one block.
  const block = await page.$("#interleaved-pane .il-block.current");
  assert.ok(block, "current interleaved block exists");
  assert.ok(await block.$(".il-formal"), "written line in block");
  assert.ok(await block.$(".il-colloquial .cc"), "spoken ruby line in block");
  await page.close();
});

maybe("pre-synthesised audio keeps Play/Auto enabled even without browser TTS", async () => {
  const page = await browser.newPage();
  // Strip the browser voice entirely — audio clips must carry playback alone.
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: undefined, configurable: true });
  });
  const FIX = JSON.parse(JSON.stringify(PAIRS_FIXTURE));
  FIX.articles[0].sentences[0].audio = "abc123def456.mp3";
  await page.route("**/data/today.json", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIX) }),
  );
  await ready(page);
  await page.click("#cards .card:first-child");
  assert.equal(await page.$eval("#btn-play", (e) => e.disabled), false, "Play enabled via audio");
  assert.equal(await page.$eval("#btn-auto", (e) => e.disabled), false, "Auto enabled via audio");
  assert.equal(await page.isHidden("#note-tts"), true, "no TTS warning when audio present");
  await page.close();
});

maybe("both panes auto-scroll in lockstep on long articles", async () => {
  const page = await browser.newPage();
  // A long article: enough sentences that both panes must scroll to reach the end.
  const LONG = {
    date: "2026-07-05",
    source: "RTHK 香港電台",
    method: "rules",
    articles: [{
      id: "a0",
      title: "長文章滾動測試",
      source: "RTHK 本地",
      url: "https://news.rthk.hk/x",
      converted: true,
      method: "rules",
      sentences: Array.from({ length: 30 }, (_, i) => ({
        id: i,
        paragraph_id: i,
        formal: `第${i + 1}句的書面語內容，講述當日發生的事件與背景。`,
        colloquial: `第${i + 1}句嘅口語內容，講吓當日發生嘅事同背景。`,
        jyutping: [],
      })),
    }],
  };
  await page.route("**/data/today.json", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LONG) }),
  );
  await ready(page);
  await page.click("#cards .card:first-child");
  // Jump straight to the last sentence via a DOM click (no Playwright scroll help).
  await page.$$eval("#colloquial-pane .sentence", (els) => els[els.length - 1].click());
  await page.waitForTimeout(800); // let smooth scrolling settle
  const [f, c] = await page.evaluate(() => [
    document.querySelector("#formal-pane").scrollTop,
    document.querySelector("#colloquial-pane").scrollTop,
  ]);
  assert.ok(c > 0, `colloquial pane scrolled (got ${c})`);
  assert.ok(f > 0, `formal pane scrolled too (got ${f}) — the drift bug`);
  // The current sentence is actually within view in BOTH panes.
  const visible = await page.evaluate(() => {
    const inView = (paneSel) => {
      const pane = document.querySelector(paneSel);
      const cur = pane.querySelector(".current");
      const pr = pane.getBoundingClientRect();
      const cr = cur.getBoundingClientRect();
      return cr.bottom > pr.top && cr.top < pr.bottom;
    };
    return [inView("#formal-pane"), inView("#colloquial-pane")];
  });
  assert.deepEqual(visible, [true, true], "current sentence visible in both panes");
  await page.close();
});
