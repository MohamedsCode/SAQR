from engine.page_analysis import (
    Capture,
    PageFindings,
    analyse_captures,
    analyse_forms,
    analyse_text,
    classify_field,
    detect_cloaking,
    indicators,
)


def field(**kwargs):
    return {"name": "", "id": "", "type": "text", "placeholder": "", "label": "", "autocomplete": "", "aria": "",
            **kwargs}


ARABIC_PAYMENT_FORM = {
    "action": "https://collect.evil-sink.top/submit",
    "method": "post",
    "fields": [
        field(label="رقم البطاقة"),
        field(placeholder="تاريخ الانتهاء"),
        field(label="الرمز السري", type="password"),
        field(label="رمز التحقق"),
        field(label="رقم الهوية الإماراتية"),
    ],
}


def test_arabic_form_fields_are_classified():
    assert classify_field(field(label="رقم البطاقة")) == {"card_number"}
    assert classify_field(field(placeholder="تاريخ الانتهاء")) == {"card_expiry"}
    assert "cvv" in classify_field(field(label="الرمز السري", type="password"))
    assert classify_field(field(label="رمز التحقق")) == {"otp"}
    assert classify_field(field(label="رقم الهوية الإماراتية")) == {"emirates_id"}
    assert classify_field(field(label="رقم الحساب / الآيبان")) == {"iban"}


def test_english_and_autocomplete_fields():
    assert classify_field(field(name="cardNumber")) == {"card_number"}
    assert classify_field(field(autocomplete="cc-csc", name="x")) == {"cvv"}
    assert classify_field(field(autocomplete="one-time-code", type="password")) == {"otp"}
    assert classify_field(field(type="password", name="pwd")) == {"password"}
    assert classify_field(field(name="email", placeholder="Your email")) == set()


def test_payment_form_signals_and_cross_domain_post():
    findings = PageFindings()
    analyse_forms([ARABIC_PAYMENT_FORM], "https://adpolice-fines.top/pay", findings)
    codes = {s.code for s in findings.signals}
    assert {"CARD_FORM", "OTP_FIELD", "EMIRATES_ID_FIELD", "CROSS_DOMAIN_FORM"} <= codes
    assert findings.forms[0].asks_for == ["card_expiry", "card_number", "cvv", "emirates_id", "otp", "password"]


def test_same_site_form_is_not_cross_domain():
    findings = PageFindings()
    form = {"action": "https://www.shop.example/checkout", "fields": [field(name="cardNumber")]}
    analyse_forms([form], "https://shop.example/cart", findings)
    assert "CROSS_DOMAIN_FORM" not in {s.code for s in findings.signals}


def test_brand_urgency_and_payment_language():
    findings = PageFindings()
    analyse_text("شرطة أبوظبي - دفع المخالفات",
                 "لديك مخالفة غير مدفوعة بقيمة AED 3,000. ادفع خلال 24 ساعة لتجنب حجز المركبة.", findings)
    codes = {s.code for s in findings.signals}
    assert findings.brand_id == "adpolice"
    assert {"BRAND_IN_CONTENT", "URGENCY_LANGUAGE", "PAYMENT_REQUEST"} <= codes


def test_generic_wording_is_not_urgency():
    findings = PageFindings()
    analyse_text("Example", "هذه ليست خدمة، يُرجى تجنب الاعتماد عليها. Please reply immediately.", findings)
    assert "URGENCY_LANGUAGE" not in {s.code for s in findings.signals}


def test_passing_mention_is_not_brand_impersonation():
    findings = PageFindings()
    analyse_text("Weekend traffic news", "Drivers reported delays near a Salik gate on Sunday.", findings)
    assert findings.brand_id is None


def test_phone_and_email_indicators():
    findings = PageFindings()
    indicators("Call us on 050 123 4567 or write to help@scam.example",
               ["tel:+97142000000", "https://wa.me/971521112233", "mailto:pay@scam.example?subject=x"], findings)
    assert {"+971501234567", "+97142000000", "+971521112233"} <= set(findings.phones)
    assert {"help@scam.example", "pay@scam.example"} <= set(findings.emails)


def test_cloaking_on_different_final_domains():
    desktop = Capture("desktop", ok=True, status=200, final_url="https://www.google.com/")
    mobile = Capture("mobile", ok=True, status=200, final_url="https://adpolice-fines.top/pay")
    assert detect_cloaking(desktop, mobile).detected


def test_cloaking_when_only_one_visit_gets_the_page():
    desktop = Capture("desktop", ok=False, status=403, error="HTTP 403")
    mobile = Capture("mobile", ok=True, status=200, final_url="https://x.top/")
    result = detect_cloaking(desktop, mobile)
    assert result.detected and "mobile" in result.details


def test_same_page_is_not_cloaking():
    text = "Welcome to our store. " * 30
    desktop = Capture("desktop", ok=True, status=200, final_url="https://shop.example/", text=text)
    mobile = Capture("mobile", ok=True, status=200, final_url="https://shop.example/", text=text)
    assert not detect_cloaking(desktop, mobile).detected


def test_primary_capture_is_the_one_asking_for_data():
    desktop = Capture("desktop", ok=True, status=200, final_url="https://x.top/", text="Hello")
    mobile = Capture("mobile", ok=True, status=200, final_url="https://x.top/pay", forms=[ARABIC_PAYMENT_FORM],
                     title="شرطة أبوظبي", text="ادفع الآن")
    findings, primary = analyse_captures(desktop, mobile)
    assert primary.profile == "mobile"
    assert {"CARD_FORM", "BRAND_IN_CONTENT"} <= {s.code for s in findings.signals}
