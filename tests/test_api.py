import hashlib
import time

import pytest
from fastapi.testclient import TestClient

from engine.app import app


def wait_for_job(client, job_id):
    for _ in range(200):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] == "done":
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish")


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/api/demo/reset")
        yield c


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_brands(client):
    assert len(client.get("/api/brands").json()) == 16


def test_scan_scores_a_defanged_scam_url(client):
    r = client.post("/api/scan", json={"input": "  HXXPS://adpolice-fines-pay[.]top/pay  "})
    assert r.status_code == 200
    body = r.json()
    assert body["verdict"] == "fraud" and body["impersonated_brand"] == "adpolice"
    assert body["normalized_url"] == "https://adpolice-fines-pay.top/pay"
    assert body["reasons"][0]["en"] and body["reasons"][0]["ar"] and body["summary_ar"]
    assert client.get(f"/api/scans/{body['id']}").json()["id"] == body["id"]


def test_scan_official_domain_is_safe(client):
    body = client.post("/api/scan", json={"input": "https://www.adcb.com/en/personal"}).json()
    assert body["verdict"] == "safe" and body["score"] == 0
    assert body["reasons"][0]["code"] == "OFFICIAL_DOMAIN"


def test_scan_rejects_input_without_a_url(client):
    assert client.post("/api/scan", json={"input": "hello there"}).status_code == 422


def test_repeat_scan_keeps_first_seen(client):
    first = client.post("/api/scan", json={"input": "rta-fines-uae.top"}).json()
    assert first["first_seen"] < first["scanned_at"]
    assert "SQ-20261124-0008" in first["related_ids"]


def test_scans_list_and_filters(client):
    assert len(client.get("/api/scans").json()) == 8
    frauds = client.get("/api/scans", params={"verdict": "fraud"}).json()
    assert frauds and all(s["verdict"] == "fraud" for s in frauds)


def test_scan_detail_and_evidence(client):
    assert client.get("/api/scans/SQ-20261124-0005").json()["impersonated_brand"] == "adpolice"
    assert client.get("/api/scans/SQ-20261124-0005/evidence.json").status_code == 200
    assert client.get("/api/scans/missing").status_code == 404


def test_batch_json_and_exports(client):
    job = client.post("/api/scan/batch", json={"inputs": ["sa1ik-recharge.xyz", "not a url"]}).json()
    assert job["total"] == 2
    job = wait_for_job(client, job["id"])
    assert len(job["result_ids"]) == 1 and job["failed"] == ["not a url"]
    csv_text = client.get(f"/api/jobs/{job['id']}/export.csv").text
    assert "sa1ik-recharge.xyz" in csv_text
    assert client.get(f"/api/jobs/{job['id']}/export.json").json()["results"][0]["verdict"] == "fraud"


def test_batch_file_upload(client):
    files = {"file": ("urls.csv", b"url\nrta-fines-uae.top\ntamm.abudhabi\n", "text/csv")}
    job = client.post("/api/scan/batch", files=files).json()
    assert job["total"] == 2
    assert len(wait_for_job(client, job["id"])["result_ids"]) == 2


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
