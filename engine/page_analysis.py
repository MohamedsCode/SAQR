"""Layer B analysis of a captured page: forms, content, contact indicators, cloaking and visual similarity.

Pure functions over data the browser captured, so they can be tested without a browser.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from functools import lru_cache
from urllib.parse import unquote, urlsplit

import imagehash
import phonenumbers
from PIL import Image
from rapidfuzz import fuzz

from engine.brands import SIGNALS, brands
from engine.normalize import InvalidInput, normalize
from engine.reasons import Signal
from engine.settings import ROOT
from shared.contract import Cloaking, Form, VisualSimilarity

FIELD_PATTERNS: dict[str, re.Pattern] = {
    "card_number": re.compile(r"card.?(number|no|num)|cc.?(num|number)|cardnumber|\bpan\b|credit.?card|debit.?card"
                              r"|رقم.?البطاقة|رقم.?بطاقة|بطاقة.?الائتمان", re.I),
    "card_expiry": re.compile(r"expir|exp.?(date|month|year)|mm.?/?.?yy|valid.?thru|تاريخ.?الانتهاء|تاريخ.?انتهاء"
                              r"|صلاحية", re.I),
    "cvv": re.compile(r"\bcvv|\bcvc|\bcv2|security.?code|\bcsc\b|الرمز.?السري|رمز.?الأمان|رمز.?الامان", re.I),
    "otp": re.compile(r"\botp\b|one.?time|verification.?code|sms.?code|passcode|رمز.?التحقق|رمز.?التأكيد"
                      r"|كلمة.?المرور.?لمرة|الرمز.?المرسل", re.I),
    "password": re.compile(r"password|passwd|\bpin\b|كلمة.?المرور|كلمة.?السر", re.I),
    "emirates_id": re.compile(r"emirates.?id|\beid\b|784-?\d{4}|رقم.?الهوية|الهوية.?الإماراتية|الهوية.?الاماراتية",
                              re.I),
    "iban": re.compile(r"\biban\b|account.?(number|no)|رقم.?الحساب|الآيبان|ايبان|الايبان", re.I),
}
AUTOCOMPLETE = {"cc-number": "card_number", "cc-exp": "card_expiry", "cc-exp-month": "card_expiry",
                "cc-exp-year": "card_expiry", "cc-csc": "cvv", "one-time-code": "otp",
                "current-password": "password", "new-password": "password"}
SENSITIVE = {"card_number", "card_expiry", "cvv", "otp", "password", "emirates_id", "iban"}
URGENCY = [
    "within 24 hours", "within 48 hours", "immediately", "urgent", "final notice", "last chance", "last warning",
    "avoid penalty", "avoid additional", "will be suspended", "will be blocked", "has been suspended",
    "will be returned", "act now", "expires today", "legal action", "impound",
    "خلال 24 ساعة", "خلال 48 ساعة", "فوراً", "فورا", "عاجل", "إشعار نهائي", "اشعار نهائي", "آخر فرصة", "اخر فرصة",
    "لتجنب حجز", "لتجنب الغرامة", "لتجنب الغرامات", "لتجنب المخالفة", "لتجنب إيقاف", "لتجنب تعليق", "سيتم إيقاف", "سيتم ايقاف", "سيتم تعليق", "سيتم حظر", "سيتم إرجاع", "إجراءات قانونية", "حجز المركبة",
]
PAYMENT = re.compile(r"(\bAED\s?[\d,.]+|[\d,.]+\s?(AED|درهم)|\bpay now\b|\bpay the fine\b|ادفع الآن|ادفع الان"
                     r"|رسوم\s+(إعادة|اعادة)|دفع\s+المخالفة|سداد\s+المخالفة)", re.I)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
ASSETS_DIR = ROOT / "shared" / "brand_assets"


@dataclass
class Capture:
    """What one browser visit captured."""
    profile: str
    ok: bool
    status: int | None = None
    final_url: str | None = None
    chain: list[str] = field(default_factory=list)
    title: str = ""
    text: str = ""
    html: str = ""
    screenshot: bytes | None = None
    forms: list[dict] = field(default_factory=list)
    links: list[str] = field(default_factory=list)
    favicon: bytes | None = None
    error: str | None = None


@dataclass
class PageFindings:
    signals: list[Signal] = field(default_factory=list)
    forms: list[Form] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)
    brand_id: str | None = None
    visual: VisualSimilarity | None = None
    favicon_phash: str | None = None
    cloaking: Cloaking | None = None

    def add(self, code: str, evidence: str | None = None, brand_id: str | None = None) -> None:
        if not any(s.code == code for s in self.signals):
            self.signals.append(Signal(code, evidence, brand_id))


def _registered(url: str) -> str | None:
    try:
        return normalize(url).registered_domain
    except InvalidInput:
        return None


def classify_field(field_info: dict) -> set[str]:
    kinds = set()
    auto = (field_info.get("autocomplete") or "").lower()
    if auto in AUTOCOMPLETE:
        kinds.add(AUTOCOMPLETE[auto])
    text = " ".join(str(field_info.get(k) or "") for k in ("name", "id", "placeholder", "label", "aria"))
    for kind, pattern in FIELD_PATTERNS.items():
        if pattern.search(text):
            kinds.add(kind)
    if (field_info.get("type") or "").lower() == "password" and "otp" not in kinds:
        kinds.add("password")
    if "otp" in kinds:
        kinds.discard("password")
    return kinds


def analyse_forms(raw_forms: list[dict], page_url: str, findings: PageFindings) -> None:
    page_domain = _registered(page_url)
    asked: dict[str, str] = {}
    for raw in raw_forms:
        fields = raw.get("fields") or []
        if not fields:
            continue
        kinds_per_field = [(f, classify_field(f)) for f in fields]
        asks_for = sorted({k for _, ks in kinds_per_field for k in ks})
        names = [str(f.get("label") or f.get("placeholder") or f.get("name") or f.get("id") or f.get("type"))[:60]
                 for f in fields][:20]
        action = raw.get("action") or None
        findings.forms.append(Form(action=action, fields=names, asks_for=asks_for))
        for f, ks in kinds_per_field:
            for kind in ks:
                asked.setdefault(kind, str(f.get("label") or f.get("placeholder") or f.get("name") or kind)[:60])
        if action and asks_for and action.startswith(("http://", "https://")):
            action_domain = _registered(action)
            if action_domain and page_domain and action_domain != page_domain:
                findings.add("CROSS_DOMAIN_FORM", urlsplit(action).hostname)
    if "card_number" in asked or {"cvv", "card_expiry"} <= set(asked):
        findings.add("CARD_FORM", "Fields: " + ", ".join(asked[k] for k in ("card_number", "card_expiry", "cvv")
                                                         if k in asked))
    if "otp" in asked:
        findings.add("OTP_FIELD", "Field: " + asked["otp"])
    if "password" in asked:
        findings.add("PASSWORD_FIELD", "Field: " + asked["password"])
    if "emirates_id" in asked:
        findings.add("EMIRATES_ID_FIELD", "Field: " + asked["emirates_id"])
    if "iban" in asked:
        findings.add("IBAN_FIELD", "Field: " + asked["iban"])


@lru_cache(maxsize=1)
def _content_patterns() -> list[tuple[str, re.Pattern]]:
    patterns = []
    for brand in brands().values():
        terms = {brand.name_en, *brand.keywords_ar, brand.name_ar}
        terms |= {k for k in brand.keywords_en if len(k) >= 5 and " " in k}
        terms = {t for t in terms if len(t) >= 4}
        alternation = "|".join(sorted((re.escape(t) for t in terms), key=len, reverse=True))
        patterns.append((brand.id, re.compile(rf"(?<![\w؀-ۿ])({alternation})(?![\w؀-ۿ])", re.I)))
    return patterns


def brand_in_content(title: str, text: str) -> tuple[str, str] | None:
    """(brand id, matched term) for the brand the page presents itself as, if any."""
    best: tuple[int, str, str] | None = None
    body = text[:20000]
    for brand_id, pattern in _content_patterns():
        title_hits = pattern.findall(title)
        body_hits = pattern.findall(body)
        score = 3 * len(title_hits) + len(body_hits)
        if score >= 3 and (best is None or score > best[0]):
            best = (score, brand_id, (title_hits or body_hits)[0])
    return (best[1], best[2]) if best else None


def analyse_text(title: str, text: str, findings: PageFindings) -> None:
    match = brand_in_content(title, text)
    if match:
        findings.brand_id = match[0]
        findings.add("BRAND_IN_CONTENT", f"“{match[1]}” in the page", match[0])
    lowered = text.lower()
    urgent = [p for p in URGENCY if p.lower() in lowered][:4]
    payment = PAYMENT.search(text)
    if len(urgent) >= 2 or (urgent and payment):
        findings.add("URGENCY_LANGUAGE", "; ".join(f"“{p}”" for p in urgent))
    if payment:
        findings.add("PAYMENT_REQUEST", f"“{payment.group(0).strip()}”")


def _number_from_link(link: str) -> str | None:
    """E.164 number from a tel:, wa.me or api.whatsapp.com link."""
    if link.startswith("tel:"):
        raw = link[4:]
    elif "wa.me/" in link:
        raw = "+" + link.split("wa.me/", 1)[1].split("?")[0].split("/")[0].lstrip("+")
    else:
        match = re.search(r"phone=\+?(\d+)", link)
        raw = "+" + match.group(1) if match else ""
    digits = re.sub(r"[^\d+]", "", raw)
    if not digits:
        return None
    try:
        parsed = phonenumbers.parse(digits, "AE")
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_possible_number(parsed):
        return None
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def indicators(text: str, links: list[str], findings: PageFindings) -> None:
    numbers = {
        phonenumbers.format_number(m.number, phonenumbers.PhoneNumberFormat.E164)
        for m in phonenumbers.PhoneNumberMatcher(text[:20000], "AE")
    }
    emails = set(EMAIL.findall(text[:20000]))
    for link in links:
        link = unquote(link)
        if link.startswith("mailto:"):
            emails.add(link[7:].split("?")[0])
        elif number := _number_from_link(link):
            numbers.add(number)
    findings.phones = sorted(numbers)[:20]
    findings.emails = sorted(e.lower() for e in emails if not e.lower().endswith((".png", ".jpg", ".svg")))[:20]


def detect_cloaking(desktop: Capture, mobile: Capture) -> Cloaking | None:
    if not desktop.ok and not mobile.ok:
        return None
    if desktop.ok != mobile.ok:
        good, bad = (desktop, mobile) if desktop.ok else (mobile, desktop)
        return Cloaking(detected=True, details=f"Only the {good.profile} visit received the page; the "
                                               f"{bad.profile} visit failed ({bad.error or bad.status}).")
    d_domain = _registered(desktop.final_url or "")
    m_domain = _registered(mobile.final_url or "")
    if d_domain and m_domain and d_domain != m_domain:
        return Cloaking(detected=True, details=f"Desktop Chrome ended on {desktop.final_url}; iPhone Safari with "
                                               f"ar-AE locale ended on {mobile.final_url}.")
    d_text, m_text = desktop.text.strip(), mobile.text.strip()
    if len(d_text) >= 200 and len(m_text) >= 200:
        similarity = fuzz.token_set_ratio(d_text[:3000], m_text[:3000])
        if similarity < 35:
            return Cloaking(detected=True, details=f"Desktop and mobile visits showed different content "
                                                   f"({similarity:.0f}% text overlap).")
    return Cloaking(detected=False, details=None)


def _hash_image(data: bytes) -> imagehash.ImageHash | None:
    try:
        with Image.open(io.BytesIO(data)) as image:
            return imagehash.phash(image.convert("RGB"))
    except Exception:
        return None


@lru_cache(maxsize=1)
def reference_hashes() -> dict[str, tuple[imagehash.ImageHash | None, imagehash.ImageHash | None]]:
    """Brand id -> (reference screenshot hash, favicon hash), for brands whose assets have been captured."""
    refs = {}
    for brand in brands().values():
        shot = ROOT / brand.reference_screenshot_path if brand.reference_screenshot_path else None
        icon = ROOT / brand.favicon_path if brand.favicon_path else None
        shot_hash = _hash_image(shot.read_bytes()) if shot and shot.is_file() else None
        icon_hash = _hash_image(icon.read_bytes()) if icon and icon.is_file() else None
        if shot_hash or icon_hash:
            refs[brand.id] = (shot_hash, icon_hash)
    return refs


def visual_similarity(screenshot: bytes | None, favicon: bytes | None, findings: PageFindings) -> None:
    page_hash = _hash_image(screenshot) if screenshot else None
    icon_hash = _hash_image(favicon) if favicon else None
    findings.favicon_phash = str(icon_hash) if icon_hash else None
    best: tuple[float, str] | None = None
    for brand_id, (ref_shot, ref_icon) in reference_hashes().items():
        if page_hash and ref_shot:
            percent = round((1 - (page_hash - ref_shot) / 64) * 100, 1)
            if best is None or percent > best[0]:
                best = (percent, brand_id)
        if icon_hash and ref_icon and icon_hash - ref_icon <= SIGNALS["favicon_max_distance"]:
            findings.add("FAVICON_MATCH", f"Favicon matches {brands()[brand_id].name_en} "
                                          f"({icon_hash - ref_icon} bits apart)", brand_id)
    if best:
        findings.visual = VisualSimilarity(brand_id=best[1], percent=best[0])
        if best[0] >= SIGNALS["visual_similarity_min_percent"]:
            findings.add("VISUAL_SIMILARITY", f"{best[0]}% similar to the official "
                                              f"{brands()[best[1]].name_en} page", best[1])


def analyse_captures(desktop: Capture, mobile: Capture) -> tuple[PageFindings, Capture]:
    """Combine both visits. The primary capture is the one that asks for more sensitive data."""
    findings = PageFindings()
    findings.cloaking = detect_cloaking(desktop, mobile)
    per_visit = []
    for capture in (desktop, mobile):
        if not capture.ok:
            continue
        local = PageFindings()
        analyse_forms(capture.forms, capture.final_url or "", local)
        per_visit.append((capture, local))
    if not per_visit:
        return findings, desktop
    primary, form_findings = max(per_visit, key=lambda pair: (sum(s.weight for s in pair[1].signals),
                                                              pair[0].profile == "mobile"))
    findings.forms = form_findings.forms
    findings.signals = list(form_findings.signals)
    analyse_text(primary.title, primary.text, findings)
    indicators(primary.text, primary.links, findings)
    visual_similarity(primary.screenshot, primary.favicon, findings)
    if findings.cloaking and findings.cloaking.detected:
        findings.add("CLOAKING", findings.cloaking.details)
    return findings, primary
