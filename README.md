# Cantonese Learner

**Learn to *speak* Cantonese from today's real Hong Kong news.**

Every day the app pulls a fresh batch of genuine RTHK news stories — local Hong
Kong news, Greater China, world, finance, and sport — and turns each one into a
**karaoke-style speaking lesson**. You see the news the way it's written on the
left, and the way a **Hong Kong TV anchor would say it** on the right, with
**jyutping** (romanised pronunciation) above every character. You listen, you
read it aloud, and the app tells you — character by character — how you did.

**▶️ Try it now: https://lyhjeremy.github.io/cantonese-learner/**

No sign-up, no install, no keys. Just open the link. (Use **Chrome** for the
speaking/scoring feature — Safari and Firefox can listen and read, but only
Chrome can grade your speech.)

![The reader](docs/reader-light.png)

---

## Who it's for

Someone who reads Chinese comfortably but wants to *speak* Cantonese — using
real, current news in plain, natural spoken Hong Kong style, not a textbook.

## How you use it

1. Open the link. You'll see today's ~12 news articles as cards.
2. Tap one. It opens as a side-by-side reader:
   - **Left** — the news in written Chinese.
   - **Right** — the same thing rewritten in spoken Cantonese, with **jyutping**
     over every character so you know how to pronounce it.
3. For each sentence:
   - Press **Play** (or `Space`) to hear it read aloud.
   - Press **Record** (or `R`) and read it aloud yourself. Take your time —
     press `R` again when you're done.
   - Each character lights up **green** (spot on), **amber** (right sound, close
     enough), or **red** (missed), with an overall score.
   - Move on whenever you like with **Next** (`→`).
4. Adjust to taste: **speed** (0.75/1.0/1.25×), **Traditional/Simplified**
   characters, and the **interface language** (English / 繁體 / 简体).

That's the whole thing. Everything below is for the curious and the technical.

---

## How it works (plain version)

- A robot job runs **once every morning** (06:00 Hong Kong time), for free, on
  GitHub's servers.
- It grabs the day's top stories from **RTHK's public news feeds**, rewrites each
  into spoken Cantonese, adds the jyutping, and saves the result.
- The website is just static files, so it loads instantly and costs nothing to
  host.
- Your **voice never leaves your computer for storage** — the listening, the
  speaking, and the scoring all happen right in your browser.

---

## Design decisions (the technical part)

This project deliberately optimises for **"a real person can run and use it with
zero setup and zero cost."** Almost every decision below follows from that. Where
the original spec assumed paid or heavy infrastructure, it was swapped for a
free, browser- or Actions-based equivalent, with graceful fallbacks throughout.

### Architecture: keyless by default, no server to run

```
GitHub Actions (daily cron, free)                     Browser (GitHub Pages, free)
┌────────────────────────────────────┐                ┌──────────────────────────────┐
│ 1. fetch RTHK RSS (5 topics)        │                │ loads today.json               │
│ 2. fetch each full article body     │  writes        │ • side-by-side reader + ruby   │
│ 3. rewrite → spoken Cantonese       │  today.json    │ • speechSynthesis TTS (zh-HK)  │
│ 4. add jyutping (to-jyutping)       │ ─────────────▶ │ • SpeechRecognition grading    │
│ 5. bake into the Pages deploy       │   (in deploy)  │ • trad⇄simp, tri-lingual UI    │
└────────────────────────────────────┘                └──────────────────────────────┘
```

- **No backend server.** GitHub Actions *is* the "cron + build server": it runs
  the daily job and publishes the result as part of the static site. There's
  nothing to deploy, pay for, or keep alive.
- **Everything fails soft.** If the news fetch fails, the site serves a bundled
  set of curated sample lessons. If a browser lacks a Cantonese voice or speech
  recognition, those features hide themselves and the rest keeps working.

### News source — RTHK RSS, keyless

- Uses **RTHK's free public RSS feeds** (no API key) across five topics: **本地**
  (Hong Kong local), **兩岸** (Greater China), **國際** (world), **財經**
  (finance), **體育** (sport). RTHK has no separate arts/culture feed; sport
  carries the lighter, cultural stories.
- The RSS summary is short, so for each chosen story the build **fetches the full
  article page and extracts the body** (`itemFullText`) for a proper multi-
  sentence lesson.
- **Balanced selection.** Rather than take the "top 12" (which would be mostly
  finance), the build ranks each topic's stories by a *newsworthiness* heuristic
  (down-weights number-heavy market tickers, up-weights real-news vocabulary) and
  then **round-robins across topics**, guaranteeing a spread of ~12 varied
  lessons a day.
- **The headline is never spoken.** The article title is shown as the reader
  heading only; the recording/grading uses the article *body*, starting from its
  first real sentence.

### The rewrite: written Chinese → spoken Cantonese

This is the heart of the app, and there are **two modes**:

1. **Rule-based (default, keyless).** A hand-built converter applies the
   well-known written→spoken swaps — 是→係, 的→嘅, 了→咗, 不→唔, 沒有→冇, 現在→而家,
   我們→我哋, and so on — using a single-pass, longest-match scan that protects
   compounds (e.g. the 不 in 不過 isn't mangled). It's rough — it swaps vocabulary
   but doesn't restructure grammar — and it's honest about it (the UI shows a
   "rule-based" banner). It costs nothing and needs no key.
2. **Claude (optional, higher quality).** If you add an `ANTHROPIC_API_KEY` as a
   GitHub Actions secret, the daily build instead rewrites each sentence with
   **Claude Opus 4.8** for genuinely natural anchor-Cantonese, and the "rough"
   banner disappears. Cost is a few cents/day at ~12 articles. See *Optional
   upgrade* below. **No key → it stays fully keyless.**

Either way, **jyutping is always computed locally** by the `to-jyutping` library,
so it's accurate and free regardless of the rewrite mode.

### Speaking + listening — the browser's own speech engine

- **Text-to-speech** uses the browser's built-in `speechSynthesis` with a
  Cantonese (`zh-HK`) voice — free, on-device, no key. It re-resolves the voice
  fresh on every play to dodge a Chrome bug where a cached voice silently reverts
  to English, and it shows you *which* voice is being used. If no Cantonese voice
  exists it falls back to any Chinese voice and says so.
- **Speech recognition** uses the browser's `SpeechRecognition` (`yue-Hant-HK`),
  which today means **Chrome**. Where it's unavailable, the grading UI hides
  itself and listening/reading still work.
- **Recording is patient.** It gives you up to 8 seconds to *start* speaking and
  tolerates ~3.5-second pauses mid-sentence (so you can think between characters),
  and you end it yourself by pressing `R` again. It never cuts you off after one
  word.

### Scoring — lenient on purpose

Browser Cantonese recognition is imperfect, so the grader is built to **not
punish a correct read**. It aligns what you said against the target with an
edit-distance alignment (so one missed character doesn't cascade), then accepts a
character as correct under three kinds of leniency:

- **Script** — Traditional vs Simplified is normalised (學 == 学), via OpenCC.
- **Register** — if the recogniser returns the *standard-written* form of a
  spoken word (是 for 係, 了 for 咗…), that still counts.
- **Homophones (同音字)** — if you pronounce a character correctly but the
  recogniser hears a *different character with the same/similar sound*, it still
  counts (shown amber). This uses a bundled **toneless jyutping dictionary**
  (~27k characters, generated from `to-jyutping`), matched toneless so tone
  confusion is forgiven too.

There is **no pass/fail gate and no auto-advance** — the score and colours are
feedback only; you decide when to move on. (Earlier versions auto-advanced at a
threshold; that was removed once recording became a deliberate press-to-finish
action.)

### Reading experience

- **Side-by-side**, always: written on the left, spoken + jyutping on the right,
  matched in font size and line spacing.
- Each character on the spoken side is a **uniform fixed-width cell** with its
  jyutping centred above, so spacing stays even no matter how long a romanisation
  is.
- Current sentence highlighted in both panes; whole paragraph shown for context;
  sentences never split mid-way. Light and dark mode; fits one screen.
- **Tri-lingual UI** (English / Traditional / Simplified), keyboard shortcuts on
  every button, settings remembered in `localStorage`.

---

## Run it locally

No build step for the site itself — it's plain HTML/CSS/JS.

```bash
npm install          # only needed for tests / the news builder
npm run serve        # serves the app at http://localhost:5173
```

To fetch a fresh set of lessons into `frontend/data/today.json`:

```bash
npm run build:news   # keyless: RTHK RSS + rule-based rewrite + jyutping
```

## Deploy

Push to `main`. The workflow in `.github/workflows/pages.yml` builds the day's
lessons and publishes `frontend/` to GitHub Pages. It also re-runs on a daily
cron (06:00 HKT) to refresh the news.

## Hosting, cost & maintenance

**It runs itself, for free — there's essentially nothing to maintain.**

- **Daily updates, hands-off.** Every morning at **06:00 Hong Kong time**
  (`cron: "0 22 * * *"` UTC) the Actions job re-fetches RTHK, rebuilds the
  lessons, and redeploys. (GitHub's scheduler can be a few minutes late; that's
  normal.)
- **Cost: $0.** It's a static site on GitHub Pages from a public repo, so both
  hosting and Actions are free at this scale. No server, no database, no paid API
  in the running app — nothing to patch, host, or rotate.
- **Your friends cost you nothing.** Everything runs in *their* browser:
  text-to-speech uses their device's own Cantonese voice, and speech scoring uses
  Chrome's built-in recognition. **No key or account of yours is ever used when
  someone uses the app** — whether 1 friend or 1,000, it stays $0.
- **Keep-alive.** GitHub disables scheduled workflows after 60 days with no new
  commits, which would silently stop the daily update.
  [`.github/workflows/keepalive.yml`](.github/workflows/keepalive.yml) makes a
  tiny commit twice a month so that never happens. (If it ever does stop,
  re-enable it once in the repo's **Actions** tab.)
- **What can break, and how it fails safe.** The daily build depends on RTHK's
  public feeds. If RTHK changes them, the build **fails soft** — the site serves
  the bundled *sample* lessons instead of going blank. A glance at the banner
  (it shows today's date) confirms it's healthy.
- **What your friends need.** A Cantonese voice on their device for playback —
  Apple devices include "Sinji"; some Windows/Android setups don't, in which case
  Play simply hides itself and reading/scoring still work. The speaking/scoring
  feature needs **Chrome**; reading works in any browser.
- **The optional Claude rewrite is the only thing that could ever cost money** —
  it's **off by default**. If you enable it (below), the *daily build* calls
  Claude once per day (a few cents/day regardless of traffic); set a monthly cap
  in the Anthropic console.

## Optional upgrade: natural rewrite via Claude

To swap the rough rule-based rewrite for **Claude Opus 4.8** (much more natural
Cantonese), add one secret — no code change, no other service:

1. GitHub repo → **Settings → Secrets and variables → Actions → New secret**
2. Name it `ANTHROPIC_API_KEY`, value = your Anthropic API key
3. Re-run the deploy workflow (or wait for the daily cron)

The build detects the key, rewrites each sentence via Claude, and drops the
"rule-based" banner. Jyutping is still local. Cost is a few cents/day; set a
monthly cap in the Anthropic console. Remove the secret to go back to keyless.

---

## Tests

```bash
npm test           # 45 tests: build logic + grader + Playwright browser e2e
npm run test:unit  # non-browser tests only
npm run validate:data
```

- **Chunking / RSS / rewrite** — CJK sentence chunking & packing, RSS parse +
  full-body extraction + newsworthiness scoring, rule-based conversion
  (longest-match, compound protection), and the optional Claude call (mocked).
- **Grader** — edit-distance alignment (one miss doesn't cascade), script
  normalisation, register leniency, and homophone leniency.
- **Browser e2e (Playwright)** — renders sample + live lessons, jyutping ruby,
  navigation, live Trad→Simp conversion, and graceful degradation when speech
  recognition is unavailable — each with a deterministically routed data source.

## Repository layout

```
frontend/        the static site (GitHub Pages)
  index.html     reader UI
  app.js         reader, transport, toggles, tri-lingual UI, data loading
  grader.js      speech recognition + lenient char grading (script/register/homophone)
  tts.js         zh-HK text-to-speech with voice re-resolution
  i18n.js        English / Traditional / Simplified labels
  data/          sample-lessons.json (offline fallback), jyutping.json (homophone dict),
                 today.json (generated daily, not committed)
backend/         shared, dependency-free logic used by the build
  chunk.js       CJK sentence chunking + packing
  rss.js         RTHK RSS ingestion, full-body extraction, newsworthiness scoring
  convert-rules.js  keyless written→spoken Cantonese converter
  convert.js     optional Claude (Opus 4.8) rewrite
scripts/         build-lessons (daily builder), build-jyutping-dict, dev server, validator
tests/           node:test unit tests + Playwright e2e
.github/workflows/
  pages.yml      daily build (06:00 HKT) + Pages deploy
  keepalive.yml  twice-monthly commit so the schedule never auto-disables
```

See [`CANTONESE_FINANCE_LEARNER_OVERVIEW.md`](./CANTONESE_FINANCE_LEARNER_OVERVIEW.md)
for the original project brief (note: the built app differs from that spec in
several places — this README describes what was actually built).
