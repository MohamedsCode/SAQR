import committedMetrics from "../../../engine/model/metrics.json";
import type { ApproachMetrics, ModelInfo, Verdict } from "@shared/contract";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useDataMode } from "../api";
import { localized } from "../brand";
import { dateTime, number } from "../lib/format";

const RETRAIN_ENABLED = import.meta.env.VITE_ALLOW_RETRAIN === "1";
const APPROACH_COLORS: Record<ApproachMetrics["approach"], string> = { rules: "#8797b0", model: "#7c8cff", combined: "#d4a63c" };
const VERDICTS: Verdict[] = ["safe", "suspicious", "fraud"];
const tooltipStyle = { background: "#0b1422", border: "1px solid #1b2a40", borderRadius: 10 };

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function Card({ label, value, hint, tone = "text-gold-soft" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="panel animate-fade-up p-4">
      <div className={`text-3xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1 text-sm">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Section({ title, children, className = "", tour }: { title: string; children: ReactNode; className?: string; tour?: string }) {
  return (
    <section data-tour={tour} className={`panel p-5 ${className}`}>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-gold-soft">{title}</h2>
      {children}
    </section>
  );
}

export default function ModelPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const mode = useDataMode();
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [level, setLevel] = useState<"flagged" | "fraud">("flagged");
  const [log, setLog] = useState<string[]>([]);
  const [training, setTraining] = useState<"idle" | "running" | "done" | "failed">("idle");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api.model().then(setInfo).catch(() => setInfo(committedMetrics as unknown as ModelInfo));
  }, [mode]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  async function retrain() {
    setLog([]);
    setTraining("running");
    try {
      await api.retrain();
    } catch {
      setTraining("failed");
      return;
    }
    const source = new EventSource("/api/model/retrain/stream");
    source.onmessage = (event) => setLog((lines) => [...lines, event.data]);
    source.addEventListener("done", (event) => {
      source.close();
      const status = (event as MessageEvent).data === "done" ? "done" : "failed";
      setTraining(status);
      if (status === "done") api.model().then(setInfo).catch(() => undefined);
    });
    source.onerror = () => {
      source.close();
      setTraining((current) => (current === "running" ? "failed" : current));
    };
  }

  if (!info) return <div className="py-20 text-center text-muted">{t("model.loading")}</div>;
  if (!info.available) return <div className="panel p-8 text-center text-muted">{t("model.unavailable")}</div>;

  const combined = info.metrics.find((m) => m.approach === "combined")!;
  const current = combined[level];
  const comparison = (["precision", "recall", "f1"] as const).map((metric) => ({
    metric: t(`model.${metric}`),
    ...Object.fromEntries(info.metrics.map((m) => [m.approach, Math.round(m[level][metric] * 1000) / 10])),
  }));
  const confusionMax = Math.max(...info.confusion.map((c) => c.count));
  const cell = (label: "phishing" | "legit", verdict: Verdict) =>
    info.confusion.find((c) => c.label === label && c.verdict === verdict)?.count ?? 0;
  const features = [...info.top_features].sort((a, b) => b.importance - a.importance).slice(0, 15);
  const featureMax = Math.max(...features.map((f) => f.importance));
  const split = (name: "train" | "test") => info.datasets.find((d) => d.split === name);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold">{t("model.kicker")}</div>
          <h1 className="mt-1 text-3xl font-bold">{t("model.title")}</h1>
          <p className="mt-1 text-sm text-muted">
            {info.algorithm} · {t("model.features", { count: info.feature_count })} · {t("model.last_trained")}{" "}
            {dateTime(info.trained_at, lang)}
            {info.training_seconds !== null && ` · ${t("model.seconds", { value: number(info.training_seconds, lang) })}`}
          </p>
        </div>
        {RETRAIN_ENABLED ? (
          <button
            type="button"
            onClick={retrain}
            disabled={training === "running" || mode !== "live"}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg hover:bg-gold-soft disabled:opacity-50"
          >
            {training === "running" ? t("model.training") : t("model.retrain")}
          </button>
        ) : (
          <span className="max-w-xs text-end text-xs text-muted">{t("model.retrain_disabled")}</span>
        )}
      </div>

      <div className="flex gap-2">
        {(["flagged", "fraud"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setLevel(option)}
            className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${level === option ? "bg-gold/15 text-gold-soft ring-gold/40" : "text-muted ring-line hover:text-text"}`}
          >
            {t(`model.level_${option}`, { threshold: combined[option].threshold })}
          </button>
        ))}
      </div>

      <section data-tour="model-cards" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card label={t("model.precision")} value={pct(current.precision)} hint={t("model.test_split")} />
        <Card label={t("model.recall")} value={pct(current.recall)} hint={t("model.test_split")} />
        <Card label={t("model.f1")} value={pct(current.f1)} hint={t("model.test_split")} />
        <Card
          label={t("model.official_fp")}
          value={`${info.official_false_positives} / ${number(info.official_checked, lang)}`}
          hint={t("model.allowlist_fp", { fp: info.allowlist_false_positives, total: number(info.allowlist_checked, lang) })}
          tone={info.official_false_positives === 0 ? "text-safe" : "text-fraud"}
        />
        <Card
          label={t("model.dataset")}
          value={number((split("train")?.phishing ?? 0) + (split("train")?.legit ?? 0) + (split("test")?.phishing ?? 0) + (split("test")?.legit ?? 0), lang)}
          hint={t("model.dataset_hint", {
            train: number((split("train")?.phishing ?? 0) + (split("train")?.legit ?? 0), lang),
            test: number((split("test")?.phishing ?? 0) + (split("test")?.legit ?? 0), lang),
          })}
          tone="text-text"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("model.comparison")}>
          <div className="h-72" dir="ltr">
            <ResponsiveContainer>
              <BarChart data={comparison} margin={{ left: -10 }}>
                <CartesianGrid stroke="#1b2a40" vertical={false} />
                <XAxis dataKey="metric" stroke="#8797b0" fontSize={12} />
                <YAxis domain={[0, 100]} unit="%" stroke="#8797b0" fontSize={11} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {info.metrics.map((m) => (
                  <Bar key={m.approach} dataKey={m.approach} name={t(`model.approach_${m.approach}`)} fill={APPROACH_COLORS[m.approach]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title={t("model.confusion")}>
          <div className="grid grid-cols-[auto_repeat(3,1fr)] gap-2 text-center text-sm">
            <span />
            {VERDICTS.map((v) => (
              <span key={v} className="pb-1 text-xs uppercase tracking-wider text-muted">
                {t("model.predicted")} {t(`verdict.${v}`)}
              </span>
            ))}
            {(["phishing", "legit"] as const).map((label) => (
              <div key={label} className="contents">
                <span className="flex items-center pe-2 text-start text-xs uppercase tracking-wider text-muted">{t(`model.actual_${label}`)}</span>
                {VERDICTS.map((verdict) => {
                  const count = cell(label, verdict);
                  const correct = (label === "phishing") === (verdict !== "safe");
                  const color = correct ? "47 191 113" : "255 77 94";
                  return (
                    <div
                      key={verdict}
                      className="rounded-lg py-6 ring-1 ring-line"
                      style={{ background: `rgb(${color} / ${0.08 + (count / confusionMax) * 0.55})` }}
                    >
                      <div className="text-2xl font-bold tabular-nums">{number(count, lang)}</div>
                      <div className="text-[11px] text-text/70">{correct ? t("model.correct") : t("model.error")}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">{t("model.confusion_hint")}</p>
        </Section>
      </div>

      <Section title={t("model.importance")}>
        <ol className="space-y-2">
          {features.map((feature, index) => (
            <li key={feature.feature} className="grid grid-cols-[1.5rem_minmax(0,16rem)_1fr_3.5rem] items-center gap-3 text-sm">
              <span className="text-xs text-muted tabular-nums">{index + 1}</span>
              <span className="truncate" title={feature.feature}>
                {localized(lang, feature.en, feature.ar)}
              </span>
              <span className="h-2.5 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-gold/70 to-gold"
                  style={{ width: `${(feature.importance / featureMax) * 100}%` }}
                />
              </span>
              <span className="text-end text-xs tabular-nums text-muted">{(feature.importance * 100).toFixed(2)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted">{t("model.importance_hint")}</p>
      </Section>

      {training !== "idle" && (
        <Section title={t("model.log")}>
          <pre ref={logRef} className="max-h-80 overflow-auto rounded-lg bg-bg/80 p-4 font-mono text-xs leading-relaxed text-text/85" dir="ltr">
            {log.join("\n") || t("model.training")}
          </pre>
          {training === "done" && <p className="mt-2 text-sm text-safe">{t("model.done")}</p>}
          {training === "failed" && <p className="mt-2 text-sm text-fraud">{t("model.failed")}</p>}
        </Section>
      )}
    </div>
  );
}
