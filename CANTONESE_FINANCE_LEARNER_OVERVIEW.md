# Cantonese Finance Learner — Full Project Overview & Build Spec

> **Note:** this is the *original* build spec. The app that was actually built
> differs in several places to make it free and zero-setup — it uses **RTHK RSS
> feeds** (not GNews), a **daily GitHub Actions job** (not a Cloudflare Worker),
> and the **browser's own speech engine** (not edge-tts / Whisper). See
> **[`README.md`](./README.md)** for how the shipped app actually works.

> A hand-off / spec document for building a **daily financial-news → interactive
> Cantonese learning web app**. It is a sibling of the *Mandarin Learning Reader*
> and the *EPUB→Audiobook Generator*, and it reuses their proven ideas
> (sentence-chunked karaoke read-along, edge-tts synthesis, offline Whisper
> grading, lenient script-aware scoring) but repurposes them for a **new
> audience and a new content source**.
>
> **Point a fresh Claude Code session at this file to build the whole thing.**
>
> **Audience:** mainland-Chinese finance/PE professionals who read Chinese
> fluently but don't speak Cantonese well and want to learn it. The hook is that
> the study material is **real, current business & finance news** in their own
> field, rendered the way **Hong Kong TV news anchors** actually speak it.

---

## 1. What this project is (in one paragraph)

A **web app** (so friends can just open a link — hosted on GitHub Pages, with a
tiny serverless backend) that every morning fetches the day's **top 3–5
financial news articles in Chinese**, and turns each into a **karaoke-style
Cantonese speaking lesson**. The screen shows the article **side by side**: the
**formal written Chinese** on the left and a **spoken-Cantonese ("porh-tung"
news-anchor style) rewrite** on the right, with **jyutping romanisation under
every character**. The learner steps through it **one sentence at a time** —
listen to it read aloud in Cantonese (edge-tts `zh-HK`), record themselves
saying it, and get **character-level green/red feedback** with an accuracy score
(offline Whisper). At **≥ 90 %** it **auto-advances**; otherwise they replay,
re-record, or press **Next**. Everything is **free to run** except a small,
**you-controlled** Claude API spend for the formal→colloquial conversion (the key
stays server-side; users never see it).

---

## 2. Relationship to the sibling projects (what to reuse vs. what's new)

**Reuse the *ideas / patterns* (not the Python line-for-line — this is a web app):**

- **Sentence chunking with smart packing** — the Mandarin Reader's
  `chunk_text_for_learning()`: split on CJK terminators (。！？；…) **and** commas/
  colons (，、：), then re-pack fragments that are too short into speakable units.
  Port this logic to JS/TS on the backend.
- **CJK language logic** — `cjk_fraction()`, character counting, Chinese speech-
  rate assumptions.
- **edge-tts synthesis contract** — retry + atomic write + **skip-if-cached**.
  Per-sentence audio, cached by a hash of (text + voice + speed).
- **Offline Whisper grading** — record → transcribe locally → **character-level
  compare** → green/red → accuracy %.
- **Script-aware, lenient grading** — the Mandarin Reader learned that Whisper
  often returns Traditional even for Simplified input, so grade in a *normalised*
  script (学 == 學) and be **lenient** (right sound / wrong character counts as a
  soft/amber match). Do the same here.
- **Karaoke read-along UX** — current sentence big & highlighted; surrounding
  context dimmed; keyboard shortcuts printed on the buttons (from the modern
  `mandarin_learner_gui_v2.py`).

**What's genuinely NEW in this project:**

- **Live daily news ingestion** (not a user-supplied EPUB) from **one free news
  API**, cached per-day.
- **Formal-written → spoken-Cantonese rewrite** via the **Claude API** (this is
  the novel core; see §6).
- **Cantonese**, not Mandarin: `zh-HK` voices, **jyutping** (not pinyin),
  Cantonese-aware grading.
- **Side-by-side** formal vs. colloquial display (always visible, not a toggle).
- **A real web app** with a **serverless backend** to hide the API key — the
  siblings were local desktop/CLI apps.
- **Tri-lingual UI** (English / Traditional / Simplified) for all labels.

---

## 3. The exact product decisions (locked with the owner)

These are settled. Build to them.

**Content**
- **One** free news source to start (see §5: **GNews** free tier). Fetch the
  **top 3–5** Chinese-language finance/business articles.
- **We** pick the 3–5 (top of the feed) — the user does **not** choose from a
  huge list. The user *does* pick **which of those 3–5** to open.
- **Daily fetch at ~06:00** (owner's local time), automatically. Store that
  day's set. A rolling few days of cache is fine; don't hoard.

**Text rendering**
- **Side by side, always:** left = **formal written** article; right =
  **spoken-Cantonese** rewrite. Not a toggle — both permanently visible.
- **Register for the rewrite:** **Hong Kong TV-news anchor** Cantonese — *between*
  stiff written Chinese and street-casual. Natural to listen to, still polished.
  (Not overly colloquial.)
- **Jyutping under every character** on the Cantonese side (learners need to know
  what to read).
- **Context, never cut mid-sentence:** highlight the **current sentence** larger;
  show surrounding context. Simplest correct rule: **show the whole paragraph**
  the sentence belongs to (falls back to "≥ 20–30 chars before + ≥ 30–50 after,
  snapped to sentence boundaries" if paragraphs are huge). Never split a sentence.

**Toggles (apply to both panes)**
- **Script:** Traditional ⇄ Simplified (OpenCC-equivalent in JS).
- **Voice:** male / female `zh-HK`.
- **Speed:** 0.75× / 1.0× / 1.25×.
- **UI language:** English / Traditional / Simplified — user chooses; all three
  supported.

**Speaking loop**
- Per sentence: **Play** (listen) → **Record** (speak) → **feedback**.
- Grading shows **both** character-level green/red **and** an accuracy %.
- **Lenient** matching (right sound / wrong character = soft match).
- **Auto-advance at ≥ 90 %**, else the user **Replays / Re-records / Next**.
- **Keyboard shortcuts printed on every button** (Space = Play, R = Record,
  → = Next, etc.).

**Non-goals / explicitly deferred**
- No user accounts, no login. Progress/resume is **nice-to-have only**, and if
  done, keep it purely client-side (`localStorage`). Do **not** build a user DB.
- No paid APIs of any kind. If an `zh-HK` edge-tts voice sounds poor, note it and
  we'll swap the TTS later — don't block the build on it.

---

## 4. Architecture — keep a clean 3-layer split (same discipline as the siblings)

```
                        ┌───────────────────────────────────────────┐
   Browser (GitHub      │  FRONTEND  (static, hosted on GitHub Pages) │
   Pages)               │  index.html + app.(js|ts) + styles         │
                        │  • side-by-side reader + jyutping           │
                        │  • <audio> playback, MediaRecorder capture  │
                        │  • local Whisper (whisper.cpp / transformers│
                        │    .js WASM) for on-device grading          │
                        │  • tri-lingual UI, toggles, shortcuts       │
                        └───────────────┬─────────────────────────────┘
                                        │ fetch() JSON
                                        ▼
                        ┌───────────────────────────────────────────┐
   Serverless           │  BACKEND  (serverless fn — Cloudflare       │
   (hides API key,      │  Worker / Vercel / Netlify function)        │
   runs the daily cron) │  • GET /api/today   → today's lessons JSON  │
                        │  • daily cron 06:00 → fetch news, convert,  │
                        │    cache to KV/blob                         │
                        │  • holds GNEWS_KEY + ANTHROPIC_API_KEY as    │
                        │    secrets (never shipped to browser)       │
                        └───────────────┬─────────────────────────────┘
                                        │
                    ┌───────────────────┴────────────────────┐
                    ▼                                         ▼
        ┌────────────────────┐                    ┌────────────────────────┐
        │  GNews free API    │                    │  Claude API (Haiku 4.5) │
        │  Chinese finance   │                    │  formal→spoken-Cantonese │
        │  headlines         │                    │  rewrite + sentence      │
        └────────────────────┘                    │  chunking assist         │
                                                   └────────────────────────┘
```

**Why a serverless backend at all?** Two reasons the owner cares about:
1. **The Claude and GNews keys must never reach the browser.** A static-only
   site can't hold a secret. A tiny serverless function can.
2. **Spend control.** All Claude calls happen **once per day** on the server
   (the cron), not per-user-per-sentence. The converted result is **cached**, so
   ten friends reading the same article cost the **same** as one. This is the
   single biggest cost lever — see §7.

**Cheapest hosting that satisfies both:** a **Cloudflare Worker + Workers KV**
(generous free tier, built-in cron triggers, built-in KV cache) or **Vercel/
Netlify functions + their cron + blob/KV**. Any of these is free at this scale.
Frontend stays on **GitHub Pages** so the owner gets the "just share a link"
outcome; the Pages site calls the Worker's `/api/today`.

**Suggested repo layout**
```
cantonese-finance-learner/
├─ README.md
├─ CANTONESE_FINANCE_LEARNER_OVERVIEW.md   ← this file
├─ frontend/                 # deployed to GitHub Pages
│  ├─ index.html
│  ├─ app.js                 # reader, recorder, grader, toggles
│  ├─ jyutping.js            # char → jyutping (see §6)
│  ├─ opencc.js              # trad⇄simp in-browser
│  ├─ whisper/               # WASM model + glue (on-device STT)
│  └─ styles.css
├─ backend/                  # Cloudflare Worker (or Vercel fn)
│  ├─ worker.js              # /api/today + scheduled cron
│  ├─ news.js                # GNews fetch + article selection
│  ├─ convert.js             # Claude prompt + call (the core, §6)
│  ├─ chunk.js               # CJK sentence chunking + packing
│  └─ wrangler.toml          # KV binding, cron "0 22 * * *" (=06:00 HKT)
└─ docs/                     # screenshots for the showcase
```

---

## 5. News ingestion (the free source)

**Use GNews** (`https://gnews.io`). Verified fit:
- **Free tier: 100 requests/day, no credit card.** We need ~1 request/day, so
  we're wildly within budget.
- Serves **Chinese-language** articles with `lang=zh`, and its China top-headlines
  demonstrably return finance/markets stories (期货, 证券, 黄金/白银, etc.).
- Clean JSON: `title, description, content, url, image, publishedAt, lang, source`.

**Endpoint pattern**
```
GET https://gnews.io/api/v4/top-headlines
      ?category=business&lang=zh&max=10&apikey=GNEWS_KEY
# or a keyword search for finance specifically:
GET https://gnews.io/api/v4/search
      ?q=財經 OR 股市 OR 經濟&lang=zh&max=10&apikey=GNEWS_KEY
```

**Selection logic:** take the feed, keep the top articles that (a) are majority-
CJK (`cjk_fraction` ≥ 0.5) and (b) have enough body text to be worth studying
(e.g. ≥ 120 chars, mirroring the Mandarin Reader's `--min-chars`). Keep the
**first 3–5** that pass. Store them.

**Caveats to bake in (learned from the news-API landscape):**
- The GNews **free tier truncates `content`** (a snippet, not always the whole
  article) and is **dev/personal-use** oriented. For a few friends studying,
  that's fine — and a snippet of a few sentences is *plenty* for a daily lesson.
  If fuller text is ever wanted, that's a later, paid concern — don't block on it.
- Always store the **`url`** and **`source.name`** and show a "read original at
  source" link + attribution. Don't reproduce whole articles beyond the
  study snippet; link out for the full piece.
- If GNews returns nothing usable on a given day, **keep yesterday's set** rather
  than showing an empty app.

---

## 6. The core new subsystem: formal → spoken-Cantonese conversion

This is the heart of the app and the only thing that costs money. Do it **once
per article per day, server-side, cached.**

**Model:** `claude-haiku-4-5` (the cheapest current model, $1 / $5 per M
input/output tokens). Haiku is more than strong enough for a rewrite task.

**What the call must return (ask for strict JSON, no prose, no markdown fences):**
For each article, a list of **sentence units**, each with:
```json
{
  "formal":      "該公司公布季度盈利按年增長15%。",
  "colloquial":  "呢間公司公布季度盈利按年升咗15%。",
  "jyutping":    ["ni1","gaan1","gung1","si1", "..."],   // per char, colloquial side
  "paragraph_id": 3
}
```
- Do the **sentence chunking on the server first** (§ port of `chunk_text_for_
  learning`), then send chunks to Claude for the rewrite — this keeps sentence
  alignment exact between the two panes. (Alternatively let Claude both split and
  rewrite; splitting-first is more controllable.)
- Provide the **jyutping** either from Claude or, more cheaply/reliably, from a
  **local jyutping dictionary in JS** (e.g. a CC-CANTO / jyutping table). Prefer
  the dictionary; use Claude only for the *rewrite*. This keeps token costs down.

**Prompt design for the rewrite (the register is the whole game):**
Instruct Claude to rewrite each formal sentence into **Hong Kong TV-news-anchor
spoken Cantonese** — natural to say aloud, using spoken particles/words where a
news reader would (係, 嘅, 咗, 呢個, 而家…), **without** going full street-slang.
Keep numbers, company names, and financial terms intact. Preserve meaning
exactly. Output must stay parallel — one colloquial sentence per formal sentence.

**Worked examples to include in the prompt (few-shot), matching the owner's taste:**
- Formal: 「該公司宣布季度收益增長15%」
  → Anchor Cantonese: 「呢間公司公布季度收益升咗15%」
- Formal: 「市場分析人士指出該趨勢預示著潛在的經濟風險」
  → Anchor Cantonese: 「市場分析員話呢個趨勢可能反映經濟有潛在風險」

(Note the target sits *between* the two registers — polished, but the way it's
actually *spoken* on a HK news broadcast, not read verbatim off the page.)

**Cost & spend control:** one day's 5 articles is on the order of a few thousand
input + output tokens total → **fractions of a US cent per day**. Even so:
- Call Claude **only in the daily cron**, never from the browser, never per user.
- **Cache** the converted JSON in KV keyed by date; serve all users from cache.
- The owner sets a **hard monthly spend cap** in the Anthropic console as a
  backstop. Optionally have the worker refuse to call if a daily call-count env
  guard is exceeded.

---

## 7. Frontend behaviour (the karaoke reader)

- On load, `GET /api/today` → render the **3–5 article cards**; user taps one.
- **Reader view:** two columns (formal | colloquial+jyutping). The **current
  sentence** is enlarged/highlighted in both columns simultaneously; the rest of
  its **paragraph** is shown at normal/dimmed size for context. Sentences before/
  after scroll like karaoke.
- **Transport bar** with keyboard-key labels on the buttons:
  - **Play** (Space) — play the current sentence's cached `zh-HK` audio.
  - **Record** (R) — capture mic via `MediaRecorder`.
  - grade on stop → paint each character green/red on the colloquial side, show %.
  - **Replay** / **Re-record** / **Next** (→) / **Prev** (←).
  - Voice male/female, Speed 0.75/1.0/1.25, Script Trad/Simp, UI-lang selector.
- **Auto-advance** to the next sentence when score ≥ 90 %.
- **On-device grading:** run Whisper in the browser (whisper.cpp WASM or
  `transformers.js` `whisper-base`/`small`) so **no audio leaves the machine** —
  matches the siblings' privacy stance and keeps the backend free of audio.
  Configure it for **Cantonese** (`yue`/`zh`). Grade with the **lenient, script-
  normalised** comparison ported from the Mandarin Reader.
- **Audio source:** simplest is to have the **cron pre-synthesize** each
  sentence's `zh-HK` audio (both voices, three speeds is 6 files — or synth on
  first request and cache) and serve the mp3s from KV/blob; the browser just
  plays a URL. This keeps `edge-tts` server-side and the frontend a pure static
  site. (If you'd rather, a serverless `/api/tts?...` that streams+caches works
  too.)
- **Aesthetic:** clean, modern, Apple-/premium-product feel. Lots of whitespace,
  restrained type scale, one accent colour, light **and** dark mode. Big legible
  CJK type (auto CJK font stack); jyutping in a smaller, lighter weight above/
  below each glyph. This is a **finance-professional** audience — make it look
  like a polished product, not a class project.

---

## 8. Graceful degradation (same philosophy as the siblings)

Every hard dependency should fail *soft*, disabling only its own feature:
- **No GNews response today** → serve the most recent cached day.
- **Claude conversion fails for one article** → still show the formal text; mark
  the colloquial pane "conversion unavailable, showing formal."
- **No jyutping for a rare char** → show the char without romanisation, don't crash.
- **Mic/Whisper unavailable** (permissions, old browser) → the listen/read-along
  still fully works; just hide the grading UI with a note.
- **edge-tts hiccup** → retry (the sibling 4× pattern); if still failing, the text
  lesson works without audio.

---

## 9. Build order (suggested for the Claude Code session)

1. **Backend skeleton** — Cloudflare Worker with `/api/today` returning a
   hard-coded sample lesson JSON; get GitHub-Pages frontend talking to it.
2. **News fetch** (`news.js`) — GNews call + CJK/length filtering + pick 3–5.
3. **Chunking** (`chunk.js`) — port `chunk_text_for_learning` to JS; unit-test on
   a sample article.
4. **Conversion** (`convert.js`) — Claude Haiku call with the few-shot rewrite
   prompt; strict-JSON parse; wire jyutping from a local dict.
5. **Daily cron + KV cache** — assemble today's lessons once at 06:00, cache;
   `/api/today` serves cache.
6. **Pre-synthesize audio** in the cron (edge-tts `zh-HK`, 2 voices × 3 speeds or
   on-demand+cache); store mp3 URLs in the lesson JSON.
7. **Frontend reader** — side-by-side panes, jyutping, current-sentence
   highlight, whole-paragraph context, toggles, shortcut-labelled transport.
8. **On-device Whisper grading** — MediaRecorder → WASM Whisper (Cantonese) →
   lenient script-normalised char grading → green/red + % → auto-advance ≥ 90 %.
9. **Tri-lingual UI** — En / Trad / Simp label tables + selector.
10. **Polish** — dark/light, responsive, empty/error states, README + docs/
    screenshots, deploy (Pages + Worker), share the link.

---

## 10. Gotchas to remember

- **Keys are secrets.** `GNEWS_KEY` and `ANTHROPIC_API_KEY` live only as
  serverless env vars / Wrangler secrets. Never in frontend code, never in the
  repo, never in the JSON sent to the browser.
- **Claude calls: daily + cached only.** Per-user or per-sentence calls would
  multiply cost for no benefit — the rewrite is identical for everyone.
- **Cron timezone.** Cloudflare cron is UTC; 06:00 HKT = `0 22 * * *` UTC.
- **edge-tts is an unofficial free endpoint** — rate-limited & occasionally
  flaky; keep the retry/atomic/skip-cache pattern, and pre-synthesize in the cron
  rather than live per keystroke.
- **Whisper Cantonese accuracy** is lower than Mandarin — that's *why* grading is
  **lenient** and script-normalised. Don't tune it strict.
- **GNews free `content` is truncated** and dev-tier — fine for a study snippet;
  always link to the original and attribute the source; don't reproduce whole
  articles.
- **CORS:** the Worker must send permissive CORS headers so the Pages origin can
  call `/api/today` and the audio URLs.
- **CJK fonts & jyutping alignment:** use a proper CJK stack and lay out jyutping
  as ruby-style annotations so it stays aligned per character.

---

*Written as a hand-off spec for a sibling of the Mandarin Learning Reader /
EPUB→Audiobook projects. Point a fresh Claude Code session at this file to build
the Cantonese Finance Learner from scratch.*
