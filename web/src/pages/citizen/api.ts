import type { Brand, ScanResult } from "@shared/contract";

export class CheckError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new CheckError(response.status);
  return response.json() as Promise<T>;
}

/** Scan a pasted link or message. Only suspicious and fraud results are saved as cases. */
export function checkLink(input: string, signal: AbortSignal): Promise<ScanResult> {
  return post<ScanResult>("/check", { input }, signal);
}

export function reportLink(input: string): Promise<unknown> {
  return post("/report", { input, type: "url" });
}

let brandsRequest: Promise<Brand[]> | null = null;

/** The brand library (official domains and verified numbers), fetched once. */
export function fetchBrands(): Promise<Brand[]> {
  brandsRequest ??= fetch("/api/brands").then((r) => {
    if (!r.ok) throw new CheckError(r.status);
    return r.json() as Promise<Brand[]>;
  });
  brandsRequest.catch(() => (brandsRequest = null));
  return brandsRequest;
}
