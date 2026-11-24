import type { ScanResult } from "@shared/contract";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ApiError, NotInSamples, api, useDataMode } from "../api";
import { sampleScans } from "../data/fixtures";
import { IconAlert, IconCheck, IconMinus, IconSearch } from "../components/Icons";
import ScoreGauge from "../components/ScoreGauge";
import { PageHeader, primaryButton } from "../components/ui";
import VerdictBadge, { verdictColor } from "../components/VerdictBadge";
import { hostOf } from "../lib/display";
import { daysSince } from "../lib/format";
import { useBrands } from "../lib/useBrands";

type Tone = "ok" | "warn";
interface Check {
  key: string;
  tone: Tone;
  detail: string;
}

const LIVE_STEPS = ["address", "age", "dns", "certificate", "visit", "forms", "visual", "model"];
const STEP_MS = 550;
const IMPERSONATION = /^(BRAND_|LOOKALIKE_|HOMOGLYPH|TYPOSQUAT)/;

type T = (key: string, options?: Record<string, unknown>) => string;

/** The checks that actually ran, plus the ones that could not run (site offline or live checks off). */
function checksFor(scan: ScanResult, t: T, brand: string | null): { done: Check[]; skipped: string[]; note: string | null } {
  const ev = scan.evidence;
  const codes = new Set(scan.reasons.map((r) => r.code));
  const official = codes.has("ALLOWLIST_OFFICIAL");
  const model = scan.reasons.find((r) => r.code === "ML_MODEL");
  const visited = ev.redirect_chain.length > 0 || Boolean(ev.dns) || Boolean(ev.rdap);
  const done: Check[] = [];
  const skipped: string[] = [];

  done.push({ key: "address", tone: official || scan.score < 30 ? "ok" : "warn", detail: scan.normalized_url });

  const age = daysSince(ev.rdap?.created, scan.scanned_at);
  if (age !== null) done.push({ key: "age", tone: age < 30 ? "warn" : "ok", detail: t("scan.age_days", { count: age }) });
  else skipped.push("age");

  if (ev.dns) done.push({ key: "dns", tone: ev.dns.a.length ? "ok" : "warn", detail: ev.dns.a.length ? t("scan.dns_records", { count: ev.dns.a.length }) : t("scan.dns_none") });
  else skipped.push("dns");

  if (ev.tls) {
    const certAge = daysSince(ev.tls.first_seen_crtsh ?? ev.tls.not_before, scan.scanned_at);
    done.push({ key: "certificate", tone: certAge !== null && certAge < 30 ? "warn" : "ok", detail: [ev.tls.issuer, certAge !== null ? t("scan.age_days", { count: certAge }) : null].filter(Boolean).join(" · ") });
  } else skipped.push("certificate");

  if (scan.status === "live") {
    done.push({ key: "visit", tone: ev.cloaking?.detected ? "warn" : "ok", detail: ev.cloaking?.detected ? t("scan.cloaking") : t("scan.reached") });
    const asks = [...new Set(ev.forms.flatMap((f) => f.asks_for))];
    done.push({ key: "forms", tone: asks.length ? "warn" : "ok", detail: asks.length ? asks.map((k) => t(`field.${k}`, { defaultValue: k })).join(" · ") : t("scan.no_sensitive") });
  } else skipped.push("visit", "forms");

  if (ev.visual_similarity) {
    done.push({ key: "visual", tone: official ? "ok" : "warn", detail: t("scan.visual_match", { percent: Math.round(ev.visual_similarity.percent), brand: brand ?? "" }) });
  } else if ([...codes].some((c) => IMPERSONATION.test(c))) {
    done.push({ key: "visual", tone: "warn", detail: t("scan.imitates_in_address", { brand: brand ?? "" }) });
  } else if (scan.status === "live") {
    done.push({ key: "visual", tone: "ok", detail: t("scan.no_match") });
  }

  if (model) done.push({ key: "model", tone: model.weight > 0 ? "warn" : "ok", detail: t("scan.model_probability", { value: model.evidence ?? "" }) });

  let note: string | null = null;
  if (scan.status !== "live") {
    if (!visited) note = t("scan.address_only");
    else {
      const used = [t("scan.used_address"), ev.rdap ? t("scan.used_registration") : null, model ? t("scan.used_model") : null].filter(Boolean) as string[];
      note = t("scan.offline_note", { used: used.join(t("scan.list_join")) });
    }
  }
  return { done, skipped, note };
}

export default function ScanLink() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const mode = useDataMode();
  const { brandName } = useBrands();
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<"scan" | "no_url" | "not_sample" | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setActive((n) => Math.min(n + 1, LIVE_STEPS.length - 1)), STEP_MS);
    return () => clearInterval(id);
  }, [running]);

  async function check(text: string) {
    if (!text.trim() || running) return;
    setInput(text);
    setError(null);
    setResult(null);
    setActive(0);
    setRunning(true);
    const started = Date.now();
    try {
      const scan = await api.scan(text);
      await new Promise((r) => setTimeout(r, Math.max(0, 1800 - (Date.now() - started))));
      setResult(scan);
    } catch (exc) {
      if (exc instanceof NotInSamples) setError("not_sample");
      else if (exc instanceof ApiError && exc.status === 422) setError("no_url");
      else setError("scan");
    } finally {
      setRunning(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    check(input);
  }

  const brand = result ? brandName(result.evidence.visual_similarity?.brand_id ?? result.impersonated_brand) : null;
  const checks = result ? checksFor(result, t, brand) : null;
  const topReasons = result ? [...result.reasons].filter((r) => r.code !== "ML_MODEL").sort((a, b) => b.weight - a.weight).slice(0, 3) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader page="scan" />

      <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-xl border border-line bg-white p-2 focus-within:border-gold">
        <IconSearch className="ms-2 shrink-0 text-muted" size={20} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("scan.placeholder")}
          className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[17px] placeholder:text-muted/70 focus:outline-none"
          dir="auto"
          autoFocus
        />
        <button type="submit" disabled={running || !input.trim()} className={`${primaryButton} px-6 py-2.5 text-[15px]`}>
          {running ? t("scan.checking") : t("scan.check")}
        </button>
      </form>

      {mode === "sample" && !running && !result && (
        <div className="text-sm text-muted">
          {t("scan.try")}
          <div className="mt-2 flex flex-wrap gap-2">
            {sampleScans.map((s) => s.input.trim()).map((example) => (
              <button key={example} type="button" onClick={() => check(example)} className="rounded-full border border-line bg-white px-3 py-1 font-mono text-xs hover:border-gold" dir="ltr">
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-suspicious">{t(error === "not_sample" ? "scan.not_sample" : error === "no_url" ? "scan.no_url" : "error.scan")}</p>}

      {running && (
        <ol className="divide-y divide-line border-y border-line">
          {LIVE_STEPS.map((step, index) => (
            <li key={step} className={`flex items-center gap-3 py-2.5 ${index > active ? "opacity-40" : ""}`}>
              <span className="grid size-6 place-items-center">
                {index < active ? <IconCheck size={15} className="text-muted" /> : index === active ? <span className="size-3.5 animate-spin-slow rounded-full border-2 border-gold border-t-transparent" /> : null}
              </span>
              <span className="text-[15px]">{t(`scan.step_${step}`)}</span>
            </li>
          ))}
        </ol>
      )}

      {result && checks && (
        <div className="animate-fade-up space-y-8">
          <section className="flex flex-wrap items-center gap-8">
            <ScoreGauge score={result.score} verdict={result.verdict} size={190} />
            <div className="min-w-60 flex-1 space-y-2">
              <VerdictBadge verdict={result.verdict} large />
              <div className="break-all font-mono text-xl font-semibold" dir="ltr">
                {hostOf(result)}
              </div>
              <p className="text-[15px] leading-relaxed">{lang === "ar" ? result.summary_ar : result.summary_en}</p>
              {result.verdict !== "safe" && <p className="text-sm font-medium" style={{ color: verdictColor[result.verdict] }}>{t("scan.advice")}</p>}
            </div>
          </section>

          {checks.note && <p className="rounded-lg bg-black/[0.03] px-4 py-3 text-[15px]">{checks.note}</p>}

          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("scan.checks")}</h2>
            <ol className="divide-y divide-line border-y border-line">
              {checks.done.map((c) => (
                <li key={c.key} className="flex items-center gap-3 py-2.5">
                  <span className={`grid size-6 place-items-center ${c.tone === "warn" ? "text-fraud" : "text-safe"}`}>
                    {c.tone === "warn" ? <IconAlert size={15} /> : <IconCheck size={16} />}
                  </span>
                  <span className="flex-1 text-[15px]">{t(`scan.step_${c.key}`)}</span>
                  <span className={`max-w-[55%] truncate text-end text-sm ${c.tone === "warn" ? "text-fraud" : "text-muted"}`} dir={c.key === "address" ? "ltr" : undefined}>
                    {c.detail}
                  </span>
                </li>
              ))}
              {checks.skipped.length > 0 && (
                <li className="flex items-center gap-3 py-2.5 text-sm text-muted">
                  <span className="grid size-6 place-items-center">
                    <IconMinus size={14} />
                  </span>
                  {t("scan.not_run", { list: checks.skipped.map((k) => t(`scan.step_${k}`)).join(t("scan.list_join")) })}
                </li>
              )}
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("scan.top_reasons")}</h2>
            <ul className="space-y-2">
              {topReasons.map((reason) => (
                <li key={reason.code} className="flex items-start gap-3 text-[15px]">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full" style={{ background: verdictColor[result.verdict] }} />
                  <span className="flex-1">{lang === "ar" ? reason.ar : reason.en}</span>
                  {reason.weight !== 0 && <span className="text-sm tabular-nums text-muted">+{reason.weight}</span>}
                </li>
              ))}
            </ul>
            <Link to={`/cases/${result.id}`} className="mt-4 inline-block text-sm font-medium text-gold hover:underline">
              {t("scan.open_case")}
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}
