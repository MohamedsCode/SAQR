import json
import re
from pathlib import Path
from urllib.parse import urlparse

import pytest

from shared.contract import Brand

ROOT = Path(__file__).resolve().parent.parent
BRANDS = [Brand.model_validate(b) for b in json.loads((ROOT / "shared/brands.json").read_text(encoding="utf-8"))]
E164_OR_SHORT_CODE = re.compile(r"^(\+971\d{6,10}|\d{3,4})$")


def on_official_domain(url: str, brand: Brand) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == d or host.endswith("." + d) for d in brand.official_domains)


def test_sixteen_unique_brands():
    assert len(BRANDS) == 16
    assert len({b.id for b in BRANDS}) == 16


def test_official_domains_are_unique_registered_domains():
    seen: dict[str, str] = {}
    for brand in BRANDS:
        assert brand.official_domains, brand.id
        for domain in brand.official_domains:
            assert domain == domain.lower() and not domain.startswith("www."), domain
            assert domain not in seen, f"{domain} listed for {seen.get(domain)} and {brand.id}"
            seen[domain] = brand.id


@pytest.mark.parametrize("brand", BRANDS, ids=[b.id for b in BRANDS])
def test_verified_phones_come_from_the_brands_own_site(brand):
    for phone in brand.official_phones:
        assert E164_OR_SHORT_CODE.match(phone.number), phone.number
        assert phone.source_url.startswith("https://")
        if phone.verified:
            assert on_official_domain(phone.source_url, brand), phone.source_url


@pytest.mark.parametrize("brand", BRANDS, ids=[b.id for b in BRANDS])
def test_brand_fields(brand):
    assert brand.name_en and brand.name_ar
    assert brand.keywords_en and brand.keywords_ar
    assert all(k == k.lower() for k in brand.keywords_en + brand.transliterations)
    assert all(re.fullmatch(r"#[0-9a-f]{6}", c) for c in brand.colors)
    assert brand.reference_url and on_official_domain(brand.reference_url, brand)


def test_allowlist_matches_brands():
    lines = (ROOT / "data/allowlist/official_uae.txt").read_text(encoding="utf-8").splitlines()
    listed = {line.split("\t")[0] for line in lines if line and not line.startswith("#")}
    assert listed == {d for b in BRANDS for d in b.official_domains}
