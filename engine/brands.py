"""Brand index and allowlists used by the URL signals."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache

from engine.settings import ROOT, SHARED_DIR
from shared.contract import Brand

SIGNALS = json.loads((ROOT / "engine" / "config" / "signals.json").read_text(encoding="utf-8"))
ALLOWLIST_DIR = ROOT / "data" / "allowlist"


def compact(text: str) -> str:
    """Lower-case and drop everything except letters and digits ('e&' -> 'eand', 'uae-pass' -> 'uaepass')."""
    return re.sub(r"[^0-9a-z؀-ۿ]", "", text.lower().replace("&", "and"))


@dataclass
class BrandIndex:
    brand: Brand
    tokens: set[str] = field(default_factory=set)
    official_labels: set[str] = field(default_factory=set)
    arabic: set[str] = field(default_factory=set)


@lru_cache(maxsize=1)
def brands() -> dict[str, Brand]:
    raw = json.loads((SHARED_DIR / "brands.json").read_text(encoding="utf-8"))
    return {b.id: b for b in (Brand.model_validate(item) for item in raw)}


@lru_cache(maxsize=1)
def brand_index() -> list[BrandIndex]:
    index = []
    for brand in brands().values():
        tokens = {compact(k) for k in brand.keywords_en + brand.transliterations}
        labels = {d.split(".")[0] for d in brand.official_domains}
        index.append(
            BrandIndex(
                brand=brand,
                tokens={t for t in tokens | labels if len(t) >= 2},
                official_labels={l for l in labels if len(l) >= 3},
                arabic={compact(k) for k in brand.keywords_ar + [brand.name_ar] if len(compact(k)) >= 2},
            )
        )
    return index


@lru_cache(maxsize=1)
def official_domains() -> dict[str, str]:
    """Registered domain -> brand id."""
    return {d.lower(): b.id for b in brands().values() for d in b.official_domains}


def official_brand_for_host(host: str) -> tuple[str, str] | None:
    """(official domain, brand id) when the host is an official domain or one of its subdomains."""
    for domain, brand_id in official_domains().items():
        if host == domain or host.endswith("." + domain):
            return domain, brand_id
    return None


def _read_list(name: str, limit: int | None = None) -> set[str]:
    path = ALLOWLIST_DIR / name
    if not path.is_file():
        return set()
    lines = [l.split("\t")[0].strip().lower() for l in path.read_text(encoding="utf-8").splitlines()]
    entries = [l for l in lines if l and not l.startswith("#")]
    return set(entries[:limit] if limit else entries)


@lru_cache(maxsize=1)
def tranco_top() -> set[str]:
    return _read_list("tranco_top.txt", SIGNALS["tranco_top_n"])


def _host_in(host: str, domains: list[str]) -> str | None:
    for domain in domains:
        if host == domain or host.endswith("." + domain):
            return domain
    return None


def free_hosting_match(host: str) -> str | None:
    match = _host_in(host, SIGNALS["free_hosting"]) or _host_in(host, SIGNALS["tunnels"])
    if match:
        return match
    labels = host.split(".")
    if "blogspot" in labels[1:-1]:  # Blogger's country domains: name.blogspot.sn, name.blogspot.co.uk
        return ".".join(labels[labels.index("blogspot"):])
    return None


def shortener_match(host: str) -> str | None:
    return _host_in(host, SIGNALS["shorteners"])
