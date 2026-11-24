"""Dashboard KPIs."""

from __future__ import annotations

from collections import Counter

from fastapi import APIRouter

from engine.store import host_of, store
from shared.contract import Stats

router = APIRouter()


@router.get("/stats", response_model=Stats)
def stats() -> Stats:
    scans = list(store.scans.values())
    reported_hosts = {host_of(r.input) for r in store.reports if r.type == "url"}
    flagged = [s for s in scans if s.verdict != "safe"]
    found_before_report = [
        s for s in flagged
        if s.discovered_by != "user" and host_of(s.normalized_url) not in reported_hosts
    ]
    detect_hours = [
        (s.first_seen - s.evidence.rdap.created).total_seconds() / 3600
        for s in flagged
        if s.evidence.rdap and s.evidence.rdap.created
    ]
    fake_helplines = {
        number
        for listing in store.maps_sweep.listings
        if listing.phone_status == "fake_listing"
        for number in listing.phones
    }
    return Stats(
        scans=len(scans),
        fraud_found=sum(s.verdict == "fraud" for s in scans),
        suspicious_found=sum(s.verdict == "suspicious" for s in scans),
        found_before_report=len(found_before_report),
        fake_helplines=len(fake_helplines),
        avg_hours_to_detect=round(sum(detect_hours) / len(detect_hours), 1) if detect_hours else None,
        by_source=dict(Counter(s.discovered_by for s in scans)),
    )
