"""Scan, batch, case and report endpoints."""

from __future__ import annotations

import csv
import io
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from starlette.datastructures import UploadFile

from engine.store import store
from shared.contract import BatchRequest, Job, Report, ReportRequest, ScanRequest, ScanResult

router = APIRouter()

CSV_COLUMNS = [
    "id", "input", "registered_domain", "status", "score", "verdict",
    "impersonated_brand", "category", "discovered_by", "scanned_at", "top_reasons",
]


def _get_scan(scan_id: str) -> ScanResult:
    scan = store.scans.get(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan


def _get_job(job_id: str) -> Job:
    job = store.jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _inputs_from_upload(content: str) -> list[str]:
    rows = list(csv.reader(io.StringIO(content)))
    if rows and rows[0] and rows[0][0].strip().lower() in {"url", "input"}:
        rows = rows[1:]
    return [row[0].strip() for row in rows if row and row[0].strip()]


@router.post("/scan", response_model=ScanResult)
def scan(request: ScanRequest) -> ScanResult:
    result = store.find_scan(request.input)
    if not result:
        raise HTTPException(
            status_code=501,
            detail="Live scanning is not available yet; only fixture inputs are recognised.",
        )
    return result


@router.post("/scan/batch", response_model=Job)
async def scan_batch(request: Request) -> Job:
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(status_code=422, detail="Upload a CSV or TXT file in the 'file' field.")
        inputs = _inputs_from_upload((await upload.read()).decode("utf-8-sig", errors="replace"))
    else:
        inputs = BatchRequest.model_validate(await request.json()).inputs
    if not inputs:
        raise HTTPException(status_code=422, detail="No inputs found.")
    return store.add_job(inputs)


@router.get("/jobs/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    return _get_job(job_id)


@router.get("/jobs/{job_id}/export.json")
def export_job_json(job_id: str) -> Response:
    job = _get_job(job_id)
    results = [store.scans[i].model_dump(mode="json") for i in job.result_ids]
    body = json.dumps({"job": job.model_dump(mode="json"), "results": results}, ensure_ascii=False, indent=2)
    return Response(
        body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="job-{job.id}.json"'},
    )


@router.get("/jobs/{job_id}/export.csv")
def export_job_csv(job_id: str) -> Response:
    job = _get_job(job_id)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    for scan_id in job.result_ids:
        scan = store.scans[scan_id]
        row = scan.model_dump(mode="json", include=set(CSV_COLUMNS))
        row["top_reasons"] = "; ".join(r.code for r in sorted(scan.reasons, key=lambda r: -r.weight)[:3])
        writer.writerow(row)
    return Response(
        "﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="job-{job.id}.csv"'},
    )


@router.get("/scans", response_model=list[ScanResult])
def list_scans(verdict: str | None = None, brand: str | None = None) -> list[ScanResult]:
    scans = sorted(store.scans.values(), key=lambda s: s.scanned_at, reverse=True)
    if verdict:
        scans = [s for s in scans if s.verdict == verdict]
    if brand:
        scans = [s for s in scans if s.impersonated_brand == brand]
    return scans


@router.get("/scans/{scan_id}", response_model=ScanResult)
def get_scan(scan_id: str) -> ScanResult:
    return _get_scan(scan_id)


@router.get("/scans/{scan_id}/evidence.json")
def evidence_json(scan_id: str) -> Response:
    scan = _get_scan(scan_id)
    body = json.dumps(scan.model_dump(mode="json"), ensure_ascii=False, indent=2)
    return Response(
        body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{scan.id}-evidence.json"'},
    )


@router.get("/scans/{scan_id}/evidence.pdf")
def evidence_pdf(scan_id: str) -> Response:
    _get_scan(scan_id)
    raise HTTPException(status_code=501, detail="The PDF evidence pack is not available yet.")


@router.post("/report", response_model=Report)
def report(request: ReportRequest) -> Report:
    return store.add_report(request.input, request.type)
