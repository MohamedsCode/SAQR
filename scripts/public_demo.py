"""Serve the whole SAQR API and the built website on the tunnel's local port, for the public demo.

Temporarily open to anyone (citizen checker and police dashboard). At most two scans run at once, and resetting
the demo or retraining the model is blocked.
"""

import asyncio
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from engine.app import app

DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
SCAN_PATHS = {"/api/check", "/api/scan"}
BLOCKED = {"/api/demo/reset", "/api/model/retrain"}  # would wipe the cases or retrain the model for everyone
scan_slots = asyncio.Semaphore(2)

if not (DIST / "index.html").is_file():
    raise RuntimeError("Build the frontend with npm run build first")


@app.middleware("http")
async def limit_scans(request: Request, call_next):
    if request.method == "POST" and request.url.path in BLOCKED:
        return JSONResponse({"detail": "This action is turned off in the public demo."}, status_code=403)
    if request.method == "POST" and request.url.path in SCAN_PATHS:
        if scan_slots.locked():
            return JSONResponse({"detail": "Saqr is busy. Try again in a moment."}, status_code=429)
        async with scan_slots:
            return await call_next(request)
    return await call_next(request)


@app.get("/{path:path}", include_in_schema=False)
def website(path: str):
    """Built files as they are; every other page path gets the single-page app."""
    if path.startswith("api/"):
        raise HTTPException(status_code=404)
    file = (DIST / path).resolve()
    if path and file.is_file() and DIST.resolve() in file.parents:
        return FileResponse(file)
    return FileResponse(DIST / "index.html")
