"""Case store: scan results persisted in SQLite, plus in-memory jobs, reports and sweeps."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timezone

from engine import db
from engine.brands import brands
from engine.normalize import InvalidInput, normalize
from engine.scanner import scan
from engine.settings import FIXTURES_DIR, settings
from shared.contract import (
    DiscoveredBy,
    DiscoveryRun,
    Job,
    MapsListing,
    MapsSweep,
    PhoneMatch,
    PhoneStatus,
    Report,
    ScanResult,
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def host_of(text: str) -> str:
    """Host of a URL-ish string without a leading www, or '' when there is none."""
    try:
        return normalize(text).host.removeprefix("www.")
    except InvalidInput:
        return ""


def phone_hash(number_e164: str) -> str:
    return hashlib.sha256(number_e164.encode("utf-8")).hexdigest()


class Store:
    def __init__(self) -> None:
        self.scans: dict[str, ScanResult] = {s.id: s for s in db.load_scans()}
        self._init_memory()
        if not self.scans and settings.seed_fixtures:
            self.seed_fixtures()

    def _init_memory(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.reports: list[Report] = []
        self.discovery_runs: list[DiscoveryRun] = []
        self.maps_sweep = self.fixture_sweep()
        self._tasks: set[asyncio.Task] = set()

    @property
    def brands(self):
        return brands()

    def reset(self) -> None:
        for task in self._tasks:
            task.cancel()
        db.clear_scans()
        self.scans = {}
        self._init_memory()
        if settings.seed_fixtures:
            self.seed_fixtures()

    def seed_fixtures(self) -> None:
        raw = json.loads((FIXTURES_DIR / "sample_scans.json").read_text(encoding="utf-8"))
        for item in raw:
            self.save(ScanResult.model_validate(item))

    def fixture_sweep(self) -> MapsSweep:
        now = utcnow()
        raw = json.loads((FIXTURES_DIR / "maps_results.json").read_text(encoding="utf-8"))
        listings = [
            MapsListing.model_validate({**item, "source": "fixture", "simulated": True, "seen_at": now})
            for item in raw
        ]
        return MapsSweep(simulated=True, ran_at=now, listings=listings)

    def save(self, result: ScanResult) -> None:
        self.scans[result.id] = result
        db.save_scan(result)

    async def scan_and_store(self, text: str, discovered_by: DiscoveredBy = "user") -> ScanResult:
        result = await scan(text, discovered_by=discovered_by)
        earlier = [s for s in self.scans.values() if s.registered_domain == result.registered_domain]
        if earlier:
            result.first_seen = min([result.first_seen, *(s.first_seen for s in earlier)])
            result.related_ids = sorted({*result.related_ids, *(s.id for s in earlier)})[-20:]
        self.save(result)
        return result

    def start_job(self, inputs: list[str]) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], status="queued", created_at=utcnow(), total=len(inputs), done=0)
        self.jobs[job.id] = job
        task = asyncio.get_running_loop().create_task(self._run_job(job, inputs))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job

    async def _run_job(self, job: Job, inputs: list[str]) -> None:
        job.status = "running"
        limit = asyncio.Semaphore(settings.page_concurrency)

        async def one(text: str) -> None:
            async with limit:
                try:
                    result = await self.scan_and_store(text, discovered_by="batch")
                    job.result_ids.append(result.id)
                except InvalidInput:
                    job.failed.append(text)
                finally:
                    job.done += 1

        await asyncio.gather(*(one(text) for text in inputs))
        job.status = "done"

    def add_report(self, text: str, kind: str) -> Report:
        report = Report(id=uuid.uuid4().hex[:12], input=text, type=kind, received_at=utcnow())
        self.reports.append(report)
        return report

    def phone_registry(self) -> dict[str, tuple[PhoneStatus, str | None]]:
        """Number -> (status, brand_id). Only verified official numbers count as official."""
        registry: dict[str, tuple[PhoneStatus, str | None]] = {}
        for listing in self.maps_sweep.listings:
            if listing.phone_status == "fake_listing":
                for number in listing.phones:
                    registry[number] = ("fake_listing", listing.brand_id)
        for result in self.scans.values():
            if result.verdict == "fraud":
                for number in result.evidence.phones_found:
                    registry[number] = ("reported_scam", result.impersonated_brand)
        for brand in self.brands.values():
            for phone in brand.official_phones:
                if phone.verified:
                    registry[phone.number] = ("official", brand.id)
        return registry

    def phone_matches(self, hash_prefix: str) -> list[PhoneMatch]:
        matches = []
        for number, (status, brand_id) in self.phone_registry().items():
            digest = phone_hash(number)
            if digest.startswith(hash_prefix):
                matches.append(PhoneMatch(suffix_hash=digest[5:], status=status, brand_id=brand_id))
        return matches


store = Store()
