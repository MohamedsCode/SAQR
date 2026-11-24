import type { ScanResult } from "@shared/contract";

const SKIT_KEY = "saqr.skitCases";

// Demo pages run on *.localhost; on screen they use the public-looking name the skit's SMS pretends to be.
export function isDemoCase(scan: ScanResult): boolean {
  return rawHost(scan).endsWith(".localhost");
}

function rawHost(scan: ScanResult): string {
  try {
    return new URL(scan.normalized_url).hostname.toLowerCase();
  } catch {
    return scan.registered_domain;
  }
}

/** The full hostname of the scanned address (never just the registered domain). */
export function hostOf(scan: ScanResult): string {
  const host = rawHost(scan).replace(/^www\./, "");
  return host.endsWith(".localhost") ? `${host.slice(0, -".localhost".length)}.com` : host;
}

export function rememberSkitCase(id: string) {
  const ids = new Set(skitCases());
  ids.add(id);
  localStorage.setItem(SKIT_KEY, JSON.stringify([...ids].slice(-50)));
}

function skitCases(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SKIT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Demo-page cases appear only when the live skit created them or a full scan captured them. */
export function visibleCases(scans: ScanResult[]): ScanResult[] {
  const skit = new Set(skitCases());
  return scans.filter(
    (s) => !isDemoCase(s) || skit.has(s.id) || Boolean(s.evidence.screenshot_desktop || s.evidence.screenshot_mobile),
  );
}

/** Placeholder values from sample data are never shown. */
export function clean<T>(value: T | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === "—" || /fixture|^demo (registrar|hosting|cloud)/i.test(text)) return null;
  }
  return value;
}

export function medianHours(scans: ScanResult[]): number | null {
  const hours = scans
    .filter((s) => s.verdict !== "safe" && s.evidence.rdap?.created)
    .map((s) => (Date.parse(s.first_seen) - Date.parse(s.evidence.rdap!.created!)) / 3_600_000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  if (!hours.length) return null;
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
}
