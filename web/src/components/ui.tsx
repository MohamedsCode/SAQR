import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { number } from "../lib/format";

export type Criterion = "accuracy" | "early" | "explain" | "uae" | "feasibility";

/** Title, one plain sentence, and the judging criteria the page proves. */
export function PageHeader({ page, criteria, aside }: { page: string; criteria: Criterion[]; aside?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold">{t(`pages.${page}.title`)}</h1>
        <p className="mt-1.5 text-text/80">{t(`pages.${page}.lead`)}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {criteria.map((c) => (
            <span key={c} className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[11px] font-semibold text-gold-soft ring-1 ring-gold/40">
              {t(`tour.criteria.${c}`)}
            </span>
          ))}
        </div>
      </div>
      {aside}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-soft">{children}</h2>
      {aside}
    </div>
  );
}

export function CountUp({ value, lang }: { value: number; lang: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const decimals = Number.isInteger(value) ? 0 : 1;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 1100);
      setShown(Number((value * (1 - Math.pow(1 - progress, 3))).toFixed(decimals)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{number(shown, lang)}</>;
}

export function Kpi({
  icon,
  label,
  value,
  hint,
  tone = "text-gold-soft",
  delay = 0,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: string;
  delay?: number;
}) {
  return (
    <div className="panel animate-fade-up p-4" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between">
        <span className={`grid size-9 place-items-center rounded-lg bg-white/5 ring-1 ring-line ${tone}`}>{icon}</span>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      <div className={`mt-3 text-3xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}

export const selectClass =
  "rounded-lg border border-line bg-panel px-3 py-2 text-sm text-text focus:border-gold/60 focus:outline-none";
