"""Discovery runs (look-alike domains + certificate transparency) and campaign expansion from a fraud scan.

Every candidate is scored on its own evidence by the normal scanner. Being related to a fraud site never makes a
domain fraud by itself.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone

from discovery import crtsh
from discovery.graph import build_graph
from discovery.lookalike import generate
from engine import net
from engine.brands import brand_index, official_domains
from engine.layer_a import analyse
from engine.normalize import InvalidInput, normalize
from shared.contract import Brand, DiscoveredBy, DiscoveryRun, MapsListing, ScanResult

MAX_SCANS = 25
DNS_CONCURRENCY = 40
SCAN_CONCURRENCY = 4
CRT_KEYWORDS_PER_BRAND = 3

ScanFn = Callable[[str, DiscoveredBy], Awaitable[ScanResult]]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_run(brand_id: str | None, simulated: bool, kind: str = "discovery", seed_id: str | None = None) -> DiscoveryRun:
    return DiscoveryRun(id=uuid.uuid4().hex[:12], kind=kind, brand_id=brand_id, seed_id=seed_id, started_at=utcnow(),
                        status="running", simulated=simulated, candidates_checked=0)


def finish(run: DiscoveryRun) -> None:
    run.status = "done"
    run.finished_at = utcnow()


def primary_domains(brand: Brand) -> list[str]:
    """The brand's main domain (the one its reference page is on); look-alikes are generated from it."""
    if brand.reference_url:
        try:
            return [normalize(brand.reference_url).registered_domain]
        except InvalidInput:
            pass
    return brand.official_domains[:1]


def crt_keywords(brand: Brand) -> list[str]:
    """Distinctive brand words to search certificate logs for. Short words ('du', 'rta') match too much."""
    index = next(i for i in brand_index() if i.brand.id == brand.id)
    labels = sorted((l for l in index.official_labels if len(l) >= 4 and l.isascii()), key=len, reverse=True)
    tokens = sorted((t for t in index.tokens if len(t) >= 5 and t.isascii()), key=len, reverse=True)
    return list(dict.fromkeys(labels + tokens))[:CRT_KEYWORDS_PER_BRAND]


def impersonates(domain: str, brand_id: str) -> bool:
    try:
        layer = analyse(normalize(domain))
    except InvalidInput:
        return False
    return layer.override is None and layer.brand_id == brand_id


async def _scan_all(run: DiscoveryRun, targets: list[tuple[str, DiscoveredBy]], scan_fn: ScanFn) -> None:
    limit = asyncio.Semaphore(SCAN_CONCURRENCY)

    async def one(domain: str, source: DiscoveredBy) -> None:
        async with limit:
            try:
                result = await scan_fn(domain, source)
            except InvalidInput:
                return
        if result.verdict != "safe":
            run.found_ids.append(result.id)

    await asyncio.gather(*(one(d, s) for d, s in targets))


async def run_discovery(run: DiscoveryRun, brand: Brand, scan_fn: ScanFn, lookalikes: bool = True) -> None:
    """Find registered look-alikes and freshly certified brand domains, then scan up to MAX_SCANS of them."""
    candidates: dict[str, DiscoveredBy] = {}
    official = official_domains()

    for keyword in crt_keywords(brand):
        recent = await crtsh.recent_domains(keyword)
        run.candidates_total += len(recent)
        for domain in recent:
            run.candidates_checked += 1
            if domain not in official and impersonates(domain, brand.id):
                candidates.setdefault(domain, "crtsh")

    if lookalikes:
        generated = sorted(set().union(*(generate(d) for d in primary_domains(brand))) - set(official))
        run.candidates_total += len(generated)
        limit = asyncio.Semaphore(DNS_CONCURRENCY)

        async def check(domain: str) -> None:
            async with limit:
                exists = await net.domain_exists(domain)
            run.candidates_checked += 1
            if exists:
                candidates.setdefault(domain, "lookalike")

        await asyncio.gather(*(check(d) for d in generated))

    await _scan_all(run, list(candidates.items())[:MAX_SCANS], scan_fn)
    finish(run)


def simulated_discovery(run: DiscoveryRun, brand: Brand, scans: list[ScanResult]) -> None:
    """Without network access: report the brand's cases that discovery found earlier."""
    run.found_ids = [s.id for s in scans
                     if s.impersonated_brand == brand.id and s.discovered_by in {"lookalike", "crtsh"}]
    finish(run)


async def run_expansion(run: DiscoveryRun, seed: ScanResult, scans: list[ScanResult], listings: list[MapsListing],
                        scan_fn: ScanFn) -> None:
    """Scan domains sharing a certificate with the seed, and websites of Maps listings using the seed's phones."""
    candidates = await crtsh.certificate_siblings(seed.registered_domain)
    seed_phones = set(seed.evidence.phones_found)
    for listing in listings:
        if listing.url and seed_phones & set(listing.phones):
            try:
                candidates.add(normalize(listing.url).registered_domain)
            except InvalidInput:
                continue
    known = {s.registered_domain for s in scans} | set(official_domains())
    targets = sorted(candidates - known)[:MAX_SCANS]
    run.candidates_total = len(targets)

    async def scan_counted(domain: str, source: DiscoveredBy) -> ScanResult:
        try:
            return await scan_fn(domain, source)
        finally:
            run.candidates_checked += 1

    await _scan_all(run, [(d, "graph_expansion") for d in targets], scan_counted)
    finish(run)


def simulated_expansion(run: DiscoveryRun, seed: ScanResult, scans: list[ScanResult]) -> None:
    """Without network access: the seed's campaign siblings already in the case store."""
    graph = build_graph(scans, seed=seed.id)
    run.found_ids = [str(n.data["scan_id"]) for n in graph.nodes
                     if n.data.get("type") == "domain" and n.data.get("scan_id") != seed.id]
    run.candidates_total = run.candidates_checked = len(run.found_ids)
    finish(run)
