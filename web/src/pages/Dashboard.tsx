import type { ScanResult } from "@shared/contract";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { IconAlert, IconClock, IconPhone, IconRadar, IconShield } from "../components/Icons";
import { CountUp, Kpi, PageHeader, SectionTitle } from "../components/ui";
import { SourceBadge, verdictColor } from "../components/VerdictBadge";
import { hostOf, medianHours } from "../lib/display";
import { relativeTime } from "../lib/format";
import { useBrands } from "../lib/useBrands";
import { useCases } from "../lib/useCases";

const isFresh = (scan: ScanResult) => Date.now() - Date.parse(scan.scanned_at) < 3 * 60_000;

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [params] = useSearchParams();
  const highlight = params.get("highlight");
  const { brandName } = useBrands();
  const { scans, stats, failed } = useCases();

  const flagged = scans.filter((s) => s.verdict !== "safe");
  const fraudCount = scans.filter((s) => s.verdict === "fraud").length;
  const suspiciousCount = flagged.length - fraudCount;
  const beforeReport = flagged.filter((s) => s.discovered_by !== "user").length;
  const median = medianHours(scans);

  const feed = [...flagged]
    .sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen))
    .filter((s, i, list) => list.findIndex((o) => hostOf(o) === hostOf(s)) === i)
    .slice(0, 8);

  const rows = new Map<string, { name: string; fraud: number; suspicious: number }>();
  for (const s of flagged) {
    if (!s.impersonated_brand) continue;
    const row = rows.get(s.impersonated_brand) ?? { name: brandName(s.impersonated_brand) ?? s.impersonated_brand, fraud: 0, suspicious: 0 };
    row[s.verdict as "fraud" | "suspicious"] += 1;
    rows.set(s.impersonated_brand, row);
  }
  const byBrand = [...rows.values()].sort((a, b) => b.fraud + b.suspicious - (a.fraud + a.suspicious));

  return (
    <div className="space-y-8">
      <PageHeader page="overview" criteria={["early", "explain"]} />
      {failed && <p className="panel p-3 text-fraud">{t("error.load")}</p>}

      {stats && (
        <section className={`grid grid-cols-2 gap-4 ${median === null ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
          <Kpi icon={<IconRadar />} label={t("ops.kpi_scans")} value={<CountUp value={scans.length} lang={lang} />} />
          <Kpi
            icon={<IconAlert />}
            label={t("ops.kpi_fraud")}
            value={<CountUp value={fraudCount} lang={lang} />}
            hint={t("ops.kpi_suspicious", { count: suspiciousCount })}
            tone="text-fraud"
            delay={60}
          />
          <Kpi icon={<IconShield />} label={t("ops.kpi_before_report")} value={<CountUp value={beforeReport} lang={lang} />} tone="text-cyber" delay={120} />
          <Kpi icon={<IconPhone />} label={t("ops.kpi_fake_helplines")} value={<CountUp value={stats.fake_helplines} lang={lang} />} tone="text-suspicious" delay={180} />
          {median !== null && (
            <Kpi
              icon={<IconClock />}
              label={t("ops.kpi_median_detect")}
              value={
                median < 1
                  ? t("ops.minutes", { count: Math.max(1, Math.round(median * 60)) })
                  : median < 48
                    ? t("ops.hours", { count: Math.round(median) })
                    : t("ops.days", { count: Math.round(median / 24) })
              }
              hint={t("ops.kpi_median_hint")}
              tone="text-cyber"
              delay={240}
            />
          )}
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-5">
        <div data-tour="feed" className="panel p-5 lg:col-span-2">
          <SectionTitle
            aside={
              <span className="flex items-center gap-1.5 text-xs text-safe">
                <span className="size-2 animate-pulse-dot rounded-full bg-safe" />
                {t("ops.live")}
              </span>
            }
          >
            {t("ops.feed")}
          </SectionTitle>
          <ul className="space-y-2">
            {feed.map((scan, index) => (
              <li key={scan.id} className="animate-fade-up" style={{ animationDelay: `${index * 50}ms` }}>
                <Link
                  to={`/cases/${scan.id}`}
                  className={`flex items-center gap-3 rounded-lg border border-line bg-bg/40 px-3 py-2.5 transition hover:border-gold/50 ${
                    scan.id === highlight || isFresh(scan) ? "animate-ring-alert border-fraud/60" : ""
                  }`}
                >
                  <span
                    className="h-9 w-1 shrink-0 rounded-full"
                    style={{ background: verdictColor[scan.verdict], boxShadow: `0 0 10px ${verdictColor[scan.verdict]}` }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm" dir="ltr">
                      {hostOf(scan)}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <SourceBadge source={scan.discovered_by} />
                      {brandName(scan.impersonated_brand) && <span>{brandName(scan.impersonated_brand)}</span>}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block text-lg font-bold tabular-nums" style={{ color: verdictColor[scan.verdict] }}>
                      {scan.score}
                    </span>
                    <span className="block text-[11px] text-muted">{relativeTime(scan.first_seen, lang)}</span>
                  </span>
                </Link>
              </li>
            ))}
            {feed.length === 0 && <li className="text-sm text-muted">{t("ops.feed_empty")}</li>}
          </ul>
        </div>

        <div className="panel p-5 lg:col-span-3">
          <SectionTitle>{t("ops.by_brand")}</SectionTitle>
          <div className="h-96" dir="ltr">
            {byBrand.length > 0 ? (
              <ResponsiveContainer>
                <BarChart data={byBrand} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" allowDecimals={false} stroke="#8797b0" fontSize={11} />
                  <YAxis type="category" dataKey="name" width={120} stroke="#8797b0" fontSize={12} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={{ background: "#0b1422", border: "1px solid #1b2a40", borderRadius: 10 }} />
                  <Bar dataKey="fraud" name={t("verdict.fraud")} stackId="v" fill="#ff4d5e" />
                  <Bar dataKey="suspicious" name={t("verdict.suspicious")} stackId="v" fill="#f2a93b" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted">{t("ops.no_data")}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
