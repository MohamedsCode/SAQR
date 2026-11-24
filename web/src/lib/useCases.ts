import type { ScanResult, Stats } from "@shared/contract";
import { useEffect, useState } from "react";
import { api, useDataMode } from "../api";
import { visibleCases } from "./display";

const POLL_MS = 4000;

/** Cases shown in the police screens, refreshed while the engine is live. */
export function useCases() {
  const mode = useDataMode();
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      Promise.all([api.stats(), api.scans()])
        .then(([s, list]) => {
          if (!active) return;
          setStats(s);
          setScans(visibleCases(list));
          setFailed(false);
        })
        .catch(() => active && setFailed(true));
    load();
    const id = mode === "live" ? setInterval(load, POLL_MS) : undefined;
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [mode]);

  return { scans, stats, failed };
}
