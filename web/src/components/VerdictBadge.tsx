import type { DiscoveredBy, Verdict } from "@shared/contract";
import { useTranslation } from "react-i18next";

const verdictStyles: Record<Verdict, string> = {
  safe: "bg-safe/12 text-safe ring-safe/40",
  suspicious: "bg-suspicious/12 text-suspicious ring-suspicious/40",
  fraud: "bg-fraud/15 text-fraud ring-fraud/50",
};

export const verdictText: Record<Verdict, string> = {
  safe: "text-safe",
  suspicious: "text-suspicious",
  fraud: "text-fraud",
};

export const verdictColor: Record<Verdict, string> = {
  safe: "#2fbf71",
  suspicious: "#f2a93b",
  fraud: "#ff4d5e",
};

export default function VerdictBadge({ verdict, large = false }: { verdict: Verdict; large?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-wide ring-1 ${verdictStyles[verdict]} ${
        large ? "px-3.5 py-1 text-sm" : "px-2.5 py-0.5 text-[11px]"
      }`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {t(`verdict.${verdict}`)}
    </span>
  );
}

const sourceStyles: Record<DiscoveredBy, string> = {
  user: "text-sky-300 ring-sky-400/30 bg-sky-400/10",
  lookalike: "text-violet-300 ring-violet-400/30 bg-violet-400/10",
  crtsh: "text-gold-soft ring-gold/40 bg-gold/10",
  maps_sweep: "text-emerald-300 ring-emerald-400/30 bg-emerald-400/10",
  search_sweep: "text-teal-300 ring-teal-400/30 bg-teal-400/10",
  graph_expansion: "text-pink-300 ring-pink-400/30 bg-pink-400/10",
  batch: "text-slate-300 ring-slate-400/30 bg-slate-400/10",
};

export function SourceBadge({ source }: { source: DiscoveredBy }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${sourceStyles[source]}`}>
      {t(`source.${source}`)}
    </span>
  );
}
