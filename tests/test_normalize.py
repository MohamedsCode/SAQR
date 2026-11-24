import pytest

from engine.normalize import InvalidInput, normalize


@pytest.mark.parametrize(
    "text, url, registered",
    [
        ("tamm.abudhabi", "https://tamm.abudhabi/", "tamm.abudhabi"),
        ("  HTTPS://WWW.ADCB.COM/en  ", "https://www.adcb.com/en", "adcb.com"),
        ("hxxps://adpolice-fines-pay[.]top/pay", "https://adpolice-fines-pay.top/pay", "adpolice-fines-pay.top"),
        ("hxxp://salik(.)ae", "http://salik.ae/", "salik.ae"),
        ("example[dot]com/login", "https://example.com/login", "example.com"),
        ("Your fine is due: https://rta-fines.top/p?id=1. Pay now!", "https://rta-fines.top/p?id=1", "rta-fines.top"),
        ("(see sa1ik-recharge.xyz)", "https://sa1ik-recharge.xyz/", "sa1ik-recharge.xyz"),
        ("https://sps.dubaipolice.gov.ae:443/x#frag", "https://sps.dubaipolice.gov.ae/x", "dubaipolice.gov.ae"),
        ("emiratesnbd.com.sa", "https://emiratesnbd.com.sa/", "emiratesnbd.com.sa"),
        ("http://203.0.113.5:8080/pay", "http://203.0.113.5:8080/pay", "203.0.113.5"),
    ],
)
def test_normalize(text, url, registered):
    result = normalize(text)
    assert result.url == url
    assert result.registered_domain == registered


def test_idn_is_converted_to_punycode():
    result = normalize("https://аdcb.com/")
    assert result.host.startswith("xn--")
    assert result.host_unicode == "аdcb.com"


def test_userinfo_trick_uses_the_real_host():
    result = normalize("https://tamm.abudhabi@evil.example.com/login")
    assert result.registered_domain == "example.com"
    assert result.has_userinfo


def test_subdomain_trick_keeps_the_real_registered_domain():
    result = normalize("tamm.abudhabi.evil-site.com")
    assert result.registered_domain == "evil-site.com"
    assert result.subdomain == "tamm.abudhabi"


@pytest.mark.parametrize("text", ["", "   ", "hello there", "no dots here", "foo.notarealtld"])
def test_invalid_input(text):
    with pytest.raises(InvalidInput):
        normalize(text)
