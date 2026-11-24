"""Serve only the citizen checker and its API on the tunnel's local port."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from engine.app import brands, health
from engine.browser import pool
from engine.routes.scans import check, report
from shared.contract import ScanRequest, ScanResult

DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
scan_slots = asyncio.Semaphore(2)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not (DIST / "index.html").is_file():
        raise RuntimeError("Build the frontend with npm run build first")
    yield
    await pool.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
app.add_api_route("/api/health", health, methods=["GET"])
app.add_api_route("/api/brands", brands, methods=["GET"])
app.add_api_route("/api/report", report, methods=["POST"])


@app.post("/api/check", response_model=ScanResult)
async def public_check(request: ScanRequest) -> ScanResult:
    if scan_slots.locked():
        raise HTTPException(429, "Saqr is busy. Try again in a moment.")
    async with scan_slots:
        return await check(request)


@app.get("/")
def home():
    return RedirectResponse("/check")


@app.get("/check")
def checker():
    return FileResponse(DIST / "index.html")


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(DIST / "manifest.webmanifest", media_type="application/manifest+json")
