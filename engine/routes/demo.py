"""Demo mode controls, and the relay that links the dashboard's demo buttons to the phone simulator."""

from __future__ import annotations

import threading
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from engine.store import store

router = APIRouter()


@router.post("/demo/reset")
def demo_reset() -> dict[str, int | bool]:
    store.reset()
    return {"ok": True, "scans": len(store.scans)}


class DemoEvent(BaseModel):
    type: Literal["trigger", "reset", "call_answered", "call_ended", "blocked"]
    scan_id: str | None = Field(default=None, max_length=64)
    call_at: str | None = Field(default=None, max_length=40)


KEEP_EVENTS = 50
_lock = threading.Lock()
_events: list[dict] = []
_seq = 0


@router.post("/demo-bus/emit")
def demo_bus_emit(event: DemoEvent) -> dict[str, int]:
    """Send a demo event to every open dashboard and phone simulator."""
    global _seq
    with _lock:
        _seq += 1
        payload = event.model_dump(exclude_none=event.type != "blocked")
        _events.append({"seq": _seq, **payload, "at": datetime.now(UTC).isoformat()})
        del _events[:-KEEP_EVENTS]
        return {"seq": _seq}


@router.get("/demo-bus/events")
def demo_bus_events(after: int = -1) -> dict:
    """Events newer than `after`. Pages poll this; the first call (after=-1) only returns the current position."""
    with _lock:
        if after < 0 or after > _seq:  # first poll, or the server restarted since the last one
            return {"seq": _seq, "events": []}
        return {"seq": _seq, "events": [e for e in _events if e["seq"] > after]}
