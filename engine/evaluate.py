"""Precision, recall and false-positive checks on a labelled URL set."""

from __future__ import annotations

import asyncio
import csv
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from engine.brands import official_brand_for_host, tranco_top
from engine.browser import pool
from engine.normalize import InvalidInput
from engine.scanner import Mode, scan
from shared.contract import FRAUD_MIN, SUSPICIOUS_MIN, ScanResult


@dataclass
class Row:
    url: str
    label: str
    source: str
    split: str


@dataclass
class Outcome:
    row: Row
    result: ScanResult | None

    @property
    def phishing(self) -> bool:
        return self.row.label == "phishing"


def load(path: Path, split: str | None) -> list[Row]:
    with path.open(encoding="utf-8") as handle:
        rows = [Row(r["url"], r["label"].strip().lower(), r.get("source", ""), r.get("split", ""))
                for r in csv.DictReader(handle)]
    return [r for r in rows if not split or r.split == split]


async def run(rows: list[Row], mode: Mode, concurrency: int) -> list[Outcome]:
    try:
        return await _run(rows, mode, concurrency)
    finally:
        await pool.close()


async def _run(rows: list[Row], mode: Mode, concurrency: int) -> list[Outcome]:
    limit = asyncio.Semaphore(concurrency)

    async def one(row: Row) -> Outcome:
        async with limit:
            try:
                return Outcome(row, await scan(row.url, discovered_by="batch", mode=mode))
            except InvalidInput:
                return Outcome(row, None)

    return await asyncio.gather(*(one(r) for r in rows))


def metrics(outcomes: list[Outcome], threshold: int) -> dict[str, float | int]:
    tp = fp = tn = fn = 0
    for o in outcomes:
        flagged = bool(o.result) and o.result.score >= threshold
        if o.phishing and flagged:
            tp += 1
        elif o.phishing:
            fn += 1
        elif flagged:
            fp += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"threshold": threshold, "tp": tp, "fp": fp, "tn": tn, "fn": fn, "precision": round(precision, 4),
            "recall": round(recall, 4), "f1": round(f1, 4), "n": len(outcomes)}


def allowlist_false_positives(outcomes: list[Outcome]) -> list[str]:
    """Legitimate official or Tranco-top URLs that were flagged (score >= suspicious). Must be empty."""
    def protected(o: Outcome) -> bool:
        host = urlsplit(o.result.normalized_url).hostname or ""
        domain = o.result.registered_domain
        return bool(official_brand_for_host(host)) or domain in tranco_top() or domain.endswith(".gov.ae")

    return [o.row.url for o in outcomes
            if not o.phishing and o.result and o.result.score >= SUSPICIOUS_MIN and protected(o)]


def report(outcomes: list[Outcome], mode: Mode) -> dict:
    by_source: dict[str, list[Outcome]] = defaultdict(list)
    for o in outcomes:
        by_source[o.row.source].append(o)
    per_source = {}
    for source, items in sorted(by_source.items()):
        label = items[0].row.label
        hits = sum(1 for o in items if o.result and o.result.score >= SUSPICIOUS_MIN)
        frauds = sum(1 for o in items if o.result and o.result.score >= FRAUD_MIN)
        per_source[source] = {"label": label, "n": len(items), "flagged": hits, "fraud": frauds}
    confusion = Counter(
        (o.row.label, o.result.verdict if o.result else "invalid") for o in outcomes
    )
    offline = [o for o in outcomes if o.result and o.result.status == "offline"]
    return {
        "mode": mode,
        "fraud_threshold": metrics(outcomes, FRAUD_MIN),
        "flagged_threshold": metrics(outcomes, SUSPICIOUS_MIN),
        "confusion": {f"{label}->{verdict}": count for (label, verdict), count in sorted(confusion.items())},
        "allowlist_false_positives": allowlist_false_positives(outcomes),
        "offline": metrics(offline, FRAUD_MIN) if mode == "network" else None,
        "per_source": per_source,
    }


def sweep(outcomes: list[Outcome]) -> list[dict]:
    return [metrics(outcomes, t) for t in range(20, 95, 5)]
