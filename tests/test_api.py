import hashlib

import pytest
from fastapi.testclient import TestClient

from engine.app import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/api/demo/reset")
        yield c


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_brands(client):
    assert len(client.get("/api/brands").json()) == 16


def test_scan_matches_defanged_fixture(client):
    r = client.post("/api/scan", json={"input": "  HXXPS://adpolice-fines-pay[.]top/pay  "})
    assert r.status_code == 200
    assert r.json()["verdict"] == "fraud"


def test_scan_unknown_input_is_not_faked(client):
    assert client.post("/api/scan", json={"input": "unknown-example.org"}).status_code == 501


def test_scans_list_and_filters(client):
    assert len(client.get("/api/scans").json()) == 8
    frauds = client.get("/api/scans", params={"verdict": "fraud"}).json()
    assert frauds and all(s["verdict"] == "fraud" for s in frauds)


def test_scan_detail_and_evidence(client):
    assert client.get("/api/scans/SQ-20261124-0005").json()["impersonated_brand"] == "adpolice"
    assert client.get("/api/scans/SQ-20261124-0005/evidence.json").status_code == 200
    assert client.get("/api/scans/missing").status_code == 404


def test_batch_json_and_exports(client):
    job = client.post("/api/scan/batch", json={"inputs": ["sa1ik-recharge.xyz", "not-in-fixtures.org"]}).json()
    assert job["total"] == 2 and job["result_ids"] == ["SQ-20261124-0006"]
    assert client.get(f"/api/jobs/{job['id']}").json()["id"] == job["id"]
    csv_text = client.get(f"/api/jobs/{job['id']}/export.csv").text
    assert "sa1ik-recharge.xyz" in csv_text
    assert client.get(f"/api/jobs/{job['id']}/export.json").json()["results"][0]["score"] == 80


def test_batch_file_upload(client):
    files = {"file": ("urls.csv", b"url\nrta-fines-uae.top\ntamm.abudhabi\n", "text/csv")}
    job = client.post("/api/scan/batch", files=files).json()
    assert job["total"] == 2 and len(job["result_ids"]) == 2


def test_phone_check_uses_hash_prefix_only(client):
    digest = hashlib.sha256(b"+971525550142").hexdigest()
    matches = client.post("/api/phone/check", json={"hash_prefix": digest[:5]}).json()
    assert any(m["suffix_hash"] == digest[5:] for m in matches)
    assert client.post("/api/phone/check", json={"hash_prefix": "+9715"}).status_code == 422


def test_report(client):
    r = client.post("/api/report", json={"input": "rta-fines-uae.top", "type": "url"})
    assert r.status_code == 200 and r.json()["id"]


def test_discovery(client):
    run = client.post("/api/discovery/run", json={"brand_id": "salik"}).json()
    assert run["simulated"] and run["found_ids"] == ["SQ-20261124-0006"]
    assert len(client.get("/api/discovery/runs").json()) == 1
    assert client.post("/api/discovery/run", json={"brand_id": "nope"}).status_code == 404


def test_maps_sweep_is_labelled_simulated(client):
    sweep = client.get("/api/maps-sweep").json()
    assert sweep["simulated"] and all(item["simulated"] for item in sweep["listings"])
    assert client.post("/api/maps-sweep/run").json()["simulated"]


def test_graph_clusters_shared_infrastructure(client):
    graph = client.get("/api/graph").json()
    campaigns = [set(c["domains"]) for c in graph["clusters"]]
    assert {"adpolice-fines-pay.top", "emiratespost-redelivery.cyou", "rta-fines-uae.top"} in campaigns
    issuer = next(n for n in graph["nodes"] if n["data"]["id"] == "issuer:let's encrypt")
    assert issuer["data"]["ubiquitous"] is True
    seeded = client.get("/api/graph", params={"seed": "SQ-20261124-0006"}).json()
    assert {n["data"]["label"] for n in seeded["nodes"] if n["data"]["type"] == "domain"} == {
        "sa1ik-recharge.xyz", "uae-parcel-track.site",
    }


def test_stats(client):
    stats = client.get("/api/stats").json()
    assert stats["scans"] == 8 and stats["fraud_found"] == 4 and stats["fake_helplines"] == 2
    client.post("/api/report", json={"input": "https://sa1ik-recharge.xyz", "type": "url"})
    assert client.get("/api/stats").json()["found_before_report"] == stats["found_before_report"] - 1
