"""Private phone lookup using k-anonymity: the client sends only a 5-hex-character hash prefix."""

from __future__ import annotations

from fastapi import APIRouter

from engine.store import store
from shared.contract import PhoneCheckRequest, PhoneMatch

router = APIRouter()


@router.post("/phone/check", response_model=list[PhoneMatch])
def phone_check(request: PhoneCheckRequest) -> list[PhoneMatch]:
    return store.phone_matches(request.hash_prefix)
