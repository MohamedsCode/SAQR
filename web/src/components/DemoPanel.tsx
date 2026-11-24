import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, useDataMode } from "../api";
import { DEMO_URL, type DemoEvent, emitDemo, useDemoEvents } from "../lib/demoBus";
import { IconPhone } from "./Icons";

type PhoneState = "idle" | "ringing" | "in_call" | "sms" | "blocked";

export default function DemoPanel() {
  const { t } = useTranslation();
  const mode = useDataMode();
  const [phone, setPhone] = useState<PhoneState>("idle");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

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

  async function trigger() {
    setOffline(!(await emitDemo({ type: "trigger" })));
  }

  async function reset() {
    setBusy(true);
    try {
      if (mode === "live") {
        await api.demoReset();
        await api.scan(DEMO_URL).catch(() => undefined);
      }
      setOffline(!(await emitDemo({ type: "reset" })));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel flex flex-wrap items-center gap-4 p-4">
      <span className="grid size-10 place-items-center rounded-xl bg-gold/15 text-gold ring-1 ring-gold/40">
        <IconPhone />
      </span>
      <div className="me-auto">
        <div className="text-sm font-semibold">{t("demo.title")}</div>
        <div className="text-xs text-muted">
          {t("demo.phone_at")}{" "}
          <a href="/demo/phone" target="_blank" rel="noreferrer" className="font-mono text-gold-soft hover:underline" dir="ltr">
            {window.location.hostname === "localhost" ? "http://<laptop-IP>:5173" : window.location.origin}/demo/phone
          </a>
        </div>
      </div>
      <span className={`rounded-full px-3 py-1 text-xs ring-1 ${phone === "blocked" ? "text-safe ring-safe/40" : phone === "idle" ? "text-muted ring-line" : "animate-ring-alert text-fraud ring-fraud/50"}`}>
        {t(`demo.state_${phone}`)}
      </span>
      <button type="button" onClick={trigger} className="rounded-lg bg-fraud px-4 py-2 text-sm font-semibold text-white hover:bg-fraud/85">
        {t("demo.trigger")}
      </button>
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        className="rounded-lg border border-line px-4 py-2 text-sm hover:border-gold/60 hover:text-gold-soft disabled:opacity-50"
      >
        {t("demo.reset")}
      </button>
      {offline && <p className="w-full text-xs text-suspicious">{t("demo.bus_offline")}</p>}
    </section>
  );
}
