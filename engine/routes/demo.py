"""Demo mode controls."""

from __future__ import annotations

from fastapi import APIRouter

from engine.store import store

router = APIRouter()


@router.post("/demo/reset")
def demo_reset() -> dict[str, int | bool]:
    store.reset()
    return {"ok": True, "scans": len(store.scans)}
