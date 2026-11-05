"""Read the daily build logs and record which rewrite tier each build used (2026-11-05).

scripts/build-lessons.mjs tries Claude (only with ANTHROPIC_API_KEY), then GitHub
Models (GPT-4.1 rewrite plus a GPT-4.1-mini review pass), then the rule-based
converter. It prints one summary line per build:
    Wrote today.json: 12 articles, 282 sentences (rewrite: rules - github-models ...)
and one line per failed GitHub Models call. This script downloads the logs of every
successful "Build daily lessons and deploy to Pages" run that GitHub still keeps
(about 90 days), and for each one records the tier, article and sentence counts,
GitHub Models error lines, and how long the "Build today's lessons" step took.

Needs an authenticated `gh` CLI. Writes builds.csv and summary.json next to this file.
Usage: python3 eval/build_logs/scan.py
"""
import csv
import io
import json
import re
import subprocess
import zipfile
from collections import Counter
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = "lyhjeremy/cantonese-learner-v2"
WROTE = re.compile(r"Wrote today\.json: (\d+) articles, (\d+) sentences \(rewrite: (\S+)")
GHERR = re.compile(r"github-models: (\S+) (.+?)\s*$", re.M)


def gh(*args, binary=False):
    out = subprocess.run(["gh", *args], capture_output=True, check=False)
    return out.stdout if binary else out.stdout.decode()


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main():
    runs = json.loads(gh("run", "list", "-R", REPO, "--workflow", "pages.yml", "--limit", "400",
                         "--json", "databaseId,event,conclusion,createdAt"))
    rows = []
    for r in runs:
        if r["conclusion"] != "success":
            continue
        blob = gh("api", f"repos/{REPO}/actions/runs/{r['databaseId']}/logs", binary=True)
        try:
            z = zipfile.ZipFile(io.BytesIO(blob))
        except zipfile.BadZipFile:
            continue  # log expired
        text = "\n".join(z.read(n).decode("utf-8", "replace") for n in z.namelist()
                         if n.endswith(".txt") and "/" not in n)
        m = WROTE.search(text)
        errs = Counter(f"{a} {b.strip()}" for a, b in GHERR.findall(text))
        jobs = json.loads(gh("api", f"repos/{REPO}/actions/runs/{r['databaseId']}/jobs"))
        step_s = None
        for j in jobs.get("jobs", []):
            for st in j.get("steps", []):
                if st["name"] == "Build today's lessons" and st.get("completed_at"):
                    step_s = (ts(st["completed_at"]) - ts(st["started_at"])).total_seconds()
        rows.append({
            "run_id": r["databaseId"], "event": r["event"], "created_at": r["createdAt"],
            "articles": int(m.group(1)) if m else None, "sentences": int(m.group(2)) if m else None,
            "tier": m.group(3) if m else None,
            "github_models_errors": "; ".join(f"{k} x{v}" for k, v in sorted(errs.items())),
            "build_step_s": step_s,
        })
    rows.sort(key=lambda x: x["created_at"])
    with open(HERE / "builds.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    tiers = Counter(r["tier"] for r in rows)
    err_runs = Counter("HTTP 410 on both models" if "410" in r["github_models_errors"]
                       else ("other error lines" if r["github_models_errors"] else "no error line")
                       for r in rows)
    steps = sorted(r["build_step_s"] for r in rows if r["build_step_s"] is not None)
    summary = {
        "date": date.today().isoformat(), "builds_with_logs": len(rows),
        "first": rows[0]["created_at"], "last": rows[-1]["created_at"],
        "tier_counts": dict(tiers), "github_models_error_pattern": dict(err_runs),
        "articles_per_build": dict(Counter(r["articles"] for r in rows)),
        "build_step_s_median": steps[len(steps) // 2] if steps else None,
        "build_step_s_max": steps[-1] if steps else None,
    }
    (HERE / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
