"""Turn signals into a score, a verdict, bilingual reasons and a plain-language summary."""

from __future__ import annotations

from engine.brands import brands
from engine.reasons import Signal
from shared.contract import Reason, Verdict, verdict_for

VERDICT_TEXT = {
    "safe": ("Safe", "آمن"),
    "suspicious": ("Suspicious", "مشبوه"),
    "fraud": ("Fraud", "احتيال"),
}
CATEGORY_BY_BRAND = {
    "government": "government_services",
    "bank": "banking",
    "telecom": "telecom",
    "delivery": "parcel_redelivery",
}
FINE_WORDS = {"fine", "fines", "violation", "violations", "penalty", "traffic", "mukhalafat"}


def score_signals(signals: list[Signal], override: Signal | None = None) -> tuple[int, Verdict, list[Reason]]:
    if override:
        return 0, "safe", [override.reason()]
    reasons = sorted((s.reason() for s in signals), key=lambda r: -r.weight)
    score = max(0, min(100, sum(r.weight for r in reasons)))
    return score, verdict_for(score), reasons


def category_for(brand_id: str | None, words: list[str]) -> str | None:
    if not brand_id:
        return None
    brand = brands()[brand_id]
    if brand.category in {"police", "transport"}:
        if brand_id in {"salik", "darb"} and not FINE_WORDS & set(words):
            return "toll_topup"
        return "traffic_fine"
    return CATEGORY_BY_BRAND.get(brand.category)


def template_summary(verdict: Verdict, score: int, reasons: list[Reason], brand_id: str | None,
                     status: str) -> tuple[str, str]:
    label_en, label_ar = VERDICT_TEXT[verdict]
    if reasons and reasons[0].code in {"OFFICIAL_DOMAIN", "GOV_AE_DOMAIN"}:
        return (f"{label_en}: {reasons[0].en} No risk signals apply.",
                f"{label_ar}: {reasons[0].ar} لا توجد مؤشرات خطر.")
    top = [r for r in reasons if r.weight > 0][:3]
    if not top:
        return (f"{label_en} (score {score}/100): no significant risk signals were found.",
                f"{label_ar} (الدرجة {score}/100): لم يتم العثور على مؤشرات خطر مهمة.")
    brand = brands().get(brand_id) if brand_id else None
    lead_en = f"{label_en} (score {score}/100)"
    lead_ar = f"{label_ar} (الدرجة {score}/100)"
    if brand and verdict != "safe":
        lead_en += f", likely impersonating {brand.name_en}"
        lead_ar += f"، يُرجّح أنه ينتحل صفة {brand.name_ar}"
    en = f"{lead_en}. " + " ".join(r.en for r in top)
    ar = f"{lead_ar}. " + " ".join(r.ar for r in top)
    if status == "offline":
        en += " The site is offline, so this uses address and registration data only."
        ar += " الموقع غير متاح، لذلك يعتمد التقييم على العنوان وبيانات التسجيل فقط."
    return en, ar
