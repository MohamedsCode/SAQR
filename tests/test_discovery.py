import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from discovery import crtsh, helplines, runner
from engine import net
from engine.app import app
from engine.brands import brands
from engine.settings import settings
from engine.store import store
from shared.contract import MapsListing, ScanResult

NOW = datetime.now(timezone.utc)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/api/demo/reset")
        yield c


def fake_result(domain: str, source: str, verdict: str) -> ScanResult:
    return ScanResult(id=f"SQ-{domain}", input=domain, normalized_url=f"https://{domain}/", registered_domain=domain,
                      scanned_at=NOW, status="live", score=80 if verdict == "fraud" else 0, verdict=verdict,
                      summary_en="", summary_ar="", discovered_by=source, first_seen=NOW)


def recording_scan(verdicts: dict[str, str]):
    calls: list[tuple[str, str]] = []

    async def scan(domain, source):
        calls.append((domain, source))
        return fake_result(domain, source, verdicts.get(domain, "safe"))

    return scan, calls


def test_crt_keywords_skip_short_words():
    assert "salik" in runner.crt_keywords(brands()["salik"])
    assert all(len(k) >= 4 for b in brands().values() for k in runner.crt_keywords(b))


def test_discovery_scans_existing_lookalikes_and_new_certificates(monkeypatch):
    async def recent(keyword, days=30):
        return {"salik-recharge.top": NOW, "salik.ae": NOW, "unrelated-shop.com": NOW}

    async def exists(domain):
        return domain in {"sa1ik.ae", "salik-pay.com"}

    monkeypatch.setattr(crtsh, "recent_domains", recent)
    monkeypatch.setattr(net, "domain_exists", exists)
    scan, calls = recording_scan({"salik-recharge.top": "fraud", "sa1ik.ae": "suspicious"})
    run = runner.new_run("salik", simulated=False)
    asyncio.run(runner.run_discovery(run, brands()["salik"], scan))
    assert dict(calls) == {"salik-recharge.top": "crtsh", "sa1ik.ae": "lookalike", "salik-pay.com": "lookalike"}
    assert sorted(run.found_ids) == ["SQ-sa1ik.ae", "SQ-salik-recharge.top"]
    assert run.status == "done" and run.candidates_checked == run.candidates_total > 100


def test_expansion_scans_certificate_and_phone_siblings_only_once(monkeypatch):
    async def siblings(domain):
        return {"rta-fines-pay.top", "rta.ae", "known-case.top"}

    monkeypatch.setattr(crtsh, "certificate_siblings", siblings)
    seed = fake_result("rta-fines-uae.top", "user", "fraud")
    seed.evidence.phones_found = ["+971525550199"]
    listing = MapsListing(id="ML-1", brand_id="rta", query="q", name="RTA fines desk", url="https://rta-help.cyou/",
                          phones=["+971525550199"], phone_status="fake_listing", source="fixture", simulated=True,
                          seen_at=NOW)
    scan, calls = recording_scan({"rta-help.cyou": "fraud"})
    run = runner.new_run("rta", simulated=False, kind="expansion", seed_id=seed.id)
    asyncio.run(runner.run_expansion(run, seed, [seed, fake_result("known-case.top", "user", "fraud")], [listing], scan))
    assert sorted(calls) == [("rta-fines-pay.top", "graph_expansion"), ("rta-help.cyou", "graph_expansion")]
    assert run.found_ids == ["SQ-rta-help.cyou"] and run.candidates_checked == 2


def test_recent_domains_filters_by_age_and_keyword(monkeypatch):
    async def entries(query):
        return [
            {"name_value": "*.salik-topup.xyz\nwww.salik-topup.xyz", "entry_timestamp": NOW.isoformat()},
            {"name_value": "old-salik.com", "entry_timestamp": (NOW - timedelta(days=90)).isoformat()},
            {"name_value": "cdn.example.com", "entry_timestamp": NOW.isoformat()},
        ]

    monkeypatch.setattr(crtsh, "_entries", entries)
    assert set(asyncio.run(crtsh.recent_domains("salik"))) == {"salik-topup.xyz"}


def test_certificate_siblings(monkeypatch):
    async def entries(query):
        return [{"name_value": "a-pay.top\nb-pay.top\nwww.a-pay.top", "entry_timestamp": None},
                {"name_value": "other.top", "entry_timestamp": None}]

    monkeypatch.setattr(crtsh, "_entries", entries)
    assert asyncio.run(crtsh.certificate_siblings("a-pay.top")) == {"b-pay.top"}


def test_helpline_classification():
    official = next(p.number for p in brands()["rta"].official_phones if p.verified and p.number.startswith("+"))
    assert helplines.classify("RTA Customer Happiness", None, [official], "rta") == ("official", "rta")
    assert helplines.classify("RTA Fines Help Desk", None, ["+971525550111"], "rta") == ("fake_listing", "rta")
    assert helplines.classify("RTA Service Centre", "https://www.rta.ae/", ["+97142222222"], "rta")[0] == "unknown"
    assert helplines.classify("Al Noor Car Wash", None, ["+971525550111"], "salik")[0] == "unknown"
    assert helplines.e164("999") == "999" and helplines.e164("052 555 0111") == "+971525550111"


def test_live_sweep_uses_google_places_and_dedupes(monkeypatch):
    def handler(request):
        assert request.headers["X-Goog-Api-Key"] == "test-key"
        return httpx.Response(200, json={"places": [{
            "displayName": {"text": "Salik Tag Recharge Help"}, "formattedAddress": "Dubai",
            "internationalPhoneNumber": "+971 52 555 0123", "websiteUri": "https://salik-help.top/",
        }]})

    real = httpx.AsyncClient
    monkeypatch.setattr(helplines.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(helplines, "settings", replace(settings, google_places_api_key="test-key"))
    sweep = asyncio.run(helplines.live_sweep())
    assert not sweep.simulated and len(sweep.listings) == 1
    listing = sweep.listings[0]
    assert listing.source == "google_places" and listing.phones == ["+971525550123"]
    assert listing.phone_status == "fake_listing" and listing.brand_id == "salik"


def test_no_provider_means_no_live_sweep():
    assert asyncio.run(helplines.live_sweep()) is None


def test_expand_api_in_simulated_mode(client):
    run = client.post("/api/graph/expand", json={"scan_id": "SQ-20261124-0006"}).json()
    assert run["kind"] == "expansion" and run["simulated"] and run["seed_id"] == "SQ-20261124-0006"
    assert run["found_ids"] == ["SQ-20261124-0003"]
    assert client.get(f"/api/discovery/runs/{run['id']}").json()["status"] == "done"
    assert client.post("/api/graph/expand", json={"scan_id": "SQ-20261124-0001"}).status_code == 409
    assert client.post("/api/graph/expand", json={"scan_id": "missing"}).status_code == 404


def test_related_scans_are_linked_both_ways(client):
    result = asyncio.run(store.scan_and_store("sa1ik-topup.xyz", "graph_expansion", related_to="SQ-20261124-0006"))
    assert "SQ-20261124-0006" in result.related_ids
    assert result.id in store.scans["SQ-20261124-0006"].related_ids
