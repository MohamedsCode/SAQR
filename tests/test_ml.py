import asyncio
import math
import sys
import time
from datetime import datetime, timezone

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from engine import net
from engine.app import app
from engine.ml.features import DOMAIN_FEATURE_COUNT, FEATURE_NAMES, extract, feature_label, rule_score
from engine.ml.model import blend_weight, combined_weight, model_signal
from engine.ml.train import Example, combined_scores, threshold_metrics
from engine.normalize import normalize
from engine.reasons import Signal
from engine.routes.model import trainer
from shared.contract import Dns, Evidence, Rdap

NOW = datetime(2026, 11, 24, tzinfo=timezone.utc)


def features_of(url: str, codes=(), evidence=None) -> dict[str, float]:
    return dict(zip(FEATURE_NAMES, extract(normalize(url), codes, evidence or Evidence(), NOW)))


def test_every_feature_has_bilingual_label():
    for name in FEATURE_NAMES:
        en, ar = feature_label(name)
        assert en and ar


def test_domain_features():
    f = features_of("https://login.sa1ik-pay.top/verify/otp?id=1&x=2", codes={"RISKY_TLD"})
    assert f["domain_length"] == len("sa1ik-pay")
    assert f["domain_digits"] == 1 and f["domain_hyphens"] == 1
    assert f["code_risky_tld"] == 1.0 and f["code_free_hosting"] == 0.0


def test_domain_model_features_ignore_the_page_path():
    """To the domain model, a legitimate deep link looks exactly like its homepage."""
    home = extract(normalize("https://www.example-bank.ae/"), set(), Evidence(), NOW)
    deep = extract(normalize("https://www.example-bank.ae/en/personal/cards/apply.php?ref=home"), {"PATH_BAIT"},
                   Evidence(), NOW)
    assert home[:DOMAIN_FEATURE_COUNT] == deep[:DOMAIN_FEATURE_COUNT]
    f = dict(zip(FEATURE_NAMES, deep))
    assert f["path_depth"] == 4 and f["query_params"] == 1 and f["script_page"] == 1.0


def test_network_features_are_missing_not_zero_when_unknown():
    f = features_of("https://example-shop.com/")
    assert math.isnan(f["domain_age_days"]) and math.isnan(f["dns_resolves"])
    evidence = Evidence(rdap=Rdap(created=datetime(2026, 11, 20, tzinfo=timezone.utc)), dns=Dns(a=["1.2.3.4"]))
    f = features_of("https://example-shop.com/", evidence=evidence)
    assert f["domain_age_days"] == 4 and f["dns_resolves"] == 1.0 and f["rdap_found"] == 1.0
    assert features_of("https://example-shop.com/", codes={"NO_DNS"})["dns_resolves"] == 0.0


def test_rule_score_ignores_live_page_signals():
    assert rule_score({"RISKY_TLD", "CARD_FORM", "ML_MODEL"}) == rule_score({"RISKY_TLD"})


def test_blend_weight():
    assert blend_weight(1.0, set(), 40, 20) == 40
    assert blend_weight(0.5, set(), 40, 20) == 0
    assert blend_weight(0.0, set(), 40, 20) == -20
    assert blend_weight(0.75, set(), 40, 20) < blend_weight(0.9, set(), 40, 20)
    assert blend_weight(0.99, {"TRANCO_TOP"}, 40, 20) == 0
    assert blend_weight(0.1, {"TRANCO_TOP"}, 40, 20) < 0


def test_path_cannot_push_up_a_domain_the_domain_model_finds_clean():
    assert combined_weight(0.95, 0.30, set(), 60, 20, gate=0.5) == (blend_weight(0.30, set(), 60, 20), 0.30)
    assert combined_weight(0.95, 0.70, set(), 60, 20, gate=0.5) == (blend_weight(0.95, set(), 60, 20), 0.95)
    assert combined_weight(0.95, 0.30, set(), 60, 20, gate=None)[1] == 0.95
    assert combined_weight(0.10, 0.30, set(), 60, 20, gate=0.5)[1] == 0.10  # the lower vote always wins


def test_model_never_runs_on_official_domains():
    assert model_signal(normalize("https://tamm.abudhabi/"), {"OFFICIAL_DOMAIN"}, Evidence(), NOW) is None


def test_model_reason_is_bilingual_with_its_own_weight():
    reason = Signal("ML_MODEL", "92%", weight_override=31).reason()
    assert reason.weight == 31
    assert "92%" in reason.en and "92%" in reason.ar


def test_combined_scores_keep_official_override_and_clamp():
    def example(codes):
        return Example(url="u", phishing=False, split="test", source="s", domain="d", codes=set(codes),
                       features=[], official=False, allowlisted=False)

    scores = combined_scores([example({"OFFICIAL_DOMAIN"}), example({"RISKY_TLD", "IP_HOST"}), example(set())],
                             np.array([0.99, 1.0, 0.0]), np.array([0.99, 1.0, 0.0]), up=90, down=40, gate=0.5)
    assert list(scores) == [0, 100, 0]


def test_threshold_metrics():
    m = threshold_metrics(np.array([True, True, False, False]), np.array([80, 20, 75, 10]), 70)
    assert (m.tp, m.fn, m.fp, m.tn) == (1, 1, 1, 1)
    assert m.precision == 0.5 and m.recall == 0.5


def _mock_rdap(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(net.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def test_rdap_unsupported_tld_is_unknown_not_unregistered(monkeypatch):
    _mock_rdap(monkeypatch, lambda request: httpx.Response(404))
    assert asyncio.run(net.rdap("unsupported-tld-example.ae")) == (None, True)


def test_rdap_registry_404_means_unregistered(monkeypatch):
    def handler(request):
        if request.url.host == "rdap.org":
            return httpx.Response(302, headers={"location": "https://rdap.registry.example/domain/x.com"})
        return httpx.Response(404)

    _mock_rdap(monkeypatch, handler)
    assert asyncio.run(net.rdap("never-registered-example.com")) == (None, False)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_model_info(client):
    info = client.get("/api/model").json()
    if info["available"]:
        assert {m["approach"] for m in info["metrics"]} == {"rules", "model", "combined"}
        assert len(info["top_features"]) <= 15
        assert len(info["confusion"]) == 6


def test_retrain_streams_the_log(client, monkeypatch):
    monkeypatch.setattr(trainer, "command", [sys.executable, "-c", "print('step one'); print('step two')"])
    monkeypatch.setattr(trainer, "run", None)
    assert client.get("/api/model/retrain").status_code == 404
    run = client.post("/api/model/retrain").json()
    assert run["status"] == "running"
    deadline = time.monotonic() + 20
    while client.get("/api/model/retrain").json()["status"] == "running" and time.monotonic() < deadline:
        time.sleep(0.1)
    done = client.get("/api/model/retrain").json()
    assert done["status"] == "done" and done["lines"] == ["step one", "step two"]
    stream = client.get("/api/model/retrain/stream").text
    assert "data: step one" in stream and "event: done\ndata: done" in stream
