// Service worker: asks the SAQR API about each page a content script reports, and remembers bypasses.
import { verdictFor, type Reason, type ScanResult } from "@shared/contract";
import { BYPASS_MINUTES, type CheckOutcome, type ExtensionMessage, type PanelStatus } from "./messages";

// The live SAQR server. For local development build with VITE_SAQR_API=http://localhost:8000/api.
const API: string = import.meta.env.VITE_SAQR_API ?? "https://saqr-nu.vercel.app/api";
const RESULT_CACHE_MINUTES = 10;
const ERROR_REPEAT_MINUTES = 10;
// SAQR's own site and local servers; *.localhost demo pages are still checked.
const NOT_CHECKED = new Set(["saqr-nu.vercel.app", "localhost", "127.0.0.1", "[::1]"]);

interface Lookup {
  score: number;
  reasons: Reason[];
}

async function sessionGet<T>(key: string): Promise<T | undefined> {
  const stored = await chrome.storage.session.get(key);
  return stored[key] as T | undefined;
}

async function fresh(key: string, minutes: number): Promise<boolean> {
  const at = await sessionGet<number>(key);
  return at !== undefined && Date.now() - at < minutes * 60_000;
}

/** The host and the address SAQR is asked about, or null for pages it does not check. */
function checkable(raw: string): { host: string; target: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || NOT_CHECKED.has(url.hostname)) return null;
  // Query strings and fragments can carry personal tokens, so only the origin and path are sent.
  return { host: url.hostname, target: url.origin + url.pathname };
}

/** Ask the API about an address, reusing a recent answer. Throws when the API cannot be reached. */
async function lookup(target: string): Promise<Lookup> {
  const cached = await sessionGet<{ at: number; result: Lookup }>(`scan:${target}`);
  if (cached && Date.now() - cached.at < RESULT_CACHE_MINUTES * 60_000) return cached.result;
  const response = await fetch(`${API}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: target }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const scan = (await response.json()) as ScanResult;
  const result = { score: scan.score, reasons: scan.reasons };
  await chrome.storage.session.set({ [`scan:${target}`]: { at: Date.now(), result } });
  return result;
}

async function check(raw: string): Promise<CheckOutcome> {
  const page = checkable(raw);
  if (!page) return { kind: "none" };
  const bypassUntil = await sessionGet<number>(`bypass:${page.host}`);
  if (bypassUntil !== undefined && bypassUntil > Date.now()) return { kind: "none" };
  try {
    const { score, reasons } = await lookup(page.target);
    const verdict = verdictFor(score);
    return verdict === "safe" ? { kind: "none" } : { kind: verdict, domain: page.host, reasons };
  } catch {
    // A failed check is never treated as safe; the notice is shown once per site every few minutes.
    if (await fresh(`error:${page.host}`, ERROR_REPEAT_MINUTES)) return { kind: "none" };
    await chrome.storage.session.set({ [`error:${page.host}`]: Date.now() });
    return { kind: "error", domain: page.host };
  }
}

/** For the toolbar panel: the score of the open tab, also for safe and bypassed sites. */
async function status(raw: string): Promise<PanelStatus> {
  const page = checkable(raw);
  if (!page) return { kind: "skipped" };
  try {
    const { score, reasons } = await lookup(page.target);
    return { kind: "result", domain: page.host, score, reasons };
  } catch {
    return { kind: "error", domain: page.host };
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  switch (message.type) {
    case "saqr:check":
      check(message.url).then(sendResponse, () => sendResponse({ kind: "error", domain: "" }));
      return true; // the response is sent asynchronously
    case "saqr:status":
      status(message.url).then(sendResponse, () => sendResponse({ kind: "skipped" }));
      return true;
    case "saqr:bypass":
      chrome.storage.session.set({ [`bypass:${message.host}`]: Date.now() + BYPASS_MINUTES * 60_000 });
      return false;
    case "saqr:leave":
      if (sender.tab?.id !== undefined) chrome.tabs.update(sender.tab.id, { url: "chrome://newtab/" });
      return false;
  }
});
