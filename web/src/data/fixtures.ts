import rawListings from "@data/fixtures/maps_results.json";
import rawScans from "@data/fixtures/sample_scans.json";
import rawBrands from "@shared/brands.json";
import type { Brand, Evidence, ScanResult, Stats } from "@shared/contract";

const EMPTY_EVIDENCE: Evidence = {
  redirect_chain: [],
  screenshot_desktop: null,
  screenshot_mobile: null,
  html_sha256: null,
  screenshot_sha256: null,
  rdap: null,
  dns: null,
  hosting: null,
  tls: null,
  favicon_phash: null,
  visual_similarity: null,
  cloaking: null,
  phones_found: [],
  emails_found: [],
  forms: [],
};

// Fixture files leave out empty evidence fields; the API fills them with defaults, so do the same here.
export function normalizeScan(raw: unknown): ScanResult {
  const scan = raw as ScanResult;
  return {
    ...scan,
    related_ids: scan.related_ids ?? [],
    evidence: { ...EMPTY_EVIDENCE, ...scan.evidence },
  };
}

export const sampleScans: ScanResult[] = (rawScans as unknown[]).map(normalizeScan);
export const sampleBrands = rawBrands as unknown as Brand[];

interface RawListing {
  phones: string[];
  phone_status: string;
}

// Mirrors engine/routes/stats.py so the sample dashboard shows the same KPIs the API would.
export function sampleStats(scans: ScanResult[]): Stats {
  const flagged = scans.filter((s) => s.verdict !== "safe");
  const detectHours = flagged
    .filter((s) => s.evidence.rdap?.created)
    .map((s) => (Date.parse(s.first_seen) - Date.parse(s.evidence.rdap!.created!)) / 3_600_000);
  const fakeNumbers = new Set(
    (rawListings as RawListing[]).filter((l) => l.phone_status === "fake_listing").flatMap((l) => l.phones),
  );
  const bySource: Record<string, number> = {};
  for (const s of scans) bySource[s.discovered_by] = (bySource[s.discovered_by] ?? 0) + 1;
  return {
    scans: scans.length,
    fraud_found: scans.filter((s) => s.verdict === "fraud").length,
    suspicious_found: scans.filter((s) => s.verdict === "suspicious").length,
    found_before_report: flagged.filter((s) => s.discovered_by !== "user").length,
    fake_helplines: fakeNumbers.size,
    avg_hours_to_detect: detectHours.length
      ? Math.round((detectHours.reduce((a, b) => a + b, 0) / detectHours.length) * 10) / 10
      : null,
    by_source: bySource,
  };
}

export function hostOf(text: string): string | null {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/hxxp/g, "http")
    .replace(/\[\.\]|\(\.\)|\[dot\]/g, ".");
  const match = cleaned.match(/(?:https?:\/\/)?([a-z0-9\u0080-￿.-]+\.[a-z\u0080-￿-]{2,})/);
  return match ? match[1].replace(/^www\./, "").replace(/\.+$/, "") : null;
}

// Without the scanner, a link can only be "checked" if it is one of the sample cases.
export function findSampleScan(input: string): ScanResult | null {
  const host = hostOf(input);
  if (!host) return null;
  return (
    sampleScans.find((s) => hostOf(s.normalized_url) === host) ??
    sampleScans.find((s) => s.registered_domain === host) ??
    null
  );
}
