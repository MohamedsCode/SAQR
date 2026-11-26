import { useEffect, useRef } from "react";

export const DEMO_URL = "http://adpolice-fines-pay.localhost:8081/pay";

export type DemoEvent =
  | { type: "trigger"; at: string }
  | { type: "reset"; at: string }
  | { type: "call_answered"; at: string }
  | { type: "call_ended"; at: string }
  | { type: "blocked"; scan_id: string; call_at: string | null; at: string };

type Outgoing =
  | { type: "trigger" }
  | { type: "reset" }
  | { type: "call_answered" }
  | { type: "call_ended" }
  | { type: "blocked"; scan_id: string; call_at: string | null };

// The relay lives on the SAQR server (/api/demo-bus), so the dashboard and the phone simulator find each other on
// the live site too, through the same /api forwarding as everything else.
const BUS = "/api/demo-bus";
const POLL_MS = 1000;

export function emitDemo(event: Outgoing): Promise<boolean> {
  return fetch(`${BUS}/emit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  })
    .then((r) => r.ok)
    .catch(() => false);
}

// One shared poller per page: every open component listens to the same once-a-second request.
const listeners = new Set<(event: DemoEvent) => void>();
let cursor = -1; // -1 until the first answer: events from before the page opened are not replayed
let timer: number | null = null;
let inFlight = false;

async function poll() {
  timer = null;
  inFlight = true;
  try {
    const response = await fetch(`${BUS}/events?after=${cursor}`, { cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as { seq: number; events: DemoEvent[] };
      if (cursor >= 0) body.events.forEach((event) => listeners.forEach((l) => l(event)));
      cursor = body.seq;
    }
  } catch {
    // offline for a moment: try again on the next tick
  }
  inFlight = false;
  if (listeners.size && timer === null) timer = window.setTimeout(poll, POLL_MS);
}

function subscribe(listener: (event: DemoEvent) => void) {
  listeners.add(listener);
  if (timer === null && !inFlight) timer = window.setTimeout(poll, 0);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function useDemoEvents(onEvent: (event: DemoEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => subscribe((event) => handler.current(event)), []);
}
