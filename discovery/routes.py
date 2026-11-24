"""Discovery, campaign expansion, helpline sweep and campaign graph endpoints.

With NETWORK_ENABLED=false these fall back to the case store and fixtures, and say so with `simulated: true`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from discovery import runner
from discovery.graph import build_graph
from discovery.helplines import fixture_sweep, live_sweep
from engine.normalize import InvalidInput, normalize
from engine.settings import settings
from engine.store import store
from shared.contract import DiscoveredBy, DiscoveryRun, DiscoveryRunRequest, Graph, GraphExpandRequest, MapsSweep

router = APIRouter()


def _scan_fn(related_to: str | None = None) -> runner.ScanFn:
    async def scan(domain: str, source: DiscoveredBy):
        return await store.scan_and_store(domain, discovered_by=source, related_to=related_to)
    return scan


@router.post("/discovery/run", response_model=DiscoveryRun)
def discovery_run(request: DiscoveryRunRequest) -> DiscoveryRun:
    """Start look-alike + certificate discovery for a brand. Poll GET /discovery/runs/{id} for progress."""
    brand = store.brands.get(request.brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Unknown brand")
    run = runner.new_run(brand.id, simulated=not settings.network_enabled)
    store.discovery_runs.append(run)
    if run.simulated:
        runner.simulated_discovery(run, brand, list(store.scans.values()))
    else:
        store.spawn(runner.run_discovery(run, brand, _scan_fn()))
    return run


@router.get("/discovery/runs", response_model=list[DiscoveryRun])
def discovery_runs() -> list[DiscoveryRun]:
    return list(reversed(store.discovery_runs))


@router.get("/discovery/runs/{run_id}", response_model=DiscoveryRun)
def discovery_run_status(run_id: str) -> DiscoveryRun:
    run = next((r for r in store.discovery_runs if r.id == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.post("/graph/expand", response_model=DiscoveryRun)
def graph_expand(request: GraphExpandRequest) -> DiscoveryRun:
    """Expand a flagged case's campaign: scan domains sharing its certificates or its phone numbers."""
    seed = store.scans.get(request.scan_id)
    if not seed:
        raise HTTPException(status_code=404, detail="Scan not found")
    if seed.verdict == "safe":
        raise HTTPException(status_code=409, detail="Only suspicious or fraud cases can be expanded.")
    run = runner.new_run(seed.impersonated_brand, simulated=not settings.network_enabled, kind="expansion",
                         seed_id=seed.id)
    store.discovery_runs.append(run)
    if run.simulated:
        runner.simulated_expansion(run, seed, list(store.scans.values()))
    else:
        store.spawn(runner.run_expansion(run, seed, list(store.scans.values()), store.maps_sweep.listings,
                                         _scan_fn(related_to=seed.id)))
    return run


@router.get("/maps-sweep", response_model=MapsSweep)
def maps_sweep() -> MapsSweep:
    return store.maps_sweep


@router.post("/maps-sweep/run", response_model=MapsSweep)
async def maps_sweep_run() -> MapsSweep:
    """Run the helpline sweep, then scan the websites of listings flagged as fake in the background."""
    sweep = (await live_sweep() if settings.network_enabled else None) or fixture_sweep()
    store.maps_sweep = sweep
    for listing in sweep.listings:
        if listing.phone_status != "fake_listing" or not listing.url:
            continue
        try:
            host = normalize(listing.url).host
        except InvalidInput:
            continue
        demo_host = host == "localhost" or host.endswith(".localhost")
        if not settings.network_enabled or (sweep.simulated and not (demo_host and settings.allow_localhost_demo)):
            continue  # simulated listings point at made-up domains; only the localhost demo page is scanned
        store.spawn(store.scan_and_store(listing.url, discovered_by="maps_sweep"))
    return sweep


@router.get("/graph", response_model=Graph)
def graph(seed: str | None = None) -> Graph:
    if seed and seed not in store.scans:
        raise HTTPException(status_code=404, detail="Scan not found")
    return build_graph(list(store.scans.values()), seed=seed)
