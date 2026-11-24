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
  safe: "#1b6e45",
  suspicious: "#b45309",
  fraud: "#b42318",
};

export default function VerdictBadge({ verdict, large = false }: { verdict: Verdict; large?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ${verdictStyles[verdict]} ${
        large ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {t(`verdict.${verdict}`)}
    </span>
  );
}

const sourceStyle = "text-muted bg-black/[0.04] ring-line";

export function SourceBadge({ source }: { source: DiscoveredBy }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${sourceStyle}`}>
      {t(`source.${source}`)}
    </span>
  );
}
