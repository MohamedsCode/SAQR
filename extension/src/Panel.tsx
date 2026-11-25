import { FRAUD_MIN, SUSPICIOUS_MIN, verdictFor, type Reason, type Verdict } from "@shared/contract";
import markDark from "@shared/logo/saqr-mark.png";
import { type ReactNode, useEffect, useState } from "react";
import { STRINGS } from "./i18n";
import type { PanelStatus } from "./messages";

type Key = keyof (typeof STRINGS)["en"];
const EN = STRINGS.en;
const AR = STRINGS.ar;
const CHECK_PAGE = "https://saqr-nu.vercel.app/check";

const TONE: Record<Verdict, { label: Key; body: Key; ink: string; tint: string; bar: string }> = {
  safe: { label: "panelSafe", body: "panelSafeBody", ink: "text-[#1f7a52]", tint: "bg-[#eaf6ef]", bar: "bg-[#2f9e6e]" },
  suspicious: {
    label: "panelSuspicious", body: "panelSuspiciousBody", ink: "text-[#94600f]", tint: "bg-[#fdf3e0]", bar: "bg-[#f0a92e]",
  },
  fraud: { label: "panelFraud", body: "panelFraudBody", ink: "text-[#b42318]", tint: "bg-[#fdecea]", bar: "bg-[#d0392b]" },
};

/** English with the Arabic underneath, each in its own direction. */
function Pair({ en, ar, className = "" }: { en: ReactNode; ar: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p lang="en" dir="ltr">{en}</p>
      <p lang="ar" dir="rtl">{ar}</p>
    </div>
  );
}

const pair = (key: Key, className?: string) => <Pair en={EN[key]} ar={AR[key]} className={className} />;

/** Three zones (safe, suspicious, fraud) with a marker at the score. The zone the score falls in is solid. */
function Meter({ score }: { score: number | null }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (score === null) return;
    const frame = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(frame);
  }, [score]);
  const verdict = score === null ? null : verdictFor(score);
  const zones: [Verdict, number][] = [
    ["safe", SUSPICIOUS_MIN],
    ["suspicious", FRAUD_MIN - SUSPICIOUS_MIN],
    ["fraud", 100 - FRAUD_MIN],
  ];
  return (
    <div className="relative mt-3 h-6" role="meter" aria-valuemin={0} aria-valuemax={100}
         aria-valuenow={score ?? undefined} aria-label={`${EN.riskScore} / ${AR.riskScore}`}>
      <div className="absolute inset-x-0 top-2 flex h-2 gap-[3px]">
        {zones.map(([zone, width]) => (
          <div key={zone} style={{ width: `${width}%` }}
               className={`h-full rounded-full ${TONE[zone].bar} ${verdict === zone ? "" : "opacity-30"} ${
                 score === null ? "animate-pulse" : ""}`} />
        ))}
      </div>
      {score !== null && (
        <div style={{ left: `${shown}%` }}
             className="absolute top-0 h-6 w-6 -translate-x-1/2 rounded-full border-[3px] border-white bg-[#1f2933] shadow-md transition-[left] duration-700 ease-out motion-reduce:transition-none" />
      )}
    </div>
  );
}

function Header({ domain }: { domain?: string }) {
  return (
    <header className="flex items-center gap-2.5">
      <img src={markDark} alt="" width={36} height={36} className="h-9 w-9" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold leading-tight">
          {EN.product} <span lang="ar">{AR.product}</span>
        </p>
        {domain && <p dir="ltr" className="truncate text-xs text-[#52606d]" title={domain}>{domain}</p>}
      </div>
    </header>
  );
}

/** What the engine found, strongest first; for safe sites, the official-site confirmation if there is one. */
function findings(reasons: Reason[], verdict: Verdict): Reason[] {
  if (verdict === "safe") return reasons.filter((r) => r.code === "OFFICIAL_DOMAIN" || r.code === "GOV_AE_DOMAIN");
  return reasons.filter((r) => r.weight > 0 && r.code !== "ML_MODEL").sort((a, b) => b.weight - a.weight).slice(0, 3);
}

function Result({ score, reasons }: { score: number; reasons: Reason[] }) {
  const verdict = verdictFor(score);
  const tone = TONE[verdict];
  const found = findings(reasons, verdict);
  return (
    <>
      <section className={`mt-4 rounded-xl p-4 ${tone.tint}`}>
        <div className="flex items-start justify-between gap-3">
          <Pair en={EN[tone.label]} ar={AR[tone.label]} className={`text-lg font-bold leading-snug ${tone.ink}`} />
          <p className="shrink-0 text-right">
            <span className={`text-2xl font-bold ${tone.ink}`}>{score}</span>
            <span className="text-sm text-[#52606d]">/100</span>
          </p>
        </div>
        <Meter score={score} />
        <p className="mt-1 text-xs text-[#52606d]">
          {EN.riskScore} · <span lang="ar">{AR.riskScore}</span>
        </p>
      </section>
      {pair(tone.body, "mt-3 text-sm")}
      {found.length > 0 && (
        <section className="mt-3">
          {verdict !== "safe" && pair("panelFound", "text-xs font-semibold uppercase tracking-wide text-[#52606d]")}
          <ul className="mt-1.5 space-y-2 text-sm">
            {found.map((r) => (
              <li key={r.code} className="flex gap-2">
                <span aria-hidden="true" className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${tone.bar}`} />
                <Pair en={r.en} ar={r.ar} className="flex-1" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function Panel({ status }: { status: PanelStatus | null }) {
  const domain = status && status.kind !== "skipped" ? status.domain : undefined;
  return (
    <main dir="ltr" className="saqr-root w-[340px] bg-white p-4 text-[#1f2933]">
      <Header domain={domain} />
      {status === null && (
        <section className="mt-4 rounded-xl bg-[#f3f5f7] p-4">
          {pair("panelChecking", "text-sm font-semibold")}
          <Meter score={null} />
        </section>
      )}
      {status?.kind === "result" && <Result score={status.score} reasons={status.reasons} />}
      {status?.kind === "error" && (
        <section className="mt-4 rounded-xl bg-[#f3f5f7] p-4">
          {pair("errorTitle", "font-semibold")}
          {pair("errorBody", "mt-2 text-sm")}
        </section>
      )}
      {status?.kind === "skipped" && (
        <section className="mt-4 rounded-xl bg-[#f3f5f7] p-4">
          {pair("skippedTitle", "font-semibold")}
          {pair("skippedBody", "mt-2 text-sm")}
        </section>
      )}
      <a href={CHECK_PAGE} target="_blank" rel="noreferrer"
         className="saqr-focus-dark mt-4 flex items-center justify-between rounded-lg border border-[#d9dee3] px-3 py-2 text-sm font-semibold hover:bg-[#f3f5f7]">
        <span>{EN.checkAnother}</span>
        <span lang="ar" dir="rtl">{AR.checkAnother}</span>
      </a>
    </main>
  );
}
