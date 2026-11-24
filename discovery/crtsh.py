"""Certificate transparency lookups on crt.sh for discovery and campaign expansion."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx

from engine.db import cache_get, cache_set
from engine.normalize import InvalidInput, normalize

CRTSH_TIMEOUT = httpx.Timeout(25.0, connect=5.0)


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def _entries(query: str) -> list[dict]:
    key = f"crtsh-search:{query}"
    cached = cache_get(key)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=CRTSH_TIMEOUT) as client:
            response = await client.get("https://crt.sh/", params={"q": query, "output": "json", "exclude": "expired"})
        entries = response.json() if response.status_code == 200 else []
    except (httpx.HTTPError, ValueError):
        return []
    slim = [{"name_value": e.get("name_value", ""), "entry_timestamp": e.get("entry_timestamp")} for e in entries]
    cache_set(key, slim, timedelta(minutes=30))
    return slim


def _registered_domains(name_value: str) -> set[str]:
    domains = set()
    for name in name_value.splitlines():
        name = name.strip().lower().removeprefix("*.")
        if not name or "@" in name:
            continue
        try:
            domains.add(normalize(name).registered_domain)
        except InvalidInput:
            continue
    return domains


async def recent_domains(keyword: str, days: int = 30) -> dict[str, datetime]:
    """Registered domains with a certificate naming the keyword logged in the last `days`, with first log time."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    found: dict[str, datetime] = {}
    for entry in await _entries(f"%{keyword}%"):
        logged = _parse(entry["entry_timestamp"])
        if not logged or logged < since:
            continue
        for domain in _registered_domains(entry["name_value"]):
            if keyword in domain:
                found[domain] = min(found.get(domain, logged), logged)
    return found


async def certificate_siblings(domain: str) -> set[str]:
    """Other registered domains named on the same certificates as this domain."""
    siblings: set[str] = set()
    for entry in await _entries(domain):
        names = _registered_domains(entry["name_value"])
        if domain in names:
            siblings |= names
    siblings.discard(domain)
    return siblings
