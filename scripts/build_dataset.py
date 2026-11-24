"""Build data/datasets/labeled.csv (url, label, source, split) for engine evaluation.

Phishing: the OpenPhish free feed, a sample of Phishing.Database's active links, and generated UAE look-alikes.
Legitimate: Tranco top sites (homepages and common login/payment paths), UAE .ae sites from deeper in Tranco,
every official brand domain, and real deep links collected from those sites by scripts/crawl_legit_links.py. Rows are split 70/30 into train/test by registered domain, so a domain never
appears in both halves.

Usage:
  python scripts/build_dataset.py --openphish data/runtime/feeds/openphish.txt \
      --phishdb data/runtime/feeds/phishing-links-ACTIVE.txt --tranco data/runtime/tranco/top-1m.csv       --legit-links data/runtime/feeds/legit_links.txt
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from discovery.lookalike import generate  # noqa: E402
from engine.brands import SIGNALS, brands  # noqa: E402
from engine.normalize import InvalidInput, normalize  # noqa: E402

OUTPUT = ROOT / "data" / "datasets" / "labeled.csv"
LEGIT_PATHS = ["/login", "/signin", "/account", "/pay", "/payment", "/support", "/help", "/en/contact-us"]
LOOKALIKE_PATHS = ["/", "/pay", "/login", "/verify", "/fines/pay", "/track", "/update-card", "/otp"]
SEED = 2026


def read_lines(path: Path | None) -> list[str]:
    if not path:
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    return [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")]


def read_tranco(path: Path | None) -> list[str]:
    if not path:
        return []
    with path.open(encoding="utf-8") as handle:
        return [row[1].strip().lower() for row in csv.reader(handle) if len(row) >= 2]


def split_for(registered_domain: str) -> str:
    bucket = int(hashlib.sha256(registered_domain.encode()).hexdigest(), 16) % 10
    return "test" if bucket < 3 else "train"


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the labelled evaluation dataset.")
    parser.add_argument("--openphish", type=Path)
    parser.add_argument("--phishdb", type=Path)
    parser.add_argument("--tranco", type=Path)
    parser.add_argument("--legit-links", type=Path)
    parser.add_argument("--phishdb-sample", type=int, default=3000)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    rng = random.Random(SEED)

    rows: list[tuple[str, str, str]] = []
    rows += [(u, "phishing", "openphish") for u in read_lines(args.openphish)]
    phishdb = read_lines(args.phishdb)
    rows += [(u, "phishing", "phishing_database") for u in rng.sample(phishdb, min(len(phishdb), args.phishdb_sample))]

    for brand in brands().values():
        for domain in brand.official_domains:
            rows.append((f"https://{domain}/", "legit", "official"))
            rows.append((f"https://www.{domain}{rng.choice(LEGIT_PATHS)}", "legit", "official"))
            candidates = sorted(generate(domain))
            for candidate in rng.sample(candidates, min(len(candidates), 6)):
                rows.append((f"https://{candidate}{rng.choice(LOOKALIKE_PATHS)}", "phishing", "generated_lookalike"))

    tranco = read_tranco(args.tranco)
    top_n = SIGNALS["tranco_top_n"]
    top, deeper = tranco[:top_n], tranco[top_n:100_000]
    for domain in rng.sample(top, min(len(top), 1500)):
        rows.append((f"https://{domain}/", "legit", "tranco_top"))
    for domain in rng.sample(top, min(len(top), 300)):
        rows.append((f"https://www.{domain}{rng.choice(LEGIT_PATHS)}", "legit", "tranco_top_paths"))
    for domain in rng.sample(deeper, min(len(deeper), 600)):
        rows.append((f"https://{domain}/", "legit", "tranco_deeper"))
    uae = [d for d in tranco[top_n:] if d.endswith(".ae")]
    for domain in rng.sample(uae, min(len(uae), 600)):
        rows.append((f"https://{domain}/", "legit", "tranco_uae"))

    rows += [(u, "legit", "legit_deep_links") for u in read_lines(args.legit_links)]

    seen: set[str] = set()
    written = {"phishing": 0, "legit": 0}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["url", "label", "source", "split"])
        for url, label, source in rows:
            try:
                registered = normalize(url).registered_domain
            except InvalidInput:
                continue
            if url in seen:
                continue
            seen.add(url)
            writer.writerow([url, label, source, split_for(registered)])
            written[label] += 1
    print(f"{args.output}: {written['phishing']} phishing, {written['legit']} legitimate")


if __name__ == "__main__":
    main()
