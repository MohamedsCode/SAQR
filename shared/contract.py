"""Data contract shared by the engine, discovery, evidence and web modules.

Mirrored in shared/contract.ts. Change both files together.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["live", "offline", "error"]
Verdict = Literal["safe", "suspicious", "fraud"]
DiscoveredBy = Literal[
    "user", "lookalike", "crtsh", "maps_sweep", "search_sweep", "graph_expansion", "batch"
]
PhoneStatus = Literal["official", "reported_scam", "fake_listing", "unknown"]
BrandCategory = Literal["government", "police", "transport", "delivery", "bank", "telecom"]

SUSPICIOUS_MIN = 30
FRAUD_MIN = 70


def verdict_for(score: int) -> Verdict:
    if score >= FRAUD_MIN:
        return "fraud"
    if score >= SUSPICIOUS_MIN:
        return "suspicious"
    return "safe"


class Reason(BaseModel):
    code: str
    en: str
    ar: str
    weight: int
    evidence: str | None = None


class Rdap(BaseModel):
    registrar: str | None = None
    created: datetime | None = None
    expires: datetime | None = None
    abuse_email: str | None = None
    nameservers: list[str] = Field(default_factory=list)


class Dns(BaseModel):
    a: list[str] = Field(default_factory=list)
    mx: list[str] = Field(default_factory=list)
    ns: list[str] = Field(default_factory=list)


class Hosting(BaseModel):
    ip: str | None = None
    asn: int | None = None
    org: str | None = None
    country: str | None = None


class Tls(BaseModel):
    issuer: str | None = None
    not_before: datetime | None = None
    first_seen_crtsh: datetime | None = None


class VisualSimilarity(BaseModel):
    brand_id: str
    percent: float = Field(ge=0, le=100)


class Cloaking(BaseModel):
    detected: bool
    details: str | None = None


class Form(BaseModel):
    action: str | None = None
    fields: list[str] = Field(default_factory=list)
    asks_for: list[str] = Field(default_factory=list)


class Evidence(BaseModel):
    redirect_chain: list[str] = Field(default_factory=list)
    screenshot_desktop: str | None = None
    screenshot_mobile: str | None = None
    html_sha256: str | None = None
    screenshot_sha256: str | None = None
    rdap: Rdap | None = None
    dns: Dns | None = None
    hosting: Hosting | None = None
    tls: Tls | None = None
    favicon_phash: str | None = None
    visual_similarity: VisualSimilarity | None = None
    cloaking: Cloaking | None = None
    phones_found: list[str] = Field(default_factory=list)
    emails_found: list[str] = Field(default_factory=list)
    forms: list[Form] = Field(default_factory=list)


class ScanResult(BaseModel):
    id: str
    input: str
    normalized_url: str
    final_url: str | None = None
    registered_domain: str
    scanned_at: datetime
    status: Status
    score: int = Field(ge=0, le=100)
    verdict: Verdict
    impersonated_brand: str | None = None
    category: str | None = None
    reasons: list[Reason] = Field(default_factory=list)
    summary_en: str
    summary_ar: str
    evidence: Evidence = Field(default_factory=Evidence)
    discovered_by: DiscoveredBy = "user"
    first_seen: datetime
    related_ids: list[str] = Field(default_factory=list)


class OfficialPhone(BaseModel):
    number: str
    label: str
    source_url: str
    verified: bool = False


class Brand(BaseModel):
    id: str
    name_en: str
    name_ar: str
    category: BrandCategory
    official_domains: list[str] = Field(default_factory=list)
    official_phones: list[OfficialPhone] = Field(default_factory=list)
    keywords_en: list[str] = Field(default_factory=list)
    keywords_ar: list[str] = Field(default_factory=list)
    transliterations: list[str] = Field(default_factory=list)
    colors: list[str] = Field(default_factory=list)
    reference_url: str | None = None
    favicon_path: str | None = None
    reference_screenshot_path: str | None = None


class PhoneCheck(BaseModel):
    number_e164: str
    status: PhoneStatus
    brand_id: str | None = None
    reasons: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)


# ---- API request and response models ----


class ScanRequest(BaseModel):
    input: str = Field(min_length=1, max_length=4096)


class BatchRequest(BaseModel):
    inputs: list[str] = Field(min_length=1, max_length=5000)


class Job(BaseModel):
    id: str
    status: Literal["queued", "running", "done"]
    created_at: datetime
    total: int
    done: int
    result_ids: list[str] = Field(default_factory=list)
    unmatched: list[str] = Field(default_factory=list)


class PhoneCheckRequest(BaseModel):
    hash_prefix: str = Field(pattern=r"^[0-9a-f]{5}$")


class PhoneMatch(BaseModel):
    suffix_hash: str
    status: PhoneStatus
    brand_id: str | None = None


class ReportRequest(BaseModel):
    input: str = Field(min_length=1, max_length=4096)
    type: Literal["url", "phone"]


class Report(BaseModel):
    id: str
    input: str
    type: Literal["url", "phone"]
    received_at: datetime


class DiscoveryRunRequest(BaseModel):
    brand_id: str


class DiscoveryRun(BaseModel):
    id: str
    brand_id: str
    started_at: datetime
    status: Literal["running", "done"]
    simulated: bool
    candidates_checked: int
    found_ids: list[str] = Field(default_factory=list)


class MapsListing(BaseModel):
    id: str
    brand_id: str
    query: str
    name: str
    address: str | None = None
    url: str | None = None
    phones: list[str] = Field(default_factory=list)
    phone_status: PhoneStatus
    source: Literal["google_places", "serpapi", "fixture"]
    simulated: bool
    seen_at: datetime


class MapsSweep(BaseModel):
    simulated: bool
    ran_at: datetime
    listings: list[MapsListing]


class GraphElement(BaseModel):
    data: dict[str, str | int | float | bool | None]


class GraphCluster(BaseModel):
    id: str
    domains: list[str]
    size: int


class Graph(BaseModel):
    nodes: list[GraphElement]
    edges: list[GraphElement]
    clusters: list[GraphCluster]


class Stats(BaseModel):
    scans: int
    fraud_found: int
    suspicious_found: int
    found_before_report: int
    fake_helplines: int
    avg_hours_to_detect: float | None
    by_source: dict[str, int]
