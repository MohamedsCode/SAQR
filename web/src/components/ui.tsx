import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { number } from "../lib/format";

/** Page title and one plain sentence saying what the page does. */
export function PageHeader({ page, aside }: { page: string; aside?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <h1 className="text-[28px] font-semibold leading-tight">{t(`pages.${page}.title`)}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{t(`pages.${page}.lead`)}</p>
      </div>
      {aside}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{children}</h2>
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
      const progress = Math.min(1, (now - start) / 900);
      setShown(Number((value * (1 - Math.pow(1 - progress, 3))).toFixed(decimals)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{number(shown, lang)}</>;
}

/** A plain large number with its label underneath. */
export function Kpi({ label, value, hint, tone = "text-text" }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="px-1">
      <div className={`text-4xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1 text-sm text-text">{label}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

export const selectClass =
  "rounded-lg border border-line bg-white px-3 py-2 text-sm text-text focus:border-gold focus:outline-none";

export const primaryButton =
  "rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-white hover:bg-gold/90 disabled:opacity-50";

export const secondaryButton =
  "rounded-lg border border-line bg-white px-4 py-2 text-sm text-text hover:border-gold hover:text-gold disabled:opacity-50";
