"""Turn a ScanResult into a bilingual (English + Arabic) evidence PDF with a takedown request letter.

Usage:
    python -m evidence.pdf --fixture SQ-20261124-0005 --output case.pdf
    python -m evidence.pdf --all-fixtures --output-dir data/runtime/evidence
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

import arabic_reshaper
from bidi import get_display
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from shared.contract import Brand, ScanResult

ROOT = Path(__file__).resolve().parent.parent
SHARED_DIR = ROOT / "shared"
RUNTIME_DIR = ROOT / "data" / "runtime"
FIXTURES = ROOT / "data" / "fixtures" / "sample_scans.json"
BRAND_CONFIG = json.loads((SHARED_DIR / "brand_config.json").read_text(encoding="utf-8"))
GULF = timezone(timedelta(hours=4), "GST")

# A TrueType font with both Latin and Arabic glyphs. SAQR_PDF_FONT overrides; otherwise the first one found is used.
FONT_CANDIDATES = [
    os.getenv("SAQR_PDF_FONT", ""),
    str(Path(__file__).parent / "fonts" / "NotoNaskhArabic-Regular.ttf"),
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/tahoma.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf",
]

NAVY = colors.HexColor("#0b1f33")
GOLD = colors.HexColor("#b8892b")
MUTED = colors.HexColor("#5d6873")
LINE = colors.HexColor("#d5dbe1")
VERDICT_COLOR = {"safe": "#1f7a4d", "suspicious": "#b26a00", "fraud": "#b42318"}
VERDICT_AR = {"safe": "آمن", "suspicious": "مشبوه", "fraud": "احتيال"}
FIELD_NAMES = {
    "card_number": "Card number / رقم البطاقة",
    "card_expiry": "Card expiry / تاريخ الانتهاء",
    "cvv": "CVV / الرمز السري",
    "otp": "One-time code / رمز التحقق",
    "password": "Password / كلمة المرور",
    "emirates_id": "Emirates ID / الهوية الإماراتية",
    "iban": "IBAN / الآيبان",
}


def _register_font() -> str:
    for candidate in FONT_CANDIDATES:
        if candidate and Path(candidate).is_file():
            pdfmetrics.registerFont(TTFont("SaqrText", candidate))
            return "SaqrText"
    raise RuntimeError(
        "No font with Arabic glyphs was found. Download Noto Naskh Arabic into evidence/fonts/ "
        "or set SAQR_PDF_FONT to a .ttf file."
    )


ARABIC = re.compile("[؀-ۿ]")
FRAME_WIDTH = A4[0] - 36 * mm


def ar(text: str, base_dir: str = "R") -> str:
    """Shape and reorder one line of Arabic so it prints right-to-left with joined letters."""
    return get_display(arabic_reshaper.reshape(text), base_dir=base_dir)


def _visual(text: str, base_dir: str) -> str:
    return ar(text, base_dir) if ARABIC.search(text) else text


def _wrap_rtl(text: str, font: str, size: float, width: float) -> list[str]:
    """Wrap logical Arabic text into lines first, then reorder each line, so wrapped lines keep their order."""
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and pdfmetrics.stringWidth(ar(candidate), font, size) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return [ar(line) for line in lines]


def _fmt(value: datetime | str | None, tz=UTC) -> str:
    if not value:
        return "—"
    moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(tz).strftime("%Y-%m-%d %H:%M:%S ") + ("UTC" if tz is UTC else "GST (UTC+4)")


def _both(value: datetime | str | None) -> str:
    return f"{_fmt(value)} · {_fmt(value, GULF)}"


class _Styles:
    def __init__(self, font: str):
        base = {"fontName": font, "leading": 13, "fontSize": 9.5, "textColor": NAVY}
        self.body = ParagraphStyle("body", **base)
        self.small = ParagraphStyle("small", **{**base, "fontSize": 8, "leading": 10, "textColor": MUTED})
        self.mono = ParagraphStyle("mono", **{**base, "fontSize": 8, "leading": 10})
        self.ar = ParagraphStyle("ar", **{**base, "alignment": TA_RIGHT})
        self.ar_small = ParagraphStyle("ar_small", **{**base, "alignment": TA_RIGHT, "fontSize": 8, "textColor": MUTED})
        self.h1 = ParagraphStyle("h1", **{**base, "fontSize": 20, "leading": 24})
        self.h2 = ParagraphStyle("h2", **{**base, "fontSize": 12, "leading": 16, "textColor": GOLD, "spaceBefore": 10, "spaceAfter": 4})
        self.h2_ar = ParagraphStyle("h2_ar", parent=self.h2, alignment=TA_RIGHT)


def _p(text: object, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(_visual(str(text), "L")) if text not in (None, "") else "—", style)


def _ar(text: str, style: ParagraphStyle, width: float = FRAME_WIDTH) -> Paragraph:
    lines = _wrap_rtl(text, style.fontName, style.fontSize, width - 2)
    return Paragraph("<br/>".join(escape(line) for line in lines), style)


def _heading(en: str, ar_text: str, s: _Styles) -> Table:
    table = Table([[_p(en, s.h2), _ar(ar_text, s.h2_ar, FRAME_WIDTH / 2)]], colWidths=["50%", "50%"])
    table.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, 0), 0.8, GOLD), ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return table


def _kv(rows: list[tuple[str, object]], s: _Styles, mono: bool = False, label_width: float = 52 * mm) -> Table:
    data = [[_p(label, s.small), _p(value, s.mono if mono else s.body)] for label, value in rows]
    table = Table(data, colWidths=[label_width, None])
    table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -2), 0.3, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ])
    )
    return table


def _image(path: Path | None, width: float, height: float, s: _Styles, missing: str) -> object:
    if path and path.is_file():
        reader = ImageReader(str(path))
        w, h = reader.getSize()
        scale = min(width / w, height / h)
        return Image(str(path), width=w * scale, height=h * scale)
    box = Table([[_p(missing, s.small)]], colWidths=[width], rowHeights=[height])
    box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, LINE), ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f4f6f8"))]))
    return box


def _runtime_file(relative: str | None, runtime_dir: Path) -> Path | None:
    if not relative:
        return None
    path = (runtime_dir / relative).resolve()
    return path if runtime_dir.resolve() in path.parents and path.is_file() else None


def record_sha256(scan: ScanResult) -> str:
    """SHA-256 of the scan record as exported in evidence.json (canonical JSON, sorted keys)."""
    canonical = json.dumps(scan.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_evidence_pdf(
    scan: ScanResult,
    brand: Brand | None = None,
    runtime_dir: Path = RUNTIME_DIR,
    generated_at: datetime | None = None,
) -> bytes:
    """Render the evidence pack for one case and return the PDF bytes."""
    font = _register_font()
    s = _Styles(font)
    generated_at = generated_at or datetime.now(UTC)
    ev = scan.evidence
    product = BRAND_CONFIG["product_name_en"]
    record_hash = record_sha256(scan)
    brand_en = brand.name_en if brand else "—"
    brand_ar = brand.name_ar if brand else "—"
    verdict_color = colors.HexColor(VERDICT_COLOR[scan.verdict])
    story: list = []

    logo = SHARED_DIR / "logo" / "saqr-logo.png"
    title = Table(
        [[
            _image(logo, 16 * mm, 22 * mm, s, ""),
            [_p(f"{product} — Evidence Pack", s.h1), _p(f"Case {scan.id} · generated {_both(generated_at)}", s.small)],
            [_ar("ملف الأدلة — " + BRAND_CONFIG["product_name_ar"], ParagraphStyle("t_ar", parent=s.ar, fontSize=16, leading=22), 60 * mm), _ar("ملف أدلة ثنائي اللغة جاهز للشرطة", s.ar_small, 60 * mm)],
        ]],
        colWidths=[20 * mm, None, 62 * mm],
    )
    title.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, 0), 2, GOLD), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story += [title, Spacer(1, 6)]

    verdict_box = Table(
        [[
            [
                Paragraph(f'<font size="26" color="{VERDICT_COLOR[scan.verdict]}">{scan.score}</font>', ParagraphStyle("score", parent=s.body, leading=28)),
                _p("RISK SCORE", s.small),
                _ar("درجة الخطورة", s.ar_small, 26 * mm),
            ],
            [
                Paragraph(f'<font color="{VERDICT_COLOR[scan.verdict]}" size="13">{scan.verdict.upper()} · {escape(ar(VERDICT_AR[scan.verdict]))}</font>', s.body),
                _p(f"Impersonates: {brand_en}", s.body),
                _ar(f"ينتحل صفة: {brand_ar}", s.ar, 58 * mm),
            ],
            _kv([
                ("Domain", scan.registered_domain),
                ("Status", scan.status),
                ("Found by", scan.discovered_by),
                ("First seen", _fmt(scan.first_seen)),
            ], s, label_width=20 * mm),
        ]],
        colWidths=[30 * mm, 62 * mm, None],
    )
    verdict_box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1, verdict_color), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("LEFTPADDING", (0, 0), (-1, -1), 6)]))
    story += [verdict_box, Spacer(1, 6), _p(scan.summary_en, s.body), Spacer(1, 2), _ar(scan.summary_ar, s.ar)]

    story += [_heading("Addresses", "العناوين", s), _kv([("Input as received", scan.input.strip()), ("Normalized URL", scan.normalized_url), ("Final URL", scan.final_url)], s, mono=True)]

    similarity = ev.visual_similarity
    width = (A4[0] - 36 * mm) / 3 - 4
    shots = Table(
        [
            [
                _p("Desktop Chrome", s.small),
                _p("iPhone (ar-AE, Asia/Dubai)", s.small),
                _p(f"Official reference: {brand_en}" + (f" — {similarity.percent:.1f}% match" if similarity else ""), s.small),
            ],
            [
                _image(_runtime_file(ev.screenshot_desktop, runtime_dir), width, 48 * mm, s, "No screenshot captured"),
                _image(_runtime_file(ev.screenshot_mobile, runtime_dir), width, 48 * mm, s, "No screenshot captured"),
                _image(SHARED_DIR / "brand_assets" / (similarity.brand_id if similarity else scan.impersonated_brand or "") / "reference.png", width, 48 * mm, s, "No reference image"),
            ],
        ],
        colWidths=[width + 4] * 3,
    )
    shots.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story += [_heading("Screenshots and visual similarity", "لقطات الشاشة والتشابه البصري", s), shots]
    if ev.cloaking and ev.cloaking.detected:
        story.append(_p(f"Cloaking detected: {ev.cloaking.details}", ParagraphStyle("cloak", parent=s.body, textColor=verdict_color)))

    reason_rows = [[_p("Reason", s.small), _p("Weight", s.small), _ar("السبب", s.ar_small, 70 * mm)]]
    for reason in sorted(scan.reasons, key=lambda r: -r.weight):
        reason_rows.append([
            [_p(reason.en, s.body), _p(f"{reason.code} · {reason.evidence or ''}", s.small)],
            _p(f"{reason.weight:+d}" if reason.weight else "0", s.body),
            _ar(reason.ar, s.ar, 66 * mm),
        ])
    reasons = Table(reason_rows, colWidths=[None, 16 * mm, 70 * mm], repeatRows=1)
    reasons.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f6f8"))]))
    story += [_heading("Why the case was flagged", "أسباب الرصد", s), reasons]

    chain = ev.redirect_chain or ["—"]
    story += [_heading("Redirect chain", "سلسلة التحويل", s), _kv([(f"Step {i + 1}", url) for i, url in enumerate(chain)], s, mono=True)]

    rdap, dns, hosting, tls = ev.rdap, ev.dns, ev.hosting, ev.tls
    infra = _kv([
        ("Registrar", rdap.registrar if rdap else None),
        ("Registered", _fmt(rdap.created) if rdap else None),
        ("Expires", _fmt(rdap.expires) if rdap else None),
        ("Registrar abuse contact", rdap.abuse_email if rdap else None),
        ("Name servers", ", ".join(rdap.nameservers) if rdap and rdap.nameservers else None),
        ("DNS A / MX / NS", " | ".join([", ".join(dns.a) or "—", ", ".join(dns.mx) or "—", ", ".join(dns.ns) or "—"]) if dns else None),
        ("Hosting IP / ASN", f"{hosting.ip or '—'} / AS{hosting.asn}" if hosting and hosting.asn else (hosting.ip if hosting else None)),
        ("Hosting provider, country", f"{hosting.org or '—'}, {hosting.country or '—'}" if hosting else None),
        ("TLS issuer", tls.issuer if tls else None),
        ("TLS valid from", _fmt(tls.not_before) if tls else None),
        ("First seen in CT logs", _fmt(tls.first_seen_crtsh) if tls else None),
    ], s)
    story += [_heading("Registration, DNS, hosting and TLS", "التسجيل والاستضافة والشهادة", s), infra]

    asks = sorted({kind for form in ev.forms for kind in form.asks_for})
    story += [
        _heading("Indicators found on the page", "المؤشرات في الصفحة", s),
        _kv([
            ("Phone numbers (E.164)", ", ".join(ev.phones_found) or None),
            ("Email addresses", ", ".join(ev.emails_found) or None),
            ("Data the page asks for", ", ".join(FIELD_NAMES.get(k, k) for k in asks) or None),
            ("Form destinations", ", ".join(f.action for f in ev.forms if f.action) or None),
        ], s),
    ]

    story += [
        _heading("Integrity and chain of custody", "سلامة الأدلة وسلسلة الحيازة", s),
        _kv([
            ("Scanned at", _both(scan.scanned_at)),
            ("First seen", _both(scan.first_seen)),
            ("Page HTML SHA-256", ev.html_sha256),
            ("Screenshot SHA-256", ev.screenshot_sha256),
            ("Case record SHA-256", record_hash),
            ("Favicon perceptual hash", ev.favicon_phash),
        ], s, mono=True),
        Spacer(1, 4),
    ]
    story += [KeepTogether([
        _p(
            f"Chain of custody: collected automatically by {product} at {_fmt(scan.scanned_at)} from public sources only. "
            f"The case record hash is computed over the evidence.json export (canonical JSON, sorted keys) and identifies "
            f"exactly the data in this document. Pack generated {_fmt(generated_at)}.",
            s.small,
        ),
        _ar("سلسلة الحيازة: جُمعت الأدلة آلياً من مصادر عامة فقط، وتحدد البصمة الرقمية لسجل الحالة البيانات الواردة في هذا المستند بدقة.", s.ar_small),
    ])]

    story += [PageBreak()] + _takedown_letter(scan, brand, record_hash, generated_at, s)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"{product} evidence pack {scan.id}",
        author=product,
        subject=scan.registered_domain,
    )

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont(font, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 9 * mm, f"{product} · {scan.id} · record SHA-256 {record_hash[:16]}…")
        canvas.drawRightString(A4[0] - 18 * mm, 9 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def _takedown_letter(scan: ScanResult, brand: Brand | None, record_hash: str, generated_at: datetime, s: _Styles) -> list:
    ev = scan.evidence
    registrar = ev.rdap.registrar if ev.rdap and ev.rdap.registrar else "the domain registrar"
    abuse = ev.rdap.abuse_email if ev.rdap and ev.rdap.abuse_email else "abuse contact not published in RDAP"
    host = ev.hosting.org if ev.hosting and ev.hosting.org else "the hosting provider"
    ip = ev.hosting.ip if ev.hosting and ev.hosting.ip else "—"
    brand_en = brand.name_en if brand else "a UAE institution"
    brand_ar = brand.name_ar if brand else "جهة إماراتية"
    official = ", ".join(brand.official_domains) if brand else "—"
    top = [r for r in sorted(scan.reasons, key=lambda r: -r.weight) if r.weight > 0][:5]
    letter = ParagraphStyle("letter", parent=s.body, fontSize=10, leading=15, spaceAfter=6)
    letter_ar = ParagraphStyle("letter_ar", parent=s.ar, fontSize=10.5, leading=17, spaceAfter=6)

    parts: list = [
        _heading("Takedown request", "طلب إزالة", s),
        _p(f"Date: {_fmt(generated_at)}", s.small),
        _p(f"To: {registrar} <{abuse}>; {host} (IP {ip})", letter),
        _p(f"Subject: Fraudulent website impersonating {brand_en} — {scan.registered_domain} (case {scan.id})", letter),
        _p(
            f"We request the urgent suspension of the domain {scan.registered_domain} and the content served at "
            f"{scan.final_url or scan.normalized_url}. The site impersonates {brand_en}, whose only official domains are "
            f"{official}, and scored {scan.score}/100 ({scan.verdict}) in an automated analysis of publicly accessible content.",
            letter,
        ),
        _p("Main findings:", letter),
    ]
    parts += [_p(f"• {r.en}" + (f" ({r.evidence})" if r.evidence else ""), letter) for r in top]
    parts += [
        _p(
            f"The evidence is attached as case {scan.id}. Case record SHA-256: {record_hash}. "
            f"Page HTML SHA-256: {ev.html_sha256 or '—'}. Screenshot SHA-256: {ev.screenshot_sha256 or '—'}. "
            f"First observed {_fmt(scan.first_seen)}; last scanned {_fmt(scan.scanned_at)}.",
            letter,
        ),
        _p("Please preserve all associated records (registration, payment and access logs) for law-enforcement requests.", letter),
        Spacer(1, 10),
        _ar(f"الموضوع: موقع احتيالي ينتحل صفة {brand_ar}", letter_ar),
        _p(f"{scan.registered_domain} · {scan.id}", ParagraphStyle("ids", parent=s.mono, alignment=TA_RIGHT, spaceAfter=6)),
        _ar(
            f"نطلب التعليق العاجل للنطاق المذكور أعلاه والمحتوى المستضاف عليه، إذ ينتحل صفة {brand_ar}، "
            f"وقد حصل على درجة خطورة {scan.score} من 100 في تحليل آلي لمحتوى متاح للعامة.",
            letter_ar,
        ),
    ]
    parts += [_ar(f"• {r.ar}", letter_ar) for r in top]
    parts += [
        _ar("الأدلة مرفقة مع البصمات الرقمية المذكورة أعلاه. يُرجى الاحتفاظ بجميع السجلات المرتبطة لطلبات جهات إنفاذ القانون.", letter_ar),
        Spacer(1, 14),
        KeepTogether([_p("Submitted on behalf of the investigating unit, using evidence collected by SAQR.", s.small)]),
    ]
    return parts


def _fixtures() -> list[ScanResult]:
    return [ScanResult.model_validate(item) for item in json.loads(FIXTURES.read_text(encoding="utf-8"))]


def _brands() -> dict[str, Brand]:
    raw = json.loads((SHARED_DIR / "brands.json").read_text(encoding="utf-8"))
    return {b.id: b for b in (Brand.model_validate(item) for item in raw)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build evidence PDFs from the fixture ScanResults.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--fixture", help="case ID from data/fixtures/sample_scans.json")
    group.add_argument("--all-fixtures", action="store_true")
    parser.add_argument("--output", type=Path, help="output file for --fixture")
    parser.add_argument("--output-dir", type=Path, default=RUNTIME_DIR / "evidence")
    args = parser.parse_args()

    brands = _brands()
    scans = _fixtures() if args.all_fixtures else [s for s in _fixtures() if s.id == args.fixture]
    if not scans:
        parser.error(f"No fixture with ID {args.fixture}")
    for scan in scans:
        target = args.output if args.fixture and args.output else args.output_dir / f"{scan.id}-evidence.pdf"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(build_evidence_pdf(scan, brands.get(scan.impersonated_brand or "")))
        print(f"wrote {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
