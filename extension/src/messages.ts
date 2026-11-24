import type { Reason } from "@shared/contract";

export type WarningKind = "suspicious" | "fraud";

/** What the background worker decided about a page. "none" covers safe pages and pages that are not checked. */
export type CheckOutcome =
  | { kind: "none" }
  | { kind: WarningKind; domain: string; reasons: Reason[] }
  | { kind: "error"; domain: string };

export type ExtensionMessage =
  | { type: "saqr:check"; url: string }
  | { type: "saqr:bypass"; host: string }
  | { type: "saqr:leave" };

export const BYPASS_MINUTES = 30;
