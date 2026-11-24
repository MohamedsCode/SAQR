"""In-memory store seeded from the fixtures. The detection engine replaces it with SQLite."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone

from engine.settings import FIXTURES_DIR, SHARED_DIR
from shared.contract import (
    Brand,
    DiscoveryRun,
    Job,
    MapsListing,
    MapsSweep,
    PhoneMatch,
    PhoneStatus,
    Report,
    ScanResult,
)

_DEFANG = [
    (re.compile(r"^hxxp", re.I), "http"),
    (re.compile(r"\[\.\]|\(\.\)|\[dot\]", re.I), "."),
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def host_of(text: str) -> str:
    """Lower-cased host of a URL-ish string, without scheme, port, path or a leading www."""
    value = text.strip().strip(".,;:!?'\"<>()")
    for pattern, replacement in _DEFANG:
        value = pattern.sub(replacement, value)
    value = re.sub(r"^[a-z][a-z0-9+.-]*://", "", value, flags=re.I)
    host = re.split(r"[/?#]", value, maxsplit=1)[0].rsplit("@", 1)[-1].split(":", 1)[0]
    return host.lower().removeprefix("www.")


def phone_hash(number_e164: str) -> str:
    return hashlib.sha256(number_e164.encode("utf-8")).hexdigest()


class Store:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        raw_scans = json.loads((FIXTURES_DIR / "sample_scans.json").read_text(encoding="utf-8"))
        self.scans: dict[str, ScanResult] = {
            s.id: s for s in (ScanResult.model_validate(item) for item in raw_scans)
        }
        raw_brands = json.loads((SHARED_DIR / "brands.json").read_text(encoding="utf-8"))
        self.brands: dict[str, Brand] = {
            b.id: b for b in (Brand.model_validate(item) for item in raw_brands)
        }
        self.jobs: dict[str, Job] = {}
        self.reports: list[Report] = []
        self.discovery_runs: list[DiscoveryRun] = []
        self.maps_sweep = self.fixture_sweep()

    def fixture_sweep(self) -> MapsSweep:
        now = utcnow()
        raw = json.loads((FIXTURES_DIR / "maps_results.json").read_text(encoding="utf-8"))
        listings = [
            MapsListing.model_validate({**item, "source": "fixture", "simulated": True, "seen_at": now})
            for item in raw
        ]
        return MapsSweep(simulated=True, ran_at=now, listings=listings)

    def find_scan(self, text: str) -> ScanResult | None:
        host = host_of(text)
        for scan in self.scans.values():
            if host and host == host_of(scan.normalized_url):
                return scan
        return None

    def add_job(self, inputs: list[str]) -> Job:
        matched: list[str] = []
        unmatched: list[str] = []
        for text in inputs:
            scan = self.find_scan(text)
            if scan:
                matched.append(scan.id)
            else:
                unmatched.append(text)
        job = Job(
            id=uuid.uuid4().hex[:12],
            status="done",
            created_at=utcnow(),
            total=len(inputs),
            done=len(inputs),
            result_ids=matched,
            unmatched=unmatched,
        )
        self.jobs[job.id] = job
        return job

    def add_report(self, text: str, kind: str) -> Report:
        report = Report(id=uuid.uuid4().hex[:12], input=text, type=kind, received_at=utcnow())
        self.reports.append(report)
        return report

    def phone_registry(self) -> dict[str, tuple[PhoneStatus, str | None]]:
        """E.164 number -> (status, brand_id). Only verified official numbers count as official."""
        registry: dict[str, tuple[PhoneStatus, str | None]] = {}
        for listing in self.maps_sweep.listings:
            if listing.phone_status == "fake_listing":
                for number in listing.phones:
                    registry[number] = ("fake_listing", listing.brand_id)
        for scan in self.scans.values():
            if scan.verdict == "fraud":
                for number in scan.evidence.phones_found:
                    registry[number] = ("reported_scam", scan.impersonated_brand)
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
