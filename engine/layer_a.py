"""Layer A: signals computed from the URL alone, so they still work when the site is offline."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from urllib.parse import unquote

import idna
from rapidfuzz.distance import Levenshtein

from engine.brands import (
    SIGNALS,
    BrandIndex,
    brand_index,
    compact,
    free_hosting_match,
    official_brand_for_host,
    official_domains,
    shortener_match,
    tranco_top,
)
from engine.normalize import NormalizedUrl
from engine.reasons import Signal

_DIGIT_SWAPS = [
    str.maketrans({"0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g"}),
    str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g"}),
]
_LETTER_SWAPS = [("rn", "m"), ("vv", "w"), ("cl", "d"), ("ii", "u")]
_HOMOGLYPHS = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
    "ԁ": "d", "ӏ": "l", "к": "k", "м": "m", "н": "h", "т": "t", "в": "b", "ԛ": "q", "ԝ": "w", "ɡ": "g",
    "α": "a", "ο": "o", "ρ": "p", "ν": "v", "ι": "i", "κ": "k", "τ": "t", "υ": "u", "χ": "x", "ε": "e",
    "ı": "i", "ɩ": "i", "ʟ": "l", "ɑ": "a",
})
_SPLIT = re.compile(r"[^0-9a-z؀-ۿ]+")
RISKY_TLDS = set(SIGNALS["risky_tlds"])
DOMAIN_BAIT = set(SIGNALS["domain_bait_words"])
PATH_BAIT = set(SIGNALS["path_bait_words"])
EDIT_MIN = SIGNALS["edit_distance_min_length"]


@dataclass
class LayerAResult:
    signals: list[Signal] = field(default_factory=list)
    brand_id: str | None = None
    override: Signal | None = None
    free_hosting: str | None = None
    shortener: str | None = None
    bait_words: list[str] = field(default_factory=list)

    def add(self, code: str, evidence: str | None = None, brand_id: str | None = None) -> None:
        if not any(s.code == code for s in self.signals):
            self.signals.append(Signal(code, evidence, brand_id))
        if brand_id and not self.brand_id:
            self.brand_id = brand_id

    def has(self, *codes: str) -> bool:
        return any(s.code in codes for s in self.signals)


def tokens_of(text: str) -> list[str]:
    return [t for t in _SPLIT.split(text.lower()) if t]


def _token_match(token: str, region_tokens: list[str], region_compact: str, strict: bool) -> bool:
    """Short keywords must be a whole token; longer ones may be glued to other words ('tammservices')."""
    if len(token) <= 3:
        return token in region_tokens
    if strict:
        return any(t == token or (len(token) >= 6 and token in t) for t in region_tokens)
    if len(token) <= 5:
        return any(t.startswith(token) for t in region_tokens)
    return token in region_compact


def find_brand(region: str, strict: bool = False) -> tuple[BrandIndex, str] | None:
    """Brand whose keyword appears in the region; the longest (most specific) keyword wins."""
    region_tokens = tokens_of(region)
    region_compact = compact(region)
    best: tuple[BrandIndex, str] | None = None
    for idx in brand_index():
        for token in idx.tokens | idx.arabic:
            if _token_match(token, region_tokens, region_compact, strict):
                if best is None or len(token) > len(best[1]):
                    best = (idx, token)
    return best


def deconfuse_variants(text: str) -> set[str]:
    variants = set()
    for table in _DIGIT_SWAPS:
        value = text.translate(table)
        for a, b in _LETTER_SWAPS:
            variants.add(value.replace(a, b))
        variants.add(value)
    variants.discard(text)
    return variants


def skeleton(text: str) -> str:
    text = text.translate(_HOMOGLYPHS)
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def scripts_of(label: str) -> set[str]:
    found = set()
    for ch in label:
        if ch.isalpha():
            name = unicodedata.name(ch, "")
            found.add(name.split(" ")[0])
    return found


def _lookalike(label: str, result: LayerAResult) -> None:
    """Check one host label (e.g. 'sa1ik-recharge') for misspellings of official brand names."""
    label_tokens = tokens_of(label)
    candidates = set(label_tokens) | {compact(label)}
    for idx in brand_index():
        targets = idx.official_labels | {t for t in idx.tokens if len(t) >= EDIT_MIN}
        for target in targets:
            if target in label_tokens:
                continue
            for candidate in candidates:
                if any(target == v or (len(target) >= EDIT_MIN and target in v) for v in deconfuse_variants(candidate)):
                    result.add("LOOKALIKE_CHAR_SWAP", f"{candidate} → {target}", idx.brand.id)
                    return
            if len(target) < EDIT_MIN:
                continue
            limit = 1 if len(target) <= 7 else 2
            for candidate in candidates:
                if abs(len(candidate) - len(target)) > limit:
                    continue
                distance = Levenshtein.distance(candidate, target)
                if 1 <= distance <= limit:
                    result.add("LOOKALIKE_EDIT_DISTANCE", f"{candidate} ≈ {target} ({distance} edit)", idx.brand.id)
                    return


def _homoglyphs(url: NormalizedUrl, result: LayerAResult) -> None:
    if not url.is_idn:
        return
    labels = url.host_unicode.split(".")
    for label in labels:
        scripts = scripts_of(label)
        if "LATIN" in scripts and scripts & {"CYRILLIC", "GREEK"}:
            result.add("MIXED_SCRIPT", label)
        ascii_form = skeleton(label)
        if ascii_form != label and ascii_form.isascii():
            match = find_brand(ascii_form)
            if match:
                result.add("HOMOGLYPH_BRAND", f"{label} → {ascii_form}", match[0].brand.id)
    if not result.has("MIXED_SCRIPT", "HOMOGLYPH_BRAND"):
        result.add("PUNYCODE", f"{url.host} = {url.host_unicode}")


def _unicode_label(label: str) -> str:
    if not label.startswith("xn--"):
        return label
    try:
        return idna.decode(label)
    except idna.IDNAError:
        return label


def analyse(url: NormalizedUrl) -> LayerAResult:
    result = LayerAResult()
    official = official_domains()
    match = official_brand_for_host(url.host)
    if match:
        result.brand_id = match[1]
        result.override = Signal("OFFICIAL_DOMAIN", match[0], result.brand_id)
        return result
    if url.suffix == "gov.ae":
        result.override = Signal("GOV_AE_DOMAIN", url.registered_domain)
        return result

    result.free_hosting = free_hosting_match(url.host)
    result.shortener = shortener_match(url.host)
    if result.free_hosting:
        result.add("FREE_HOSTING", result.free_hosting)
    if result.shortener:
        result.add("SHORTENER", result.shortener)

    for domain, brand_id in official.items():
        if domain in url.host and not url.host.endswith("." + domain):
            result.add("OFFICIAL_DOMAIN_IN_HOST", f"{domain} inside {url.host}", brand_id)
            break

    _homoglyphs(url, result)

    domain_match = None if result.free_hosting else find_brand(_unicode_label(url.domain_label))
    if domain_match:
        code = "LOOKALIKE_CHAR_SWAP" if any(ch.isdigit() for ch in domain_match[1]) else "BRAND_IN_DOMAIN"
        result.add(code, domain_match[1], domain_match[0].brand.id)
    subdomain = ".".join(_unicode_label(l) for l in url.subdomain.split(".") if l and l != "www")
    subdomain_match = find_brand(subdomain) if subdomain else None
    if subdomain_match and not result.has("OFFICIAL_DOMAIN_IN_HOST"):
        result.add("BRAND_IN_SUBDOMAIN", subdomain_match[1], subdomain_match[0].brand.id)

    if not result.brand_id and not url.is_ip:
        if result.free_hosting and subdomain:
            _lookalike(subdomain.split(".")[-1], result)
        elif not result.free_hosting:
            _lookalike(url.domain_label, result)

    path_text = unquote(f"{url.path} {url.query}").lower()
    if not result.brand_id:
        path_match = find_brand(path_text, strict=True)
        if path_match:
            result.add("BRAND_IN_PATH", path_match[1], path_match[0].brand.id)

    host_region = url.domain_label if not result.free_hosting else subdomain
    host_tokens = tokens_of(f"{host_region} {subdomain}")
    host_compact = compact(host_region)
    bait = sorted({w for w in DOMAIN_BAIT if w in host_tokens or (len(w) >= 5 and w in host_compact)})
    result.bait_words = bait
    if bait:
        result.add("BAIT_IN_DOMAIN", ", ".join(bait))
        if result.has("BRAND_IN_DOMAIN", "BRAND_IN_SUBDOMAIN", "LOOKALIKE_CHAR_SWAP", "LOOKALIKE_EDIT_DISTANCE",
                      "HOMOGLYPH_BRAND", "OFFICIAL_DOMAIN_IN_HOST"):
            result.add("BRAND_PLUS_BAIT", ", ".join(bait), result.brand_id)

    path_bait = sorted({t for t in tokens_of(path_text) if t in PATH_BAIT})
    if len(path_bait) >= 3:
        result.add("PATH_BAIT_MANY", ", ".join(path_bait))
    elif path_bait:
        result.add("PATH_BAIT", ", ".join(path_bait))

    tld = url.suffix.split(".")[-1] if url.suffix else ""
    if tld in RISKY_TLDS:
        result.add("RISKY_TLD", f".{tld}")
    if url.is_ip:
        result.add("IP_HOST", url.host)
    if url.has_userinfo:
        result.add("USERINFO_IN_URL", url.input.strip()[:200])
    sub_labels = [l for l in subdomain.split(".") if l]
    if len(sub_labels) >= 4:
        result.add("MANY_SUBDOMAINS", url.subdomain)
    if url.domain_label.count("-") >= 3 or url.host.count("-") >= 5:
        result.add("MANY_HYPHENS", url.host)
    if len(url.url) > 120:
        result.add("LONG_URL", f"{len(url.url)} characters")
    if url.port:
        result.add("NON_STANDARD_PORT", str(url.port))

    impersonates_outside_domain = result.has(
        "BRAND_IN_SUBDOMAIN", "BRAND_IN_PATH", "OFFICIAL_DOMAIN_IN_HOST", "HOMOGLYPH_BRAND"
    )
    if (url.registered_domain in tranco_top() and not result.free_hosting and not result.shortener
            and not impersonates_outside_domain):
        result.add("TRANCO_TOP", url.registered_domain)
    return result
