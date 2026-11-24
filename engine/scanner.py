"""Scan one input end to end: normalize, URL signals, network lookups, score, summarise."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Awaitable
from datetime import datetime, timezone
from typing import Literal

from engine import llm, net
from engine.brands import brands
from engine.layer_a import LayerAResult, analyse
from engine.normalize import NormalizedUrl, normalize
from engine.reasons import Signal
from engine.scoring import category_for, score_signals, template_summary
from engine.settings import SHARED_DIR, settings
from shared.contract import DiscoveredBy, Evidence, ScanResult, Status

Mode = Literal["url", "network"]
CASE_PREFIX = json.loads((SHARED_DIR / "brand_config.json").read_text(encoding="utf-8"))["case_id_prefix"]
IMPERSONATION = {"BRAND_IN_DOMAIN", "BRAND_IN_SUBDOMAIN", "OFFICIAL_DOMAIN_IN_HOST", "LOOKALIKE_CHAR_SWAP",
                 "LOOKALIKE_EDIT_DISTANCE", "HOMOGLYPH_BRAND", "BRAND_IN_PATH"}


def new_case_id(now: datetime) -> str:
    return f"{CASE_PREFIX}-{now:%Y%m%d}-{uuid.uuid4().hex[:6].upper()}"


def default_mode() -> Mode:
    return "network" if settings.network_enabled else "url"


def _is_demo_host(url: NormalizedUrl) -> bool:
    return settings.allow_localhost_demo and (url.host == "localhost" or url.host.endswith(".localhost"))


async def _settle(tasks: dict[str, Awaitable], deadline: float) -> dict[str, object]:
    """Run lookups together and keep whatever finished before the deadline."""
    loop = asyncio.get_running_loop()
    running = {asyncio.ensure_future(coro): name for name, coro in tasks.items()}
    if not running:
        return {}
    done, pending = await asyncio.wait(running, timeout=max(0.1, deadline - loop.time()))
    for task in pending:
        task.cancel()
    results = {}
    for task in done:
        if not task.cancelled() and task.exception() is None:
            results[running[task]] = task.result()
    return results


def _age_signal(created: datetime | None, now: datetime) -> Signal | None:
    if not created:
        return None
    days = (now - created).days
    evidence = f"Registered {created.date().isoformat()} ({days} days ago)"
    if days < 7:
        return Signal("DOMAIN_AGE_LT_7D", evidence)
    if days < 30:
        return Signal("DOMAIN_AGE_LT_30D", evidence)
    if days < 90:
        return Signal("DOMAIN_AGE_LT_90D", evidence)
    if days > 730:
        return Signal("DOMAIN_AGE_GT_2Y", evidence)
    return None


class _Collected:
    def __init__(self, layer: LayerAResult) -> None:
        self.signals: list[Signal] = list(layer.signals)
        self.override = layer.override
        self.brand_id = layer.brand_id
        self.bait_words = list(layer.bait_words)

    def has(self, code: str) -> bool:
        return any(s.code == code for s in self.signals)

    def add(self, signal: Signal | None) -> None:
        if signal and not any(s.code == signal.code for s in self.signals):
            self.signals.append(signal)

    def merge(self, other: LayerAResult) -> None:
        for signal in other.signals:
            if signal.code != "TRANCO_TOP":
                self.add(signal)
        self.brand_id = self.brand_id or other.brand_id
        self.bait_words += other.bait_words


async def _network_layer(url: NormalizedUrl, collected: _Collected, evidence: Evidence, now: datetime,
                         deadline: float) -> tuple[Status, str | None]:
    demo = _is_demo_host(url)
    tasks: dict[str, Awaitable] = {
        "dns": net.dns_records(url.host, url.registered_domain),
        "chain": net.redirect_chain(url.url, allow_localhost=demo),
    }
    if not collected.override and not url.is_ip and not demo and not collected.has("SHORTENER"):
        tasks["rdap"] = net.rdap(url.registered_domain)
        if not collected.has("TRANCO_TOP"):
            tasks["crt"] = net.first_certificate(url.registered_domain)
    first = await _settle(tasks, deadline)
    chain, status_code, error = first.get("chain", ([url.url], None, None))
    evidence.redirect_chain = chain
    status: Status = "live" if status_code is not None and status_code < 400 else "offline"
    final_url = chain[-1] if status == "live" else None

    target = url
    if len(chain) > 1:
        try:
            final = normalize(chain[-1])
        except ValueError:
            final = None
        if final and final.registered_domain != url.registered_domain:
            final_layer = analyse(final)
            impersonating = any(s.code in IMPERSONATION for s in collected.signals)
            if final_layer.override and not impersonating:
                collected.override = final_layer.override
                collected.brand_id = final_layer.brand_id
            elif final_layer.override:
                collected.add(Signal("REDIRECTS_TO_OFFICIAL", final.registered_domain, final_layer.brand_id))
            else:
                collected.merge(final_layer)
                if not url.is_ip and not collected.has("SHORTENER"):
                    collected.add(Signal("CROSS_DOMAIN_REDIRECT", f"{url.registered_domain} → {final.registered_domain}"))
            if collected.has("SHORTENER") or not collected.override:
                target = final

    if collected.override:
        return status, final_url

    if target is url:
        second = first
    else:
        lookups: dict[str, Awaitable] = {
            "rdap": net.rdap(target.registered_domain),
            "dns": net.dns_records(target.host, target.registered_domain),
        }
        if not collected.has("TRANCO_TOP"):
            lookups["crt"] = net.first_certificate(target.registered_domain)
        second = await _settle(lookups, deadline)
    dns_result = second.get("dns")
    if dns_result:
        evidence.dns, resolves = dns_result
        if resolves is False and not target.is_ip:
            collected.add(Signal("NO_DNS", target.host))
        if evidence.dns.a:
            more = await _settle({"hosting": net.hosting(evidence.dns.a[0])}, deadline)
            evidence.hosting = more.get("hosting")
    if "rdap" in second:
        evidence.rdap, exists = second["rdap"]
        if not exists:
            collected.add(Signal("DOMAIN_NOT_REGISTERED", target.registered_domain))
        elif evidence.rdap:
            collected.add(_age_signal(evidence.rdap.created, now))
    if second.get("crt"):
        evidence.tls = second["crt"]
        seen = evidence.tls.first_seen_crtsh
        if seen and (now - seen).days < 7:
            collected.add(Signal("CERT_FIRST_SEEN_LT_7D", f"First certificate logged {seen.isoformat()}"))
    if status == "offline":
        collected.add(Signal("OFFLINE", error or (f"HTTP {status_code}" if status_code else None)))
    return status, final_url


async def scan(text: str, discovered_by: DiscoveredBy = "user", mode: Mode | None = None,
               first_seen: datetime | None = None) -> ScanResult:
    """Scan one input. Raises engine.normalize.InvalidInput when the input holds no URL."""
    mode = mode or default_mode()
    now = datetime.now(timezone.utc)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + settings.scan_timeout_s
    url = normalize(text)
    layer = analyse(url)
    collected = _Collected(layer)
    evidence = Evidence()
    status: Status = "offline"
    final_url: str | None = None

    if mode == "network":
        status, final_url = await _network_layer(url, collected, evidence, now, deadline)

    score, verdict, reasons = score_signals(collected.signals, collected.override)
    brand_id = collected.brand_id if verdict != "safe" or collected.override else None
    shown_status = status if mode == "network" else "unknown"
    summary = None
    if verdict != "safe" and llm.enabled():
        brand = brands().get(brand_id) if brand_id else None
        summary = await llm.summarise(verdict, score, brand.name_en if brand else None, reasons)
    summary_en, summary_ar = summary or template_summary(verdict, score, reasons, brand_id, shown_status)
    return ScanResult(
        id=new_case_id(now),
        input=text.strip()[:4096],
        normalized_url=url.url,
        final_url=final_url,
        registered_domain=url.registered_domain,
        scanned_at=now,
        status=status,
        score=score,
        verdict=verdict,
        impersonated_brand=brand_id if not collected.override else None,
        category=category_for(brand_id, collected.bait_words) if verdict != "safe" else None,
        reasons=reasons,
        summary_en=summary_en,
        summary_ar=summary_ar,
        evidence=evidence,
        discovered_by=discovered_by,
        first_seen=first_seen or now,
    )
