"""Collect real deep links from the legitimate homepages in the labelled dataset.

Without them nearly every legitimate URL in the dataset is a homepage, and a model learns "has a path = phishing".
For each legitimate homepage this fetches the page and keeps up to two links to pages on the same site.

Usage: python scripts/crawl_legit_links.py [--dataset data/datasets/labeled.csv] [--sites 2000]
Writes data/runtime/feeds/legit_links.txt, which scripts/build_dataset.py reads with --legit-links.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import random
import sys
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.net import DESKTOP_UA  # noqa: E402
from engine.normalize import InvalidInput, normalize  # noqa: E402

DATASET = ROOT / "data" / "datasets" / "labeled.csv"
OUTPUT = ROOT / "data" / "runtime" / "feeds" / "legit_links.txt"
HOMEPAGE_SOURCES = {"tranco_top", "tranco_deeper", "tranco_uae", "official"}
SKIP_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".css", ".js", ".pdf", ".zip", ".xml", ".ico")
LINKS_PER_SITE = 2
SEED = 2026


def registered(url: str) -> str | None:
    try:
        return normalize(url).registered_domain
    except InvalidInput:
        return None


def pick_links(base: str, html: str, domain: str, rng: random.Random) -> list[str]:
    links = set()
    for anchor in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        url = urljoin(base, anchor["href"].strip()).split("#")[0]
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or parts.path in ("", "/"):
            continue
        if parts.path.lower().endswith(SKIP_EXTENSIONS) or registered(url) != domain:
            continue
        links.add(url)
    return rng.sample(sorted(links), min(LINKS_PER_SITE, len(links)))


async def crawl(homepages: list[str], concurrency: int) -> list[str]:
    rng = random.Random(SEED)
    limit = asyncio.Semaphore(concurrency)
    found: list[str] = []
    done = 0

    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0), follow_redirects=True,
                                 headers={"User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9,ar;q=0.8"},
                                 verify=False) as client:
        async def one(url: str) -> None:
            nonlocal done
            domain = registered(url)
            async with limit:
                try:
                    response = await client.get(url)
                    if response.status_code == 200 and "html" in response.headers.get("content-type", ""):
                        found.extend(pick_links(str(response.url), response.text, domain, rng))
                except (httpx.HTTPError, ValueError):
                    pass
            done += 1
            if done % 100 == 0 or done == len(homepages):
                print(f"    {done}/{len(homepages)} sites, {len(found)} links", flush=True)

        await asyncio.gather(*(one(u) for u in homepages))
    return found


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dataset", type=Path, default=DATASET)
    parser.add_argument("--sites", type=int, default=2000)
    parser.add_argument("--concurrency", type=int, default=32)
    args = parser.parse_args()
    with args.dataset.open(encoding="utf-8") as handle:
        homepages = [r["url"] for r in csv.DictReader(handle)
                     if r["label"] == "legit" and r["source"] in HOMEPAGE_SOURCES and urlsplit(r["url"]).path in ("", "/")]
    homepages = random.Random(SEED).sample(homepages, min(args.sites, len(homepages)))
    links = asyncio.run(crawl(homepages, args.concurrency))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(sorted(set(links))) + "\n", encoding="utf-8")
    print(f"{OUTPUT}: {len(set(links))} deep links from {len(homepages)} legitimate sites")


if __name__ == "__main__":
    main()
