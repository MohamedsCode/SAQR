// Service worker: asks the SAQR API about each page a content script reports, and remembers bypasses.
import { verdictFor, type ScanResult } from "@shared/contract";
import { BYPASS_MINUTES, type CheckOutcome, type ExtensionMessage } from "./messages";

const API = "http://localhost:8000/api";
const RESULT_CACHE_MINUTES = 10;
const ERROR_REPEAT_MINUTES = 10;
const NOT_CHECKED = new Set(["localhost", "127.0.0.1", "[::1]"]); // the API and dashboard; *.localhost demo pages are checked

async function sessionGet<T>(key: string): Promise<T | undefined> {
  const stored = await chrome.storage.session.get(key);
  return stored[key] as T | undefined;
}

async function fresh(key: string, minutes: number): Promise<boolean> {
  const at = await sessionGet<number>(key);
  return at !== undefined && Date.now() - at < minutes * 60_000;
}

async function check(raw: string): Promise<CheckOutcome> {
  const url = new URL(raw);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || NOT_CHECKED.has(url.hostname)) {
    return { kind: "none" };
  }
  const host = url.hostname;
  const bypassUntil = await sessionGet<number>(`bypass:${host}`);
  if (bypassUntil !== undefined && bypassUntil > Date.now()) return { kind: "none" };

  // Query strings and fragments can carry personal tokens, so only the origin and path are sent.
  const target = url.origin + url.pathname;
  const cached = await sessionGet<{ at: number; outcome: CheckOutcome }>(`result:${target}`);
  if (cached && Date.now() - cached.at < RESULT_CACHE_MINUTES * 60_000) return cached.outcome;

  let outcome: CheckOutcome;
  try {
    const response = await fetch(`${API}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: target }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = (await response.json()) as ScanResult;
    const verdict = verdictFor(result.score);
    outcome = verdict === "safe" ? { kind: "none" } : { kind: verdict, domain: host, reasons: result.reasons };
  } catch {
    // A failed check is never treated as safe; the notice is shown once per site every few minutes.
    if (await fresh(`error:${host}`, ERROR_REPEAT_MINUTES)) return { kind: "none" };
    await chrome.storage.session.set({ [`error:${host}`]: Date.now() });
    return { kind: "error", domain: host };
  }
  await chrome.storage.session.set({ [`result:${target}`]: { at: Date.now(), outcome } });
  return outcome;
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  switch (message.type) {
    case "saqr:check":
      check(message.url).then(sendResponse, () => sendResponse({ kind: "error", domain: "" }));
      return true; // the response is sent asynchronously
    case "saqr:bypass":
      chrome.storage.session.set({ [`bypass:${message.host}`]: Date.now() + BYPASS_MINUTES * 60_000 });
      return false;
    case "saqr:leave":
      if (sender.tab?.id !== undefined) chrome.tabs.update(sender.tab.id, { url: "chrome://newtab/" });
      return false;
  }
});
