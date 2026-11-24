"""Command line: scan a list of URLs, or evaluate the engine on a labelled set.

  python -m engine.cli scan --input urls.txt|urls.csv --output results.csv [--mode url|network]
  python -m engine.cli evaluate --input data/datasets/labeled.csv [--split test] [--mode url|network] [--sweep]
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from pathlib import Path

from engine import evaluate as ev
from engine.normalize import InvalidInput
from engine.scanner import default_mode, scan
from engine.settings import RUNTIME_DIR, settings

COLUMNS = ["input", "normalized_url", "registered_domain", "status", "score", "verdict", "impersonated_brand",
           "category", "top_reasons", "summary_en"]


def read_inputs(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    if path.suffix.lower() == ".csv":
        rows = list(csv.reader(text.splitlines()))
        if rows and rows[0] and rows[0][0].strip().lower() in {"url", "input"}:
            rows = rows[1:]
        return [r[0].strip() for r in rows if r and r[0].strip()]
    return [line.strip() for line in text.splitlines() if line.strip()]


async def scan_many(inputs: list[str], mode: str, concurrency: int) -> list[dict]:
    limit = asyncio.Semaphore(concurrency)

    async def one(text: str) -> dict:
        async with limit:
            try:
                r = await scan(text, discovered_by="batch", mode=mode)
            except InvalidInput as exc:
                return {"input": text, "status": "error", "summary_en": str(exc)}
            return {
                "input": text, "normalized_url": r.normalized_url, "registered_domain": r.registered_domain,
                "status": r.status, "score": r.score, "verdict": r.verdict,
                "impersonated_brand": r.impersonated_brand or "", "category": r.category or "",
                "top_reasons": "; ".join(x.code for x in r.reasons[:3]), "summary_en": r.summary_en,
            }

    return await asyncio.gather(*(one(t) for t in inputs))


def cmd_scan(args: argparse.Namespace) -> int:
    rows = asyncio.run(scan_many(read_inputs(args.input), args.mode, args.concurrency))
    with args.output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    counts = {v: sum(1 for r in rows if r.get("verdict") == v) for v in ("safe", "suspicious", "fraud")}
    print(f"{len(rows)} scanned -> {args.output}  {counts}")
    return 0


def _print_metrics(title: str, m: dict) -> None:
    print(f"{title:28} P={m['precision']:.3f} R={m['recall']:.3f} F1={m['f1']:.3f}  "
          f"tp={m['tp']} fp={m['fp']} tn={m['tn']} fn={m['fn']}")


def cmd_evaluate(args: argparse.Namespace) -> int:
    rows = ev.load(args.input, args.split)
    if not rows:
        print("No rows to evaluate.")
        return 1
    outcomes = asyncio.run(ev.run(rows, args.mode, args.concurrency))
    result = ev.report(outcomes, args.mode)
    print(f"Evaluated {len(rows)} URLs (split={args.split or 'all'}, mode={args.mode})")
    _print_metrics("fraud (score >= 70)", result["fraud_threshold"])
    _print_metrics("flagged (score >= 30)", result["flagged_threshold"])
    if result["offline"]:
        _print_metrics("offline URLs only", result["offline"])
    print("Confusion:", json.dumps(result["confusion"]))
    fps = result["allowlist_false_positives"]
    print(f"False positives on official / allowlisted domains: {len(fps)}")
    for url in fps[:20]:
        print("   ", url)
    print("Per source:")
    for source, s in result["per_source"].items():
        print(f"   {source:22} {s['label']:9} n={s['n']:5} flagged={s['flagged']:5} fraud={s['fraud']:5}")
    if args.sweep:
        print("Threshold sweep:")
        for m in ev.sweep(outcomes):
            _print_metrics(f"   score >= {m['threshold']}", m)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    out = RUNTIME_DIR / f"eval_{args.split or 'all'}_{args.mode}.json"
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Report saved to {out}")
    return 1 if fps else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m engine.cli", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("scan", "evaluate"):
        p = sub.add_parser(name)
        p.add_argument("--input", type=Path, required=True)
        p.add_argument("--mode", choices=["url", "network"], default=default_mode())
        p.add_argument("--concurrency", type=int, default=settings.page_concurrency * 4)
        if name == "scan":
            p.add_argument("--output", type=Path, required=True)
        else:
            p.add_argument("--split", choices=["train", "test"])
            p.add_argument("--sweep", action="store_true")
    args = parser.parse_args(argv)
    return cmd_scan(args) if args.command == "scan" else cmd_evaluate(args)


if __name__ == "__main__":
    sys.exit(main())
