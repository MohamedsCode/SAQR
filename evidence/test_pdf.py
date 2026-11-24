import json
from pathlib import Path

import pytest

from evidence.pdf import FIXTURES, _brands, _wrap_rtl, ar, build_evidence_pdf, record_sha256
from shared.contract import ScanResult

SCANS = [ScanResult.model_validate(item) for item in json.loads(Path(FIXTURES).read_text(encoding="utf-8"))]
BRANDS = _brands()


@pytest.mark.parametrize("scan", SCANS, ids=[s.id for s in SCANS])
def test_every_fixture_renders_a_pdf(scan, tmp_path):
    pdf = build_evidence_pdf(scan, BRANDS.get(scan.impersonated_brand or ""), runtime_dir=tmp_path)
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 5_000


def test_record_hash_is_stable_and_changes_with_the_record():
    scan = SCANS[4]
    assert record_sha256(scan) == record_sha256(scan.model_copy(deep=True))
    assert record_sha256(scan) != record_sha256(scan.model_copy(update={"score": scan.score - 1}))


def test_arabic_is_shaped_and_reordered():
    shaped = ar("رقم البطاقة")
    assert shaped != "رقم البطاقة"
    assert all("؀" > ch or ch > "ۿ" for ch in shaped.replace(" ", ""))


def test_wrapped_arabic_keeps_line_order():
    text = "الأولى الثانية الثالثة الرابعة الخامسة السادسة"
    lines = _wrap_rtl(text, "Helvetica", 10, 60)
    assert len(lines) > 1
    assert ar("الأولى") in lines[0]
    assert ar("السادسة") in lines[-1]
