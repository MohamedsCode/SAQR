"""FastAPI application. Every endpoint lives under /api."""

from __future__ import annotations

import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from discovery.routes import router as discovery_router
from engine.routes.demo import router as demo_router
from engine.routes.phone import router as phone_router
from engine.routes.scans import router as scans_router
from engine.routes.stats import router as stats_router
from engine.settings import SHARED_DIR, settings
from engine.store import store
from shared.contract import Brand

BRAND_CONFIG = json.loads((SHARED_DIR / "brand_config.json").read_text(encoding="utf-8"))

app = FastAPI(
    title=f"{BRAND_CONFIG['product_name_en']} API",
    description=BRAND_CONFIG["tagline_en"],
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (scans_router, phone_router, stats_router, demo_router, discovery_router):
    app.include_router(router, prefix="/api")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "product": BRAND_CONFIG["product_name_en"]}


@app.get("/api/brands", response_model=list[Brand])
def brands() -> list[Brand]:
    return list(store.brands.values())
