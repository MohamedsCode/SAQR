// Data contract shared with the backend. Mirrors shared/contract.py; change both together.

export type Status = "live" | "offline" | "error";
export type Verdict = "safe" | "suspicious" | "fraud";
export type DiscoveredBy =
  | "user"
  | "lookalike"
  | "crtsh"
  | "maps_sweep"
  | "search_sweep"
  | "graph_expansion"
  | "batch";
export type PhoneStatus = "official" | "reported_scam" | "fake_listing" | "unknown";
export type BrandCategory = "government" | "police" | "transport" | "delivery" | "bank" | "telecom";

export const SUSPICIOUS_MIN = 30;
export const FRAUD_MIN = 70;

export function verdictFor(score: number): Verdict {
  if (score >= FRAUD_MIN) return "fraud";
  if (score >= SUSPICIOUS_MIN) return "suspicious";
  return "safe";
}

export interface Reason {
  code: string;
  en: string;
  ar: string;
  weight: number;
  evidence: string | null;
}

export interface Rdap {
  registrar: string | null;
  created: string | null;
  expires: string | null;
  abuse_email: string | null;
  nameservers: string[];
}

export interface Dns {
  a: string[];
  mx: string[];
  ns: string[];
}

export interface Hosting {
  ip: string | null;
  asn: number | null;
  org: string | null;
  country: string | null;
}

export interface Tls {
  issuer: string | null;
  not_before: string | null;
  first_seen_crtsh: string | null;
}

export interface VisualSimilarity {
  brand_id: string;
  percent: number;
}

export interface Cloaking {
  detected: boolean;
  details: string | null;
}

export interface Form {
  action: string | null;
  fields: string[];
  asks_for: string[];
}

export interface Evidence {
  redirect_chain: string[];
  screenshot_desktop: string | null;
  screenshot_mobile: string | null;
  html_sha256: string | null;
  screenshot_sha256: string | null;
  rdap: Rdap | null;
  dns: Dns | null;
  hosting: Hosting | null;
  tls: Tls | null;
  favicon_phash: string | null;
  visual_similarity: VisualSimilarity | null;
  cloaking: Cloaking | null;
  phones_found: string[];
  emails_found: string[];
  forms: Form[];
}

export interface ScanResult {
  id: string;
  input: string;
  normalized_url: string;
  final_url: string | null;
  registered_domain: string;
  scanned_at: string;
  status: Status;
  score: number;
  verdict: Verdict;
  impersonated_brand: string | null;
  category: string | null;
  reasons: Reason[];
  summary_en: string;
  summary_ar: string;
  evidence: Evidence;
  discovered_by: DiscoveredBy;
  first_seen: string;
  related_ids: string[];
}

export interface OfficialPhone {
  number: string;
  label: string;
  source_url: string;
  verified: boolean;
}

export interface Brand {
  id: string;
  name_en: string;
  name_ar: string;
  category: BrandCategory;
  official_domains: string[];
  official_phones: OfficialPhone[];
  keywords_en: string[];
  keywords_ar: string[];
  transliterations: string[];
  colors: string[];
  reference_url: string | null;
  favicon_path: string | null;
  reference_screenshot_path: string | null;
}

export interface PhoneCheck {
  number_e164: string;
  status: PhoneStatus;
  brand_id: string | null;
  reasons: string[];
  sources: string[];
}

// ---- API request and response models ----

export interface ScanRequest {
  input: string;
}

export interface BatchRequest {
  inputs: string[];
}

export interface Job {
  id: string;
  status: "queued" | "running" | "done";
  created_at: string;
  total: number;
  done: number;
  result_ids: string[];
  failed: string[];
}

export interface PhoneCheckRequest {
  hash_prefix: string;
}

export interface PhoneMatch {
  suffix_hash: string;
  status: PhoneStatus;
  brand_id: string | null;
}

export interface ReportRequest {
  input: string;
  type: "url" | "phone";
}

export interface Report {
  id: string;
  input: string;
  type: "url" | "phone";
  received_at: string;
}

export interface DiscoveryRunRequest {
  brand_id: string;
}

export interface DiscoveryRun {
  id: string;
  brand_id: string;
  started_at: string;
  status: "running" | "done";
  simulated: boolean;
  candidates_checked: number;
  found_ids: string[];
}

export interface MapsListing {
  id: string;
  brand_id: string;
  query: string;
  name: string;
  address: string | null;
  url: string | null;
  phones: string[];
  phone_status: PhoneStatus;
  source: "google_places" | "serpapi" | "fixture";
  simulated: boolean;
  seen_at: string;
}

export interface MapsSweep {
  simulated: boolean;
  ran_at: string;
  listings: MapsListing[];
}

export interface GraphElement {
  data: Record<string, string | number | boolean | null>;
}

export interface GraphCluster {
  id: string;
  domains: string[];
  size: number;
}

export interface Graph {
  nodes: GraphElement[];
  edges: GraphElement[];
  clusters: GraphCluster[];
}

export interface Stats {
  scans: number;
  fraud_found: number;
  suspicious_found: number;
  found_before_report: number;
  fake_helplines: number;
  avg_hours_to_detect: number | null;
  by_source: Record<string, number>;
}
