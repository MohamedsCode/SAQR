"""Watch mode: poll certificate transparency for every brand on a schedule (DISCOVERY_WATCH_MINUTES > 0).

New domains get their first_seen when the watcher scans them, which drives the "found before anyone reported it"
metric on the dashboard.
"""

from __future__ import annotations

import asyncio
import logging

from discovery import runner
from engine.brands import brands
from engine.store import store
from shared.contract import DiscoveredBy

log = logging.getLogger(__name__)


async def _scan(domain: str, source: DiscoveredBy):
    return await store.scan_and_store(domain, discovered_by=source)


async def watch_forever(interval_minutes: float) -> None:
    while True:
        for brand in brands().values():
            run = runner.new_run(brand.id, simulated=False)
            store.discovery_runs.append(run)
            try:
                await runner.run_discovery(run, brand, _scan, lookalikes=False)
            except Exception:  # one brand failing must not stop the watcher
                log.exception("Certificate watch failed for %s", brand.id)
                runner.finish(run)
        await asyncio.sleep(interval_minutes * 60)
