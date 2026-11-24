"""Maps and search helpline sweep: find listings that claim a brand but publish a number it does not own.

Providers, in order: Google Places Text Search (GOOGLE_PLACES_API_KEY), SerpAPI Google Maps (SERPAPI_KEY), and
otherwise data/fixtures/maps_results.json, labelled as simulated data.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone

import httpx
import phonenumbers

from engine.brands import brands, official_brand_for_host
from engine.layer_a import find_brand
from engine.normalize import InvalidInput, normalize
from engine.settings import FIXTURES_DIR, settings
from shared.contract import MapsListing, MapsSweep, PhoneStatus

QUERIES = ["{en} customer service number", "{en} helpline Abu Dhabi", "رقم خدمة عملاء {ar}"]
HTTP_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
PLACES_FIELDS = "places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri"


def e164(raw: str) -> str | None:
    """E.164 form of a UAE number, or the bare digits of a short code such as 999."""
    digits = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
    if digits.isdigit() and len(digits) <= 5:
        return digits
    try:
        parsed = phonenumbers.parse(digits, "AE")
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_possible_number(parsed):
        return None
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def official_numbers() -> dict[str, str]:
    """Verified official number -> brand id. Unverified numbers never count as official."""
    numbers = {}
    for brand in brands().values():
        for phone in brand.official_phones:
            number = e164(phone.number)
            if phone.verified and number:
                numbers[number] = brand.id
    return numbers


def classify(name: str, url: str | None, phones: list[str], query_brand: str) -> tuple[PhoneStatus, str]:
    """official: a number is in the verified registry. fake_listing: the listing claims a brand, publishes numbers
    none of which are official, and does not link to an official site (real branches usually do)."""
    registry = official_numbers()
    for number in phones:
        if number in registry:
            return "official", registry[number]
    claimed = find_brand(name)
    if not claimed or not phones:
        return "unknown", claimed[0].brand.id if claimed else query_brand
    if url:
        try:
            if official_brand_for_host(normalize(url).host):
                return "unknown", claimed[0].brand.id
        except InvalidInput:
            pass
    return "fake_listing", claimed[0].brand.id


def _listing(query_brand: str, query: str, name: str, address: str | None, url: str | None, raw_phones: list[str],
             source: str, simulated: bool, seen_at: datetime) -> MapsListing:
    phones = sorted({p for p in (e164(r) for r in raw_phones if r) if p})
    status, brand_id = classify(name, url, phones, query_brand)
    digest = hashlib.sha256(f"{name}|{address}|{','.join(phones)}".encode()).hexdigest()[:8].upper()
    return MapsListing(id=f"ML-{digest}", brand_id=brand_id, query=query, name=name, address=address, url=url,
                       phones=phones, phone_status=status, source=source, simulated=simulated, seen_at=seen_at)


def fixture_sweep() -> MapsSweep:
    now = datetime.now(timezone.utc)
    raw = json.loads((FIXTURES_DIR / "maps_results.json").read_text(encoding="utf-8"))
    listings = [_listing(item["brand_id"], item["query"], item["name"], item.get("address"), item.get("url"),
                         item.get("phones", []), "fixture", True, now) for item in raw]
    return MapsSweep(simulated=True, ran_at=now, listings=listings)


async def _google_places(client: httpx.AsyncClient, query: str) -> list[dict]:
    response = await client.post(
        "https://places.googleapis.com/v1/places:searchText",
        headers={"X-Goog-Api-Key": settings.google_places_api_key, "X-Goog-FieldMask": PLACES_FIELDS},
        json={"textQuery": query, "regionCode": "AE"},
    )
    response.raise_for_status()
    return [{"name": (p.get("displayName") or {}).get("text", ""), "address": p.get("formattedAddress"),
             "url": p.get("websiteUri"), "phones": [p.get("internationalPhoneNumber", "")]}
            for p in response.json().get("places", [])]


async def _serpapi(client: httpx.AsyncClient, query: str) -> list[dict]:
    response = await client.get("https://serpapi.com/search.json", params={
        "engine": "google_maps", "q": query, "type": "search", "gl": "ae", "api_key": settings.serpapi_key,
    })
    response.raise_for_status()
    return [{"name": r.get("title", ""), "address": r.get("address"), "url": r.get("website"),
             "phones": [r.get("phone", "")]}
            for r in response.json().get("local_results", [])]


async def live_sweep() -> MapsSweep | None:
    """Query the first configured provider for every brand; None when no provider key is set."""
    if settings.google_places_api_key:
        provider, source = _google_places, "google_places"
    elif settings.serpapi_key:
        provider, source = _serpapi, "serpapi"
    else:
        return None
    now = datetime.now(timezone.utc)
    jobs = [(b.id, q.format(en=b.name_en, ar=b.name_ar)) for b in brands().values() for q in QUERIES]
    limit = asyncio.Semaphore(4)

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        async def one(brand_id: str, query: str) -> list[MapsListing]:
            async with limit:
                try:
                    places = await provider(client, query)
                except (httpx.HTTPError, ValueError):
                    return []
            return [_listing(brand_id, query, p["name"], p["address"], p["url"], p["phones"], source, False, now)
                    for p in places if p["name"]]

        batches = await asyncio.gather(*(one(b, q) for b, q in jobs))
    unique = {listing.id: listing for batch in batches for listing in batch}
    return MapsSweep(simulated=False, ran_at=now, listings=sorted(unique.values(), key=lambda l: l.id))
