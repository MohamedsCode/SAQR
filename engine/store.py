"""Case store: scan results persisted in SQLite, plus in-memory jobs, reports and sweeps."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from collections.abc import Coroutine
from datetime import datetime, timezone

from discovery.helplines import fixture_sweep
from engine import db
from engine.brands import brands
from engine.normalize import InvalidInput, normalize
from engine.scanner import scan
from engine.settings import FIXTURES_DIR, settings
from shared.contract import (
    DiscoveredBy,
    DiscoveryRun,
    Job,
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
        self.maps_sweep: MapsSweep = fixture_sweep()
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

    def save(self, result: ScanResult) -> None:
        self.scans[result.id] = result
        db.save_scan(result)

    def spawn(self, coro: Coroutine) -> asyncio.Task:
        """Run a background task that demo reset can cancel."""
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def scan_and_store(self, text: str, discovered_by: DiscoveredBy = "user",
                             related_to: str | None = None) -> ScanResult:
        """Scan and save. related_to links the new case to the case it was discovered from, both ways."""
        result = await scan(text, discovered_by=discovered_by)
        earlier = [s for s in self.scans.values() if s.registered_domain == result.registered_domain]
        if earlier:
            result.first_seen = min([result.first_seen, *(s.first_seen for s in earlier)])
            result.related_ids = sorted({*result.related_ids, *(s.id for s in earlier)})[-20:]
        seed = self.scans.get(related_to) if related_to else None
        if seed:
            result.related_ids = sorted({*result.related_ids, seed.id})
            seed.related_ids = sorted({*seed.related_ids, result.id})
            self.save(seed)
        self.save(result)
        return result

    def start_job(self, inputs: list[str]) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], status="queued", created_at=utcnow(), total=len(inputs), done=0)
        self.jobs[job.id] = job
        self.spawn(self._run_job(job, inputs))
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
