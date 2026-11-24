"""Discovery, helpline sweep and campaign graph endpoints (fixture-backed until the monitors land)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from discovery.graph import build_graph
from engine.store import store, utcnow
from shared.contract import DiscoveryRun, DiscoveryRunRequest, Graph, MapsSweep

router = APIRouter()


@router.post("/discovery/run", response_model=DiscoveryRun)
def discovery_run(request: DiscoveryRunRequest) -> DiscoveryRun:
    if request.brand_id not in store.brands:
        raise HTTPException(status_code=404, detail="Unknown brand")
    found = [
        s.id for s in store.scans.values()
        if s.impersonated_brand == request.brand_id and s.discovered_by in {"lookalike", "crtsh"}
    ]
    run = DiscoveryRun(
        id=uuid.uuid4().hex[:12],
        brand_id=request.brand_id,
        started_at=utcnow(),
        status="done",
        simulated=True,
        candidates_checked=0,
        found_ids=found,
    )
    store.discovery_runs.append(run)
    return run


@router.get("/discovery/runs", response_model=list[DiscoveryRun])
def discovery_runs() -> list[DiscoveryRun]:
    return list(reversed(store.discovery_runs))


@router.get("/maps-sweep", response_model=MapsSweep)
def maps_sweep() -> MapsSweep:
    return store.maps_sweep


@router.post("/maps-sweep/run", response_model=MapsSweep)
def maps_sweep_run() -> MapsSweep:
    store.maps_sweep = store.fixture_sweep()
    return store.maps_sweep


@router.get("/graph", response_model=Graph)
def graph(seed: str | None = None) -> Graph:
    if seed and seed not in store.scans:
        raise HTTPException(status_code=404, detail="Scan not found")
    return build_graph(list(store.scans.values()), seed=seed)
