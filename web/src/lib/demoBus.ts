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

export function emitDemo(event: Outgoing): Promise<boolean> {
  return fetch("/demo-bus/emit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  })
    .then((r) => r.ok)
    .catch(() => false);
}

// One shared event stream per page. Browsers allow only ~6 open connections to a dev server, so a stream per
// component (or per tab) quickly starves the API requests and the page looks empty.
const listeners = new Set<(event: DemoEvent) => void>();
let source: EventSource | null = null;

function subscribe(listener: (event: DemoEvent) => void) {
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/demo-bus/events");
    source.onmessage = (message) => {
      let event: DemoEvent;
      try {
        event = JSON.parse(message.data) as DemoEvent;
      } catch {
        return; // ignore malformed events
      }
      listeners.forEach((l) => l(event));
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}

export function useDemoEvents(onEvent: (event: DemoEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => subscribe((event) => handler.current(event)), []);
}
