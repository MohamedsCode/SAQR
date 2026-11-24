import pytest

from engine.layer_a import analyse
from engine.normalize import normalize
from engine.scoring import score_signals


def run(text):
    layer = analyse(normalize(text))
    score, verdict, reasons = score_signals(layer.signals, layer.override)
    return layer, score, verdict, {r.code for r in reasons}


@pytest.mark.parametrize(
    "text",
    [
        "https://www.tamm.abudhabi/en",
        "https://sps.dubaipolice.gov.ae/wps/portal",
        "adcb.com",
        "https://www.bankfab.com/en-ae/personal",
        "https://www.emiratesnbd.com.sa/",
        "https://liv.me/",
        "https://www.emiratesnbd.bank.in/en/contact-us",
        "anything.gov.ae/login/verify/pay",
    ],
)
def test_official_and_gov_ae_domains_are_safe(text):
    layer, score, verdict, codes = run(text)
    assert verdict == "safe" and score == 0
    assert codes & {"OFFICIAL_DOMAIN", "GOV_AE_DOMAIN"}


@pytest.mark.parametrize(
    "text, brand",
    [
        ("tamm.abudhabi.evil-site.com/login", "tamm"),
        ("https://adcb.com-secure-update.site", "adcb"),
        ("salik.ae.toll-pay.top", "salik"),
    ],
)
def test_official_domain_used_as_disguise_is_flagged(text, brand):
    layer, score, verdict, codes = run(text)
    assert "OFFICIAL_DOMAIN_IN_HOST" in codes
    assert layer.brand_id == brand
    assert verdict != "safe"


@pytest.mark.parametrize(
    "text, brand, code",
    [
        ("sa1ik-recharge.xyz", "salik", "LOOKALIKE_CHAR_SWAP"),
        ("https://emiratesnbdd.com/login", "emiratesnbd", "BRAND_IN_DOMAIN"),
        ("https://adpollice-fines.com", "adpolice", "BRAND_IN_DOMAIN"),
        ("https://dubaipolicc.com", "dubaipolice", "LOOKALIKE_EDIT_DISTANCE"),
        ("https://bankfob.com/verify", "fab", "LOOKALIKE_EDIT_DISTANCE"),
        ("https://аdcb.com", "adcb", "HOMOGLYPH_BRAND"),
        ("https://emiratespost-redelivery.cyou/track", "emiratespost", "BRAND_IN_DOMAIN"),
    ],
)
def test_lookalikes(text, brand, code):
    layer, _, _, codes = run(text)
    assert layer.brand_id == brand
    assert code in codes


def test_scam_combinations_reach_fraud_without_network():
    for text in ["hxxps://adpolice-fines-pay[.]top/pay", "sa1ik-recharge.xyz", "emiratespost-redelivery.cyou/track"]:
        assert run(text)[2] == "fraud", text


def test_free_hosting_subdomain_decides():
    layer, _, verdict, codes = run("https://tamm-services-portal.netlify.app/")
    assert {"FREE_HOSTING", "BRAND_IN_SUBDOMAIN"} <= codes and layer.brand_id == "tamm"
    assert verdict != "safe"
    _, _, verdict, codes = run("https://my-portfolio.netlify.app/")
    assert codes == {"FREE_HOSTING"} and verdict == "safe"


def test_short_brand_tokens_only_match_whole_labels():
    assert run("https://fabulous-recipes.com")[0].brand_id is None
    assert run("https://dubai-fab-verify.com")[0].brand_id == "fab"
    assert run("https://thousand-deals.com")[0].brand_id is None


def test_arabic_idn_brand():
    layer, _, _, codes = run("https://شرطة-دبي-مخالفات.com")
    assert layer.brand_id == "dubaipolice" and "BRAND_IN_DOMAIN" in codes


def test_structure_signals():
    codes = run("http://user@203.0.113.9:8443/a/b")[3]
    assert {"IP_HOST", "USERINFO_IN_URL", "NON_STANDARD_PORT"} <= codes
    assert "MANY_SUBDOMAINS" in run("a.b.c.d.e.example.com")[3]
    assert "RISKY_TLD" in run("example.top")[3]
    assert "SHORTENER" in run("https://bit.ly/abc")[3]


def test_unrelated_sites_stay_safe():
    for text in ["https://www.wikipedia.org/", "https://www.khaleejtimes.com/uae", "noon.com", "example.org"]:
        assert run(text)[2] == "safe", text


def test_tranco_credit_is_negative_and_never_on_free_hosting(monkeypatch):
    monkeypatch.setattr("engine.layer_a.tranco_top", lambda: {"google.com", "netlify.app"})
    layer, _, _, codes = run("https://www.google.com/maps")
    assert "TRANCO_TOP" in codes and layer.override is None
    assert "TRANCO_TOP" not in run("https://tamm-pay.netlify.app/")[3]
    assert "TRANCO_TOP" not in run("https://sites.google.com/view/salik-fines")[3]
    assert "TRANCO_TOP" not in run("https://www.google.com/salik/pay")[3]


def test_publish_anywhere_platforms_count_as_free_hosting():
    from engine.brands import free_hosting_match

    assert free_hosting_match("metamask-help.gitbook.io") == "gitbook.io"
    assert free_hosting_match("secure-login.blogspot.sn") == "blogspot.sn"
    assert free_hosting_match("verify.ddnss.eu") == "ddnss.eu"
    assert free_hosting_match("www.gitbook.com") is None
    assert free_hosting_match("blogspot.com.example.org") is None
