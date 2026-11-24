"""Features for the ML layer, computed the same way at training time and at scan time.

The model judges the registered domain, never the page path: in the labelled data almost every legitimate URL is
a homepage while phishing URLs have long paths, so path features teach "has a path = phishing" and flag real
banks' deep links. Path tricks stay covered by the rule signals. The features are the registered domain's shape,
its registration and DNS records, and the domain-level rule signals.

Live-page signals are left out (the model is trained in network mode), and so is certificate transparency:
crt.sh is too slow to query for a whole training set, so the model would only ever see it missing.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Iterable
from datetime import datetime

from engine.brands import SIGNALS
from engine.normalize import NormalizedUrl
from shared.contract import Evidence

NAN = float("nan")
PAGE_CODES = {
    "CARD_FORM", "OTP_FIELD", "PASSWORD_FIELD", "EMIRATES_ID_FIELD", "IBAN_FIELD", "CROSS_DOMAIN_FORM",
    "BRAND_IN_CONTENT", "URGENCY_LANGUAGE", "PAYMENT_REQUEST", "VISUAL_SIMILARITY", "FAVICON_MATCH", "CLOAKING",
}
PATH_CODES = {"BRAND_IN_PATH", "PATH_BAIT", "PATH_BAIT_MANY", "LONG_URL"}
OVERRIDE_CODES = {"OFFICIAL_DOMAIN", "GOV_AE_DOMAIN"}
CERT_CODES = {"CERT_FIRST_SEEN_LT_7D"}
MODEL_CODE = "ML_MODEL"

# Rule signals used as yes/no features, with a plain-language label for the feature-importance chart.
CODE_FEATURES: dict[str, tuple[str, str]] = {
    "BRAND_IN_DOMAIN": ("Brand name in the domain", "اسم علامة تجارية في النطاق"),
    "BRAND_IN_SUBDOMAIN": ("Brand name in a subdomain", "اسم علامة تجارية في نطاق فرعي"),
    "OFFICIAL_DOMAIN_IN_HOST": ("Official domain used as a disguise", "نطاق رسمي مستخدم للتمويه"),
    "LOOKALIKE_CHAR_SWAP": ("Look-alike letters or digits", "حروف أو أرقام مشابهة"),
    "LOOKALIKE_EDIT_DISTANCE": ("Misspelt official domain", "تهجئة خاطئة لنطاق رسمي"),
    "HOMOGLYPH_BRAND": ("Characters from another alphabet", "حروف من أبجدية أخرى"),
    "PUNYCODE": ("International (punycode) domain", "نطاق دولي (Punycode)"),
    "BAIT_IN_DOMAIN": ("Bait words in the domain", "كلمات استدراج في النطاق"),
    "BRAND_PLUS_BAIT": ("Brand name plus bait words", "اسم علامة تجارية مع كلمات استدراج"),
    "RISKY_TLD": ("High-risk domain ending", "امتداد نطاق عالي الخطورة"),
    "IP_HOST": ("Raw IP address instead of a name", "عنوان IP بدلاً من اسم"),
    "USERINFO_IN_URL": ("'@' trick in the address", "حيلة '@' في العنوان"),
    "MANY_SUBDOMAINS": ("Unusually many subdomains", "عدد كبير غير معتاد من النطاقات الفرعية"),
    "FREE_HOSTING": ("Free hosting platform", "منصة استضافة مجانية"),
    "SHORTENER": ("Link shortener", "خدمة اختصار روابط"),
    "TRANCO_TOP": ("Among the world's top 10,000 sites", "ضمن أكثر 10,000 موقع زيارة عالمياً"),
    "DOMAIN_NOT_REGISTERED": ("Domain not registered", "النطاق غير مسجّل"),
    "NO_DNS": ("Domain does not resolve", "النطاق لا يعمل"),
    "CROSS_DOMAIN_REDIRECT": ("Redirects to another domain", "يعيد التوجيه إلى نطاق آخر"),
}

NUMERIC_FEATURES: dict[str, tuple[str, str]] = {
    "domain_length": ("Domain name length", "طول اسم النطاق"),
    "domain_hyphens": ("Hyphens in the domain name", "الشرطات في اسم النطاق"),
    "domain_digits": ("Digits in the domain name", "الأرقام في اسم النطاق"),
    "domain_entropy": ("Randomness of the domain name", "عشوائية اسم النطاق"),
    "tld_ae": (".ae domain", "نطاق ‎.ae‎"),
    "tld_com": (".com domain", "نطاق ‎.com‎"),
    "domain_age_days": ("Domain age", "عمر النطاق"),
    "rdap_found": ("Registration record found", "تم العثور على سجل التسجيل"),
    "dns_resolves": ("Domain resolves in DNS", "النطاق يعمل في نظام DNS"),
    "mx_records": ("Mail servers (MX records)", "خوادم البريد (MX)"),
    "ns_count": ("Name servers", "خوادم الأسماء"),
    "rule_score": ("Rule engine score (domain signals)", "درجة محرك القواعد (مؤشرات النطاق)"),
}

FEATURE_NAMES: list[str] = list(NUMERIC_FEATURES) + [f"code_{c.lower()}" for c in CODE_FEATURES]


def feature_label(name: str) -> tuple[str, str]:
    if name in NUMERIC_FEATURES:
        return NUMERIC_FEATURES[name]
    return CODE_FEATURES[name.removeprefix("code_").upper()]


def rule_score(codes: Iterable[str]) -> int:
    """Rule score from URL and network signals (no live-page or certificate signals), as in training."""
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
    label = url.domain_label
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
        "domain_length": float(len(label)),
        "domain_hyphens": float(label.count("-")),
        "domain_digits": float(sum(ch.isdigit() for ch in label)),
        "domain_entropy": _entropy(label),
        "tld_ae": float(tld == "ae"),
        "tld_com": float(tld == "com"),
        "domain_age_days": _days(now, evidence.rdap.created if evidence.rdap else None),
        "rdap_found": rdap_found,
        "dns_resolves": resolves,
        "mx_records": float(len(dns.mx)) if dns else NAN,
        "ns_count": float(len(dns.ns)) if dns else NAN,
        "rule_score": float(rule_score(codes - PATH_CODES)),
    }
    return [values[name] for name in NUMERIC_FEATURES] + [float(code in codes) for code in CODE_FEATURES]
