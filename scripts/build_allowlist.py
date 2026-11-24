"""Build the allowlist files in data/allowlist/.

- official_uae.txt: every official domain in shared/brands.json.
- tranco_top.txt: the top N registered domains from a downloaded Tranco list, minus the free-hosting,
  tunnel and shortener domains in engine/config/signals.json.

Usage: python scripts/build_allowlist.py [path/to/top-1m.csv]
The Tranco step is skipped when no CSV is given.
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST_DIR = ROOT / "data" / "allowlist"


SIGNALS = json.loads((ROOT / "engine" / "config" / "signals.json").read_text(encoding="utf-8"))


def excluded_domains() -> set[str]:
    return {d.lower() for key in ("free_hosting", "tunnels", "shorteners") for d in SIGNALS[key]}


def build_official() -> int:
    brands = json.loads((ROOT / "shared" / "brands.json").read_text(encoding="utf-8"))
    rows = sorted({(d.lower(), b["id"]) for b in brands for d in b.get("official_domains", [])})
    lines = ["# Official domains of UAE brands, generated from shared/brands.json. Do not edit by hand."]
    lines += [f"{domain}\t{brand_id}" for domain, brand_id in rows]
    (ALLOWLIST_DIR / "official_uae.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(rows)


def build_tranco(csv_path: Path, top: int) -> int:
    excluded = excluded_domains()
    kept: list[str] = []
    with csv_path.open(encoding="utf-8") as handle:
        for _rank, domain in csv.reader(handle):
            domain = domain.strip().lower()
            if domain in excluded or any(domain.endswith("." + e) for e in excluded):
                continue
            kept.append(domain)
            if len(kept) >= top:
                break
    stamp = datetime.fromtimestamp(csv_path.stat().st_mtime, timezone.utc).date().isoformat()
    header = f"# Tranco top-sites list (https://tranco-list.eu/), top {len(kept)} after exclusions, downloaded {stamp}"
    (ALLOWLIST_DIR / "tranco_top.txt").write_text("\n".join([header, *kept]) + "\n", encoding="utf-8")
    return len(kept)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tranco_csv", nargs="?", type=Path)
    args = parser.parse_args()
    print(f"official_uae.txt: {build_official()} domains")
    if args.tranco_csv:
        print(f"tranco_top.txt: {build_tranco(args.tranco_csv, SIGNALS["tranco_top_n"])} domains")


if __name__ == "__main__":
    main()
