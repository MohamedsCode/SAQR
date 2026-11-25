import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { number } from "../lib/format";

/** Page title and one plain sentence saying what the page does. */
export function PageHeader({ page, aside }: { page: string; aside?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <h1 className="text-[30px] font-semibold leading-tight">{t(`pages.${page}.title`)}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{t(`pages.${page}.lead`)}</p>
      </div>
      {aside}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-[17px] font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

/** A white card with an optional header row (title, subtitle, something on the side). */
export function Card({
  title,
  subtitle,
  aside,
  children,
  className = "",
  bodyClass = "p-6",
  tour,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  tour?: string;
}) {
  return (
    <section data-tour={tour} className={`card overflow-hidden ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-6 pt-5">
          <div>
            <h2 className="text-[17px] font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {aside}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
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

const ACCENTS = {
  neutral: { dot: "bg-slate-400", tint: "from-slate-400/10" },
  fraud: { dot: "bg-fraud", tint: "from-fraud/10" },
  brand: { dot: "bg-gold", tint: "from-gold/10" },
  amber: { dot: "bg-suspicious", tint: "from-suspicious/10" },
} as const;

/** A KPI card: label, a large animated number, and an optional note. */
export function Kpi({
  label,
  value,
  hint,
  tone = "text-text",
  accent = "neutral",
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: string;
  accent?: keyof typeof ACCENTS;
  delay?: number;
}) {
  const a = ACCENTS[accent];
  return (
    <div
      className={`card animate-fade-up relative overflow-hidden bg-gradient-to-b ${a.tint} to-white to-60% px-5 pb-5 pt-4`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <span className={`size-2 rounded-full ${a.dot}`} />
        {label}
      </div>
      <div className={`mt-3 text-[34px] font-semibold leading-none tracking-tight tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Labelled horizontal bars with the count at the end; readable in both directions. */
export function Bars({ rows }: { rows: { label: ReactNode; value: number; color: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-4">
      {rows.map((row, i) => (
        <li key={i}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">{row.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-muted">{row.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="animate-grow-x h-full rounded-full"
              style={{ width: `${(row.value / max) * 100}%`, background: row.color, animationDelay: `${200 + i * 80}ms` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export const selectClass =
  "rounded-xl border border-line bg-white px-3 py-2 text-sm text-text shadow-sm transition focus:border-gold focus:outline-none";

export const primaryButton =
  "rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-gold/20 transition hover:-translate-y-px hover:bg-brand-dark hover:shadow-md disabled:translate-y-0 disabled:opacity-50";

export const secondaryButton =
  "rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-medium text-text shadow-sm transition hover:-translate-y-px hover:border-gold/50 hover:text-gold disabled:translate-y-0 disabled:opacity-50";
