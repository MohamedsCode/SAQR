"""Bilingual text for every signal. {brand_en}/{brand_ar} are filled with the impersonated brand's name."""

from __future__ import annotations

from dataclasses import dataclass

from engine.brands import SIGNALS, brands
from shared.contract import Reason

TEXT: dict[str, tuple[str, str]] = {
    "OFFICIAL_DOMAIN": (
        "Verified official domain of {brand_en}.",
        "نطاق رسمي موثّق لـ{brand_ar}.",
    ),
    "GOV_AE_DOMAIN": (
        "Registered under .gov.ae, which only UAE government entities can use.",
        "مسجّل تحت النطاق ‎.gov.ae‎ المخصص للجهات الحكومية الإماراتية فقط.",
    ),
    "BRAND_IN_DOMAIN": (
        "Domain uses the name of {brand_en} but is not an official {brand_en} domain.",
        "يستخدم النطاق اسم {brand_ar} لكنه ليس نطاقاً رسمياً تابعاً لها.",
    ),
    "BRAND_IN_SUBDOMAIN": (
        "Subdomain uses the name of {brand_en} on a site that does not belong to {brand_en}.",
        "يستخدم النطاق الفرعي اسم {brand_ar} على موقع لا يتبع لها.",
    ),
    "OFFICIAL_DOMAIN_IN_HOST": (
        "Address contains the official {brand_en} domain as a disguise, but the real site is different.",
        "يتضمن العنوان النطاق الرسمي لـ{brand_ar} للتمويه، لكن الموقع الفعلي مختلف.",
    ),
    "BRAND_IN_PATH": (
        "Page address mentions {brand_en} on a site that does not belong to {brand_en}.",
        "يذكر عنوان الصفحة {brand_ar} على موقع لا يتبع لها.",
    ),
    "LOOKALIKE_CHAR_SWAP": (
        "Domain imitates {brand_en} by swapping letters for look-alike digits or letters.",
        "يقلّد النطاق اسم {brand_ar} باستبدال حروف بأرقام أو حروف مشابهة.",
    ),
    "LOOKALIKE_EDIT_DISTANCE": (
        "Domain is a misspelling of an official {brand_en} domain.",
        "النطاق تهجئة خاطئة متعمدة لنطاق رسمي لـ{brand_ar}.",
    ),
    "HOMOGLYPH_BRAND": (
        "Domain uses look-alike characters from another alphabet to imitate {brand_en}.",
        "يستخدم النطاق حروفاً مشابهة من أبجدية أخرى لتقليد {brand_ar}.",
    ),
    "MIXED_SCRIPT": (
        "Domain mixes letters from different alphabets, a common disguise trick.",
        "يخلط النطاق حروفاً من أبجديات مختلفة، وهي حيلة تمويه شائعة.",
    ),
    "PUNYCODE": (
        "Domain uses international characters that can disguise its real spelling.",
        "يستخدم النطاق حروفاً دولية قد تخفي تهجئته الحقيقية.",
    ),
    "BAIT_IN_DOMAIN": (
        "Domain contains words scammers use to look official or urgent.",
        "يحتوي النطاق على كلمات يستخدمها المحتالون للإيهام بالرسمية أو الاستعجال.",
    ),
    "BRAND_PLUS_BAIT": (
        "Domain combines a brand name with payment or service bait words.",
        "يجمع النطاق بين اسم علامة تجارية وكلمات طُعم للدفع أو الخدمات.",
    ),
    "PATH_BAIT": (
        "Page address contains login, payment or verification bait words.",
        "يحتوي عنوان الصفحة على كلمات طُعم لتسجيل الدخول أو الدفع أو التحقق.",
    ),
    "PATH_BAIT_MANY": (
        "Page address is packed with login, payment and verification bait words.",
        "عنوان الصفحة مليء بكلمات طُعم لتسجيل الدخول والدفع والتحقق.",
    ),
    "RISKY_TLD": (
        "Uses a domain extension that is frequently abused for scams.",
        "يستخدم امتداد نطاق يُستغل كثيراً في الاحتيال.",
    ),
    "IP_HOST": (
        "Address is a bare IP number instead of a named website.",
        "العنوان رقم IP مجرد بدلاً من اسم موقع.",
    ),
    "USERINFO_IN_URL": (
        "Address hides the real destination behind an '@' sign.",
        "يخفي العنوان الوجهة الحقيقية خلف علامة '@'.",
    ),
    "MANY_SUBDOMAINS": (
        "Address has an unusually deep chain of subdomains.",
        "يحتوي العنوان على سلسلة طويلة غير معتادة من النطاقات الفرعية.",
    ),
    "MANY_HYPHENS": (
        "Domain is built from many hyphenated words, typical of throwaway scam domains.",
        "يتكون النطاق من كلمات كثيرة مفصولة بشرطات، وهو نمط شائع في نطاقات الاحتيال المؤقتة.",
    ),
    "LONG_URL": (
        "Address is unusually long.",
        "العنوان طويل بشكل غير معتاد.",
    ),
    "NON_STANDARD_PORT": (
        "Site runs on a non-standard network port.",
        "يعمل الموقع على منفذ شبكة غير قياسي.",
    ),
    "FREE_HOSTING": (
        "Hosted on a free platform that anyone can publish on, often used for throwaway scam pages.",
        "مستضاف على منصة مجانية يمكن لأي شخص النشر عليها، وتُستخدم كثيراً لصفحات احتيال مؤقتة.",
    ),
    "SHORTENER": (
        "Link was hidden behind a URL shortener.",
        "تم إخفاء الرابط خلف خدمة اختصار روابط.",
    ),
    "TRANCO_TOP": (
        "Domain is among the 10,000 most visited websites worldwide.",
        "النطاق من بين أكثر 10,000 موقع زيارة في العالم.",
    ),
    "DOMAIN_AGE_LT_7D": (
        "Domain was registered less than 7 days ago.",
        "تم تسجيل النطاق منذ أقل من 7 أيام.",
    ),
    "DOMAIN_AGE_LT_30D": (
        "Domain was registered less than 30 days ago.",
        "تم تسجيل النطاق منذ أقل من 30 يوماً.",
    ),
    "DOMAIN_AGE_LT_90D": (
        "Domain was registered less than 90 days ago.",
        "تم تسجيل النطاق منذ أقل من 90 يوماً.",
    ),
    "DOMAIN_AGE_GT_2Y": (
        "Domain has been registered for more than two years.",
        "النطاق مسجّل منذ أكثر من عامين.",
    ),
    "DOMAIN_NOT_REGISTERED": (
        "Domain is no longer registered, which often happens after a scam site is taken down.",
        "النطاق لم يعد مسجلاً، وهو ما يحدث غالباً بعد إيقاف موقع احتيالي.",
    ),
    "NO_DNS": (
        "Domain does not resolve to any server.",
        "النطاق لا يشير إلى أي خادم.",
    ),
    "CERT_FIRST_SEEN_LT_7D": (
        "The site's first security certificate was issued less than 7 days ago.",
        "صدرت أول شهادة أمان للموقع منذ أقل من 7 أيام.",
    ),
    "CROSS_DOMAIN_REDIRECT": (
        "Link redirects to a different website.",
        "يعيد الرابط التوجيه إلى موقع مختلف.",
    ),
    "REDIRECTS_TO_OFFICIAL": (
        "Link ends on an official website.",
        "ينتهي الرابط على موقع رسمي.",
    ),
    "OFFLINE": (
        "Site is offline; scored on its address and registration data only.",
        "الموقع غير متاح؛ تم التقييم بناءً على العنوان وبيانات التسجيل فقط.",
    ),
}


@dataclass(frozen=True)
class Signal:
    code: str
    evidence: str | None = None
    brand_id: str | None = None

    @property
    def weight(self) -> int:
        return SIGNALS["weights"].get(self.code, 0)

    def reason(self) -> Reason:
        en, ar = TEXT[self.code]
        brand = brands().get(self.brand_id) if self.brand_id else None
        names = {
            "brand_en": brand.name_en if brand else "the brand",
            "brand_ar": brand.name_ar if brand else "العلامة التجارية",
        }
        return Reason(code=self.code, en=en.format(**names), ar=ar.format(**names), weight=self.weight,
                      evidence=self.evidence)
