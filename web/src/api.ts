import type { Brand, ScanResult, Stats } from "@shared/contract";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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

export const api = {
  stats: () => request<Stats>("/stats"),
  scans: () => request<ScanResult[]>("/scans"),
  brands: () => request<Brand[]>("/brands"),
  scan: (input: string) => request<ScanResult>("/scan", { method: "POST", body: JSON.stringify({ input }) }),
};
