import type { ScanResult } from "@shared/contract";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ApiError, NotInSamples, api, useDataMode } from "../api";
import { localized } from "../brand";
import { sampleScans } from "../data/fixtures";
import { IconAlert, IconCheck, IconMinus, IconSearch, IconShieldCheck } from "../components/Icons";
import ScoreGauge from "../components/ScoreGauge";
import { PageHeader } from "../components/ui";
import VerdictBadge from "../components/VerdictBadge";
import { daysSince } from "../lib/format";
import { useBrands } from "../lib/useBrands";

type Tone = "ok" | "warn" | "skip";
interface StepOutcome {
  tone: Tone;
  detail: string;
}

const STEPS = ["address", "age", "dns", "certificate", "visit", "forms", "visual"] as const;
type Step = (typeof STEPS)[number];
const STEP_MS = 650;
const FINISH_MS = 220;

function outcomes(scan: ScanResult, t: (key: string, options?: Record<string, unknown>) => string, brand: string | null): Record<Step, StepOutcome> {
  const ev = scan.evidence;
  const age = daysSince(ev.rdap?.created, scan.scanned_at);
  const certAge = daysSince(ev.tls?.first_seen_crtsh ?? ev.tls?.not_before, scan.scanned_at);
  const asks = [...new Set(ev.forms.flatMap((f) => f.asks_for))];
  const official = scan.reasons.some((r) => r.code === "ALLOWLIST_OFFICIAL");
  return {
    address: { tone: official ? "ok" : scan.score >= 30 ? "warn" : "ok", detail: scan.normalized_url },
    age:
      age === null
        ? { tone: "skip", detail: t("scan.not_checked") }
        : { tone: age < 30 ? "warn" : "ok", detail: t("scan.age_days", { count: age }) },
    dns: !ev.dns
      ? { tone: "skip", detail: t("scan.not_checked") }
      : ev.dns.a.length
        ? { tone: "ok", detail: t("scan.dns_records", { count: ev.dns.a.length }) }
        : { tone: "warn", detail: t("scan.dns_none") },
    certificate: !ev.tls
      ? { tone: "skip", detail: t("scan.not_checked") }
      : { tone: certAge !== null && certAge < 30 ? "warn" : "ok", detail: `${ev.tls.issuer ?? "—"} · ${t("scan.age_days", { count: certAge ?? 0 })}` },
    visit:
      scan.status === "offline"
        ? { tone: "skip", detail: t("scan.offline") }
        : ev.cloaking?.detected
          ? { tone: "warn", detail: t("scan.cloaking") }
          : { tone: "ok", detail: t("scan.reached") },
    forms: asks.length
      ? { tone: "warn", detail: asks.map((k) => t(`field.${k}`, { defaultValue: k })).join(" · ") }
      : { tone: scan.status === "offline" ? "skip" : "ok", detail: t("scan.no_sensitive") },
    visual: ev.visual_similarity
      ? {
          tone: official ? "ok" : "warn",
          detail: t("scan.visual_match", { percent: Math.round(ev.visual_similarity.percent), brand: brand ?? "—" }),
        }
      : { tone: scan.status === "offline" ? "skip" : "ok", detail: t("scan.no_match") },
  };
}

const toneStyle: Record<Tone, string> = {
  ok: "text-safe ring-safe/40 bg-safe/10",
  warn: "text-fraud ring-fraud/50 bg-fraud/10",
  skip: "text-muted ring-line bg-white/5",
};

export default function ScanLink() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const mode = useDataMode();
  const { brandName } = useBrands();
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<"scan" | "no_url" | "not_sample" | null>(null);

  useEffect(() => {
    if (!running) return;
    if (revealed >= STEPS.length) {
      if (result) setRunning(false);
      return;
    }
    if (!result && revealed >= STEPS.length - 1) return;
    const id = setTimeout(() => setRevealed((n) => n + 1), result ? FINISH_MS : STEP_MS);
    return () => clearTimeout(id);
  }, [running, revealed, result]);

  async function check(text: string) {
    if (!text.trim() || running) return;
    setInput(text);
    setError(null);
    setResult(null);
    setRevealed(0);
    setRunning(true);
    try {
      const scan = await api.scan(text);
      setResult(scan);
    } catch (exc) {
      setRunning(false);
      setRevealed(0);
      if (exc instanceof NotInSamples) setError("not_sample");
      else if (exc instanceof ApiError && exc.status === 422) setError("no_url");
      else setError("scan");
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    check(input);
  }

  const done = result && !running;
  const steps = result ? outcomes(result, t, brandName(result.evidence.visual_similarity?.brand_id ?? result.impersonated_brand)) : null;
  const topReasons = result ? [...result.reasons].sort((a, b) => b.weight - a.weight).slice(0, 3) : [];
  const examples = sampleScans.map((s) => s.input.trim());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader page="scan" criteria={["accuracy", "explain"]} />

      <form onSubmit={onSubmit} className="panel flex items-center gap-2 p-2 glow-gold">
        <IconSearch className="ms-3 shrink-0 text-gold" size={22} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("scan.placeholder")}
          className="min-w-0 flex-1 bg-transparent px-2 py-3 text-lg placeholder:text-muted/70 focus:outline-none"
          dir="auto"
          autoFocus
        />
        <button
          type="submit"
          disabled={running || !input.trim()}
          className="rounded-lg bg-gold px-6 py-3 font-semibold text-bg hover:bg-gold-soft disabled:opacity-50"
        >
          {running ? t("scan.checking") : t("scan.check")}
        </button>
      </form>

      {mode === "sample" && !running && !result && (
        <div className="text-center text-sm text-muted">
          <span>{t("scan.try")}</span>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => check(example)}
                className="rounded-full border border-line px-3 py-1 font-mono text-xs hover:border-gold/60 hover:text-gold-soft"
                dir="ltr"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="panel border-suspicious/50 p-4 text-suspicious">
          {t(error === "not_sample" ? "check.not_sample" : error === "no_url" ? "check.no_url" : "error.scan")}
        </p>
      )}

      {(running || result) && (
        <section className="panel relative overflow-hidden p-5">
          {running && <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden"><div className="animate-sweep h-full w-1/2 bg-gradient-to-r from-transparent via-gold to-transparent" /></div>}
          <ol className="space-y-2">
            {STEPS.map((step, index) => {
              const state = index < revealed ? "done" : index === revealed && running ? "active" : "waiting";
              const outcome = state === "done" && steps ? steps[step] : null;
              return (
                <li
                  key={step}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 transition ${state === "active" ? "bg-gold/10" : ""} ${
                    state === "waiting" ? "opacity-40" : ""
                  }`}
                >
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full ring-1 ${
                      outcome ? toneStyle[outcome.tone] : state === "active" ? "text-gold ring-gold/50" : "text-muted ring-line"
                    }`}
                  >
                    {outcome?.tone === "ok" && <IconCheck size={15} />}
                    {outcome?.tone === "warn" && <IconAlert size={14} />}
                    {outcome?.tone === "skip" && <IconMinus size={14} />}
                    {state === "done" && !outcome && <IconCheck size={15} />}
                    {state === "active" && <span className="size-3.5 animate-spin-slow rounded-full border-2 border-gold border-t-transparent" />}
                  </span>
                  <span className="flex-1 font-medium">{t(`scan.step_${step}`)}</span>
                  {outcome && (
                    <span
                      className={`max-w-[55%] truncate text-end text-sm ${outcome.tone === "warn" ? "text-fraud" : "text-muted"}`}
                      dir={step === "address" ? "ltr" : undefined}
                    >
                      {outcome.detail}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {done && result && (
        <section
          className={`panel animate-fade-up p-6 ${
            result.verdict === "fraud" ? "glow-fraud" : result.verdict === "suspicious" ? "glow-suspicious" : "glow-safe"
          }`}
        >
          <div className="flex flex-wrap items-center gap-6">
            <ScoreGauge score={result.score} verdict={result.verdict} size={190} />
            <div className="min-w-60 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                {result.verdict === "safe" ? <IconShieldCheck className="text-safe" size={26} /> : <IconAlert className="text-fraud" size={24} />}
                <VerdictBadge verdict={result.verdict} large />
              </div>
              <div className="break-all font-mono text-lg" dir="ltr">
                {result.registered_domain}
              </div>
              <p className="text-text/90">{localized(lang, result.summary_en, result.summary_ar)}</p>
            </div>
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-2 text-xs uppercase tracking-[0.16em] text-gold-soft">{t("scan.top_reasons")}</div>
            <ul className="space-y-2">
              {topReasons.map((reason) => (
                <li key={reason.code} className="flex items-start gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" />
                  <span className="flex-1">{localized(lang, reason.en, reason.ar)}</span>
                  {reason.weight !== 0 && <span className="text-sm tabular-nums text-muted">+{reason.weight}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Link to={`/cases/${result.id}`} className="text-sm text-gold hover:underline">
              {t("scan.open_case")}
            </Link>
            {result.verdict !== "safe" && <span className="text-sm text-muted">{t("scan.advice")}</span>}
          </div>
        </section>
      )}

    </div>
  );
}
