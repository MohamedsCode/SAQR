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

export function useDemoEvents(onEvent: (event: DemoEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const source = new EventSource("/demo-bus/events");
    source.onmessage = (message) => {
      try {
        handler.current(JSON.parse(message.data) as DemoEvent);
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, []);
}
