"""Features for the ML layer, computed the same way at training time and at scan time.

Inputs are the normalized URL, the rule signal codes, and the network evidence (RDAP, DNS, redirect chain).
Live-page signals are left out: the model is trained in network mode, so it must not see them. Certificate
transparency is left out too: crt.sh is too slow to query for a whole training set, so the model would only
ever see it missing.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Iterable
from datetime import datetime

from engine.brands import SIGNALS
from engine.layer_a import tokens_of
from engine.normalize import NormalizedUrl
from shared.contract import Evidence

NAN = float("nan")
PATH_BAIT = set(SIGNALS["path_bait_words"])
PAGE_CODES = {
    "CARD_FORM", "OTP_FIELD", "PASSWORD_FIELD", "EMIRATES_ID_FIELD", "IBAN_FIELD", "CROSS_DOMAIN_FORM",
    "BRAND_IN_CONTENT", "URGENCY_LANGUAGE", "PAYMENT_REQUEST", "VISUAL_SIMILARITY", "FAVICON_MATCH", "CLOAKING",
}
OVERRIDE_CODES = {"OFFICIAL_DOMAIN", "GOV_AE_DOMAIN"}
CERT_CODES = {"CERT_FIRST_SEEN_LT_7D"}
MODEL_CODE = "ML_MODEL"

# Rule signals used as yes/no features, with a plain-language label for the feature-importance chart.
CODE_FEATURES: dict[str, tuple[str, str]] = {
    "BRAND_IN_DOMAIN": ("Brand name in the domain", "اسم علامة تجارية في النطاق"),
    "BRAND_IN_SUBDOMAIN": ("Brand name in a subdomain", "اسم علامة تجارية في نطاق فرعي"),
    "OFFICIAL_DOMAIN_IN_HOST": ("Official domain used as a disguise", "نطاق رسمي مستخدم للتمويه"),
    "BRAND_IN_PATH": ("Brand name in the page path", "اسم علامة تجارية في مسار الصفحة"),
    "LOOKALIKE_CHAR_SWAP": ("Look-alike letters or digits", "حروف أو أرقام مشابهة"),
    "LOOKALIKE_EDIT_DISTANCE": ("Misspelt official domain", "تهجئة خاطئة لنطاق رسمي"),
    "HOMOGLYPH_BRAND": ("Characters from another alphabet", "حروف من أبجدية أخرى"),
    "PUNYCODE": ("International (punycode) domain", "نطاق دولي (Punycode)"),
    "BAIT_IN_DOMAIN": ("Bait words in the domain", "كلمات استدراج في النطاق"),
    "BRAND_PLUS_BAIT": ("Brand name plus bait words", "اسم علامة تجارية مع كلمات استدراج"),
    "RISKY_TLD": ("High-risk domain ending", "امتداد نطاق عالي الخطورة"),
    "IP_HOST": ("Raw IP address instead of a name", "عنوان IP بدلاً من اسم"),
    "USERINFO_IN_URL": ("'@' trick in the address", "حيلة '@' في العنوان"),
    "FREE_HOSTING": ("Free hosting platform", "منصة استضافة مجانية"),
    "SHORTENER": ("Link shortener", "خدمة اختصار روابط"),
    "TRANCO_TOP": ("Among the world's top 10,000 sites", "ضمن أكثر 10,000 موقع زيارة عالمياً"),
    "DOMAIN_NOT_REGISTERED": ("Domain not registered", "النطاق غير مسجّل"),
    "NO_DNS": ("Domain does not resolve", "النطاق لا يعمل"),
    "CROSS_DOMAIN_REDIRECT": ("Redirects to another domain", "يعيد التوجيه إلى نطاق آخر"),
}

NUMERIC_FEATURES: dict[str, tuple[str, str]] = {
    "url_length": ("Address length", "طول العنوان"),
    "host_length": ("Host name length", "طول اسم الموقع"),
    "domain_label_length": ("Main domain name length", "طول اسم النطاق الرئيسي"),
    "path_length": ("Page path length", "طول مسار الصفحة"),
    "path_depth": ("Folders in the page path", "عدد المجلدات في المسار"),
    "query_params": ("Query parameters", "عدد معاملات الاستعلام"),
    "subdomain_count": ("Number of subdomains", "عدد النطاقات الفرعية"),
    "host_hyphens": ("Hyphens in the host name", "الشرطات في اسم الموقع"),
    "host_digits": ("Digits in the host name", "الأرقام في اسم الموقع"),
    "url_digit_ratio": ("Share of digits in the address", "نسبة الأرقام في العنوان"),
    "special_chars": ("Special characters (@ ~ % = & _)", "الرموز الخاصة (@ ~ % = & _)"),
    "host_entropy": ("Randomness of the host name", "عشوائية اسم الموقع"),
    "path_bait_words": ("Bait words in the path (login, verify, pay...)", "كلمات استدراج في المسار"),
    "tld_ae": (".ae domain", "نطاق ‎.ae‎"),
    "tld_com": (".com domain", "نطاق ‎.com‎"),
    "domain_age_days": ("Domain age", "عمر النطاق"),
    "rdap_found": ("Registration record found", "تم العثور على سجل التسجيل"),
    "dns_resolves": ("Domain resolves in DNS", "النطاق يعمل في نظام DNS"),
    "mx_records": ("Mail servers (MX records)", "خوادم البريد (MX)"),
    "ns_count": ("Name servers", "خوادم الأسماء"),
    "redirects": ("Number of redirects", "عدد عمليات إعادة التوجيه"),
    "rule_score": ("Rule engine score", "درجة محرك القواعد"),
}

FEATURE_NAMES: list[str] = list(NUMERIC_FEATURES) + [f"code_{c.lower()}" for c in CODE_FEATURES]


def feature_label(name: str) -> tuple[str, str]:
    if name in NUMERIC_FEATURES:
        return NUMERIC_FEATURES[name]
    return CODE_FEATURES[name.removeprefix("code_").upper()]


def rule_score(codes: Iterable[str]) -> int:
    """Rule score from URL and network signals only (no live-page or certificate signals), as in training."""
    weights = SIGNALS["weights"]
    skipped = PAGE_CODES | CERT_CODES | {MODEL_CODE}
    total = sum(weights.get(c, 0) for c in set(codes) if c not in skipped)
    return max(0, min(100, total))


def _entropy(text: str) -> float:
    if not text:
        return 0.0
    counts = Counter(text)
    return -sum(n / len(text) * math.log2(n / len(text)) for n in counts.values())


def _days(now: datetime, then: datetime | None) -> float:
    return float((now - then).days) if then else NAN


def extract(url: NormalizedUrl, codes: Iterable[str], evidence: Evidence, now: datetime) -> list[float]:
    codes = set(codes)
    host_core = url.host.removesuffix("." + url.suffix) if url.suffix else url.host
    subdomain_labels = [l for l in url.subdomain.split(".") if l and l != "www"]
    path_tokens = tokens_of(f"{url.path} {url.query}")
    dns = evidence.dns
    if "NO_DNS" in codes:
        resolves = 0.0
    elif dns and dns.a:
        resolves = 1.0
    else:
        resolves = NAN
    if evidence.rdap:
        rdap_found = 1.0
    elif "DOMAIN_NOT_REGISTERED" in codes:
        rdap_found = 0.0
    else:
        rdap_found = NAN
    tld = url.suffix.split(".")[-1] if url.suffix else ""
    values = {
        "url_length": float(len(url.url)),
        "host_length": float(len(url.host)),
        "domain_label_length": float(len(url.domain_label)),
        "path_length": float(len(url.path.rstrip("/"))),
        "path_depth": float(len([p for p in url.path.split("/") if p])),
        "query_params": float(len([p for p in url.query.split("&") if p])),
        "subdomain_count": float(len(subdomain_labels)),
        "host_hyphens": float(url.host.count("-")),
        "host_digits": float(sum(ch.isdigit() for ch in host_core)),
        "url_digit_ratio": sum(ch.isdigit() for ch in url.url) / max(1, len(url.url)),
        "special_chars": float(sum(url.url.count(ch) for ch in "@~%=&_")),
        "host_entropy": _entropy(host_core),
        "path_bait_words": float(sum(t in PATH_BAIT for t in path_tokens)),
        "tld_ae": float(tld == "ae"),
        "tld_com": float(tld == "com"),
        "domain_age_days": _days(now, evidence.rdap.created if evidence.rdap else None),
        "rdap_found": rdap_found,
        "dns_resolves": resolves,
        "mx_records": float(len(dns.mx)) if dns else NAN,
        "ns_count": float(len(dns.ns)) if dns else NAN,
        "redirects": float(max(0, len(evidence.redirect_chain) - 1)),
        "rule_score": float(rule_score(codes)),
    }
    return [values[name] for name in NUMERIC_FEATURES] + [float(code in codes) for code in CODE_FEATURES]
