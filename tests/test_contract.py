import inspect
import json
import re
from pathlib import Path

import pytest
from pydantic import BaseModel

import shared.contract as contract
from shared.contract import MapsListing, ScanResult, verdict_for

ROOT = Path(__file__).resolve().parent.parent
SCANS = json.loads((ROOT / "data/fixtures/sample_scans.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("raw", SCANS, ids=[s["id"] for s in SCANS])
def test_fixture_scan_is_consistent(raw):
    scan = ScanResult.model_validate(raw)
    assert scan.verdict == verdict_for(scan.score)
    assert scan.score == min(100, sum(r.weight for r in scan.reasons))
    assert all(rid in {s["id"] for s in SCANS} for rid in scan.related_ids)


def test_fixtures_cover_every_verdict_and_offline():
    scans = [ScanResult.model_validate(s) for s in SCANS]
    assert {s.verdict for s in scans} == {"safe", "suspicious", "fraud"}
    assert any(s.status == "offline" for s in scans)
    assert len({s.id for s in scans}) == len(scans)


def test_verdict_thresholds():
    assert verdict_for(0) == "safe"
    assert verdict_for(29) == "safe"
    assert verdict_for(30) == "suspicious"
    assert verdict_for(69) == "suspicious"
    assert verdict_for(70) == "fraud"
    assert verdict_for(100) == "fraud"


def test_maps_fixture_validates():
    raw = json.loads((ROOT / "data/fixtures/maps_results.json").read_text(encoding="utf-8"))
    for item in raw:
        MapsListing.model_validate({**item, "source": "fixture", "simulated": True, "seen_at": "2026-11-24T00:00:00Z"})


def test_brand_config_has_names():
    config = json.loads((ROOT / "shared/brand_config.json").read_text(encoding="utf-8"))
    for key in ("product_name_en", "product_name_ar", "tagline_en", "tagline_ar"):
        assert config[key]


def test_typescript_contract_mirrors_python():
    ts = (ROOT / "shared/contract.ts").read_text(encoding="utf-8")
    interfaces = {
        name: set(re.findall(r"^\s*(\w+)\??:", body, flags=re.M))
        for name, body in re.findall(r"export interface (\w+) \{(.*?)\n\}", ts, flags=re.S)
    }
    models = {
        name: cls for name, cls in inspect.getmembers(contract, inspect.isclass)
        if issubclass(cls, BaseModel) and cls is not BaseModel and cls.__module__ == contract.__name__
    }
    assert set(models) == set(interfaces)
    for name, cls in models.items():
        assert set(cls.model_fields) == interfaces[name], name
