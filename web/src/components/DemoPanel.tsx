import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, useDataMode } from "../api";
import { rememberSkitCase } from "../lib/display";
import { DEMO_URL, type DemoEvent, emitDemo, useDemoEvents } from "../lib/demoBus";

type PhoneState = "idle" | "ringing" | "in_call" | "sms" | "blocked";

/** A small header menu that runs the live skit: trigger the scam call, reset, open the phone simulator. */
export default function DemoMenu() {
  const { t } = useTranslation();
  const mode = useDataMode();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState<PhoneState>("idle");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDemoEvents((event: DemoEvent) => {
    const next: Partial<Record<DemoEvent["type"], PhoneState>> = {
      trigger: "ringing",
      call_answered: "in_call",
      call_ended: "sms",
      blocked: "blocked",
      reset: "idle",
    };
    if (next[event.type]) setPhone(next[event.type]!);
  });

  useEffect(() => {
    const close = (event: MouseEvent) => ref.current && !ref.current.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function reset() {
    setBusy(true);
    try {
      if (mode === "live") {
        // The public demo server refuses to wipe its cases; the phone is still reset below.
        await api.demoReset().catch(() => null);
        const scan = await api.scan(DEMO_URL).catch(() => null);
        if (scan) rememberSkitCase(scan.id);
      }
      await emitDemo({ type: "reset" });
    } finally {
      setBusy(false);
    }
  }

  const active = phone !== "idle";
  return (
    <div ref={ref} className="relative" data-tour="demo">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[13px] transition ${active ? "bg-white/15 font-semibold text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`}
      >
        <span className={`size-2 rounded-full ${active ? "animate-pulse-dot bg-[#ff6b5e]" : "bg-white/40"}`} />
        {t("demo.menu")}
      </button>
      {open && (
        <div className="card tour-pop absolute bottom-11 start-0 z-50 w-64 space-y-2 p-3 text-text shadow-2xl">
          <div className="text-xs text-muted">{t(`demo.state_${phone}`)}</div>
          <button
            type="button"
            onClick={() => emitDemo({ type: "trigger" })}
            className="w-full rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-white hover:bg-gold/90"
          >
            {t("demo.trigger")}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm hover:border-gold disabled:opacity-50"
          >
            {t("demo.reset")}
          </button>
          <a href="/demo/phone" target="_blank" rel="noreferrer" className="block text-center text-xs text-gold-soft hover:underline">
            {t("demo.open_phone")}
          </a>
        </div>
      )}
    </div>
  );
}
