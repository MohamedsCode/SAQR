import type { Verdict } from "@shared/contract";
import { useTranslation } from "react-i18next";

const styles: Record<Verdict, string> = {
  safe: "bg-safe/10 text-safe ring-safe/30",
  suspicious: "bg-suspicious/10 text-suspicious ring-suspicious/30",
  fraud: "bg-fraud/10 text-fraud ring-fraud/30",
};

export default function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ring-1 ${styles[verdict]}`}>
      {t(`verdict.${verdict}`)}
    </span>
  );
}
