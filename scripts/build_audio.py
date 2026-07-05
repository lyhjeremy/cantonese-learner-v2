#!/usr/bin/env python3
"""build_audio.py — pre-synthesise neural Cantonese audio for every sentence.

Runs in the daily GitHub Actions build (and locally). Reads the lesson JSONs,
synthesises each spoken-Cantonese sentence with Microsoft's free neural zh-HK
voices via edge-tts (the same engine as the sibling Mandarin Reader), writes
content-addressed MP3s into frontend/audio/, and injects an "audio" field into
each sentence so the frontend plays the natural neural voice instead of the
robotic browser speechSynthesis voice (which remains the offline fallback).

Reliability contract (ported from the Mandarin Reader's engine): up to 3
retries with backoff, 0-byte output treated as failure, write to a .part file
then os.replace(). FAIL-SOFT: a sentence that can't be synthesised simply gets
no "audio" field (the browser voice covers it); the script always exits 0.

News is read by a female anchor voice; conversation scenarios assign a voice
per speaker (alternating female/male) so dialogues sound like two people.
"""

import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

try:
    import edge_tts
except ImportError:
    print("edge-tts not installed — skipping audio build (browser TTS fallback).")
    sys.exit(0)

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "frontend" / "audio"

NEWS_VOICE = "zh-HK-HiuMaanNeural"  # neutral female anchor
# Conversation speakers get a voice by order of first appearance per scenario.
CONV_VOICES = ["zh-HK-HiuMaanNeural", "zh-HK-WanLungNeural", "zh-HK-HiuGaaiNeural"]

RETRY = 3
CONCURRENCY = 4

_sem = None


def audio_name(text: str, voice: str) -> str:
    return hashlib.sha1(f"{text}|{voice}".encode("utf-8")).hexdigest()[:16] + ".mp3"


async def synth(text: str, voice: str, path: Path) -> bool:
    """Synthesise with retry + atomic .part -> rename. True on success."""
    async with _sem:
        if path.exists() and path.stat().st_size > 0:
            return True  # content-addressed: already synthesised this run
        staging = path.with_suffix(".part")
        for attempt in range(1, RETRY + 1):
            try:
                await edge_tts.Communicate(text, voice=voice).save(str(staging))
                if staging.stat().st_size == 0:
                    raise RuntimeError("edge-tts wrote an empty file")
                os.replace(staging, path)
                return True
            except Exception as exc:
                if attempt == RETRY:
                    print(f"  ✖ synth failed: {text[:24]}… ({exc})")
                    return False
                await asyncio.sleep(2 * attempt)
    return False


def conv_voice_for(speaker, order: dict) -> str:
    """Stable per-scenario speaker -> voice mapping (order of appearance)."""
    key = json.dumps(speaker, ensure_ascii=False, sort_keys=True) if speaker else "?"
    if key not in order:
        order[key] = CONV_VOICES[len(order) % len(CONV_VOICES)]
    return order[key]


async def process(json_path: Path, kind: str) -> tuple[int, int]:
    """Synthesise one lesson file's sentences; inject audio fields; save."""
    if not json_path.exists():
        print(f"({json_path.name} absent — skipped)")
        return (0, 0)
    data = json.loads(json_path.read_text(encoding="utf-8"))

    jobs = []  # (sentence_dict, text, voice)
    if kind == "articles":
        for a in data.get("articles", []):
            for s in a.get("sentences", []):
                text = s.get("colloquial") or s.get("formal") or ""
                if text:
                    jobs.append((s, text, NEWS_VOICE))
    else:  # conversations (categories -> scenarios -> lines)
        for cat in data.get("categories", []):
            for sc in cat.get("scenarios", []):
                order = {}
                for s in sc.get("sentences", []):
                    text = s.get("colloquial") or ""
                    if text:
                        jobs.append((s, text, conv_voice_for(s.get("speaker"), order)))

    async def run_one(sentence, text, voice):
        name = audio_name(text, voice)
        ok = await synth(text, voice, AUDIO_DIR / name)
        if ok:
            sentence["audio"] = name
        return ok

    results = await asyncio.gather(*(run_one(*j) for j in jobs))
    done = sum(results)
    if done:
        json_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(f"{json_path.name}: {done}/{len(jobs)} sentences synthesised ({kind}).")
    return (done, len(jobs))


async def main():
    global _sem
    _sem = asyncio.Semaphore(CONCURRENCY)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    data_dir = ROOT / "frontend" / "data"
    total_done = total_jobs = 0
    for path, kind in [
        (data_dir / "today.json", "articles"),
        (data_dir / "conversations.json", "conversations"),
        (data_dir / "sample-lessons.json", "articles"),
    ]:
        done, jobs = await process(path, kind)
        total_done += done
        total_jobs += jobs
    mb = sum(f.stat().st_size for f in AUDIO_DIR.glob("*.mp3")) / 1e6
    print(f"Audio build: {total_done}/{total_jobs} clips, {mb:.1f} MB in frontend/audio/.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:  # fail-soft: never break the deploy
        print("build_audio failed (soft):", exc)
    sys.exit(0)
