import type { Brand, ScanResult, Stats } from "@shared/contract";
import { useSyncExternalStore } from "react";
import { findSampleScan, normalizeScan, sampleBrands, sampleScans, sampleStats } from "./data/fixtures";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class NotInSamples extends Error {}

// "live" talks to the engine; "sample" serves the fixture cases when the API is not running.
export type DataMode = "live" | "sample";

let mode: DataMode | null = null;
let probe: Promise<DataMode> | null = null;
const listeners = new Set<() => void>();

function setMode(next: DataMode) {
  if (mode !== next) {
    mode = next;
    listeners.forEach((l) => l());
  }
}

function detectMode(): Promise<DataMode> {
  if (mode) return Promise.resolve(mode);
  probe ??= fetch("/api/health")
    .then((r) => (r.ok ? "live" : "sample"))
    .catch(() => "sample" as const)
    .then((m) => {
      setMode(m);
      probe = null;
      return m;
    });
  return probe;
}

export function useDataMode(): DataMode | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => mode,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.detail ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

async function live<T>(call: () => Promise<T>, sample: () => T): Promise<T> {
  if ((await detectMode()) === "sample") return sample();
  return call();
}

export const api = {
  stats: () => live(() => request<Stats>("/stats"), () => sampleStats(sampleScans)),
  scans: () => live(() => request<ScanResult[]>("/scans").then((l) => l.map(normalizeScan)), () => sampleScans),
  scanById: (id: string) =>
    live(
      () => request<ScanResult>(`/scans/${encodeURIComponent(id)}`).then(normalizeScan),
      () => {
        const found = sampleScans.find((s) => s.id === id);
        if (!found) throw new ApiError(404, "Scan not found");
        return found;
      },
    ),
  brands: () => live(() => request<Brand[]>("/brands"), () => sampleBrands),
  scan: (input: string) =>
    live(
      () => request<ScanResult>("/scan", { method: "POST", body: JSON.stringify({ input }) }).then(normalizeScan),
      () => {
        const found = findSampleScan(input);
        if (!found) throw new NotInSamples();
        return found;
      },
    ),
};

export function screenshotUrl(scan: ScanResult, kind: "desktop" | "mobile"): string | null {
  const path = kind === "desktop" ? scan.evidence.screenshot_desktop : scan.evidence.screenshot_mobile;
  return path && mode === "live" ? `/api/scans/${encodeURIComponent(scan.id)}/screenshot/${kind}` : null;
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

export function isLive(): boolean {
  return mode === "live";
}
