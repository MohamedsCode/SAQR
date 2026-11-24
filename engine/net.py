"""Network lookups for Layer A: RDAP, DNS, certificate transparency, IP to ASN, and the HTTP redirect chain.

Every lookup has its own timeout, never raises, and is cached in SQLite.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from datetime import datetime, timedelta, timezone

import dns.asyncresolver
import dns.exception
import dns.resolver
import httpx

from engine.db import cache_get, cache_set
from shared.contract import Dns, Hosting, Rdap, Tls

DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
HTTP_TIMEOUT = httpx.Timeout(6.0, connect=4.0)
MAX_REDIRECTS = 10
_rdap_limit = asyncio.Semaphore(8)
_crtsh_limit = asyncio.Semaphore(2)


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _vcard_value(entity: dict, field: str) -> str | None:
    for item in (entity.get("vcardArray") or [None, []])[1]:
        if item and item[0] == field:
            return item[3] if isinstance(item[3], str) else None
    return None


async def rdap(domain: str) -> tuple[Rdap | None, bool]:
    """Return (RDAP record, domain_exists). domain_exists is False only when the registry says 404."""
    key = f"rdap:{domain}"
    cached = cache_get(key)
    if cached is not None:
        return (Rdap.model_validate(cached["rdap"]) if cached["rdap"] else None), cached["exists"]
    try:
        async with _rdap_limit, httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(f"https://rdap.org/domain/{domain}",
                                        headers={"Accept": "application/rdap+json"})
    except httpx.HTTPError:
        return None, True
    if response.status_code == 404 and response.url.host == "rdap.org":
        # rdap.org answers 404 itself when the TLD has no RDAP server (.ae, .de, .io...): unknown, not unregistered
        cache_set(key, {"rdap": None, "exists": True}, timedelta(days=1))
        return None, True
    if response.status_code == 404:
        cache_set(key, {"rdap": None, "exists": False}, timedelta(hours=6))
        return None, False
    if response.status_code != 200:
        return None, True
    try:
        data = response.json()
    except ValueError:
        return None, True
    events = {e.get("eventAction"): e.get("eventDate") for e in data.get("events", [])}
    registrar = abuse = None
    for entity in data.get("entities", []):
        if "registrar" in entity.get("roles", []):
            registrar = _vcard_value(entity, "fn")
            for sub in entity.get("entities", []):
                if "abuse" in sub.get("roles", []):
                    abuse = _vcard_value(sub, "email")
        elif "abuse" in entity.get("roles", []) and not abuse:
            abuse = _vcard_value(entity, "email")
    record = Rdap(
        registrar=registrar,
        created=_parse_time(events.get("registration")),
        expires=_parse_time(events.get("expiration")),
        abuse_email=abuse,
        nameservers=sorted(ns.get("ldhName", "").lower() for ns in data.get("nameservers", []) if ns.get("ldhName")),
    )
    cache_set(key, {"rdap": record.model_dump(mode="json"), "exists": True}, timedelta(days=1))
    return record, True


_resolver = dns.asyncresolver.Resolver()
_resolver.timeout = 0.8
_resolver.lifetime = 3.0


async def _resolve(name: str, rtype: str) -> list[str] | None:
    """Records as text; [] when there are none or the lookup failed; None on NXDOMAIN.

    Windows often lists stale DNS servers first, so whichever server answers moves to the front.
    """
    try:
        answer = await _resolver.resolve(name, rtype)
    except dns.resolver.NXDOMAIN:
        return None
    except dns.exception.DNSException:
        return []
    server = getattr(answer, "nameserver", None)
    if server in _resolver.nameservers and _resolver.nameservers[0] != server:
        _resolver.nameservers = [server] + [n for n in _resolver.nameservers if n != server]
    return sorted(r.to_text().strip('"').rstrip(".").lower() for r in answer)


async def domain_exists(domain: str) -> bool:
    """True when the registered domain has name servers, i.e. someone has registered and delegated it."""
    try:
        name = domain.encode("idna").decode("ascii")
    except UnicodeError:
        return False
    return bool(await _resolve(name, "NS"))


async def _addresses(host: str) -> list[str] | None:
    """A/AAAA through the operating system resolver; None when the name does not exist."""
    try:
        infos = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, None), 3.0)
    except socket.gaierror as exc:
        return None if exc.errno in (socket.EAI_NONAME, getattr(socket, "EAI_NODATA", -5)) else []
    except (OSError, asyncio.TimeoutError):
        return []
    return sorted({info[4][0] for info in infos})


async def dns_records(host: str, registered_domain: str) -> tuple[Dns, bool | None]:
    """Return (records, resolves). resolves is False only when the host definitely does not exist."""
    key = f"dns:{host}"
    cached = cache_get(key)
    if cached is not None:
        return Dns.model_validate(cached["dns"]), cached["resolves"]
    addresses, mx, ns = await asyncio.gather(
        _addresses(host), _resolve(registered_domain, "MX"), _resolve(registered_domain, "NS"),
    )
    records = Dns(a=addresses or [], mx=[m.split(" ")[-1] for m in (mx or [])], ns=ns or [])
    resolves = None if addresses == [] else addresses is not None
    if resolves is not None:
        cache_set(key, {"dns": records.model_dump(), "resolves": resolves}, timedelta(hours=1))
    return records, resolves


async def hosting(ip: str) -> Hosting:
    """IP -> ASN and organisation through Team Cymru's DNS service (no API key needed)."""
    key = f"asn:{ip}"
    cached = cache_get(key)
    if cached is not None:
        return Hosting.model_validate(cached)
    info = Hosting(ip=ip)
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return info
    if address.is_private or address.is_loopback:
        return info
    zone = "origin.asn.cymru.com" if address.version == 4 else "origin6.asn.cymru.com"
    reversed_ip = ".".join(reversed(ip.split("."))) if address.version == 4 else \
        ".".join(reversed(address.exploded.replace(":", "")))
    origin = await _resolve(f"{reversed_ip}.{zone}", "TXT")
    if origin:
        parts = [p.strip() for p in origin[0].split("|")]
        if parts and parts[0].split(" ")[0].isdigit():
            info.asn = int(parts[0].split(" ")[0])
            info.country = parts[2].upper() if len(parts) > 2 and parts[2] else None
            names = await _resolve(f"AS{info.asn}.asn.cymru.com", "TXT")
            if names:
                info.org = names[0].split("|")[-1].strip().upper() or None
    cache_set(key, info.model_dump(), timedelta(days=7))
    return info


async def first_certificate(domain: str) -> Tls | None:
    """Earliest certificate logged for the domain in crt.sh, and the issuer of the latest one."""
    key = f"crtsh:{domain}"
    cached = cache_get(key)
    if cached is not None:
        return Tls.model_validate(cached) if cached else None
    try:
        async with _crtsh_limit, httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=3.0)) as client:
            response = await client.get("https://crt.sh/", params={"q": domain, "output": "json"})
        entries = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None
    if not entries:
        cache_set(key, {}, timedelta(hours=6))
        return None
    entries.sort(key=lambda e: e.get("entry_timestamp") or "")
    latest = entries[-1]
    issuer = latest.get("issuer_name", "")
    organisation = next((p.split("=", 1)[1] for p in issuer.split(", ") if p.startswith("O=")), issuer)
    tls = Tls(
        issuer=organisation or None,
        not_before=_parse_time(latest.get("not_before")),
        first_seen_crtsh=_parse_time(entries[0].get("entry_timestamp")),
    )
    cache_set(key, tls.model_dump(mode="json"), timedelta(hours=12))
    return tls


async def is_public_host(host: str, allow_localhost: bool = False) -> bool:
    """False for hosts that resolve to private, loopback or link-local addresses (blocks SSRF)."""
    if allow_localhost and (host == "localhost" or host.endswith(".localhost")):
        return True
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    except OSError:
        return True  # unresolvable: the request itself will fail harmlessly
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
            return False
    return True


async def redirect_chain(url: str, allow_localhost: bool = False) -> tuple[list[str], int | None, str | None]:
    """Follow HTTP redirects by hand, checking every hop. Returns (chain, final status code, error)."""
    chain = [url]
    headers = {"User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9,ar;q=0.8"}
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=False, verify=False) as client:
            current = url
            for _ in range(MAX_REDIRECTS):
                if httpx.URL(current).scheme not in ("http", "https"):
                    return chain, None, "NonWebRedirect"
                if not await is_public_host(httpx.URL(current).host, allow_localhost):
                    return chain, None, "BlockedPrivateAddress"
                response = await client.get(current, headers=headers)
                location = response.headers.get("location")
                if response.is_redirect and location:
                    current = str(response.url.join(location))
                    chain.append(current)
                    continue
                return chain, response.status_code, None
    except httpx.HTTPError as exc:
        if url.startswith("https://") and len(chain) == 1:
            fallback, status, _ = await redirect_chain("http://" + url.removeprefix("https://"), allow_localhost)
            if status is not None:
                return fallback, status, None
        return chain, None, type(exc).__name__
    return chain, None, "TooManyRedirects"
