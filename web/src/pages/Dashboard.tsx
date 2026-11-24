import type { ScanResult } from "@shared/contract";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CountUp, Kpi, PageHeader, SectionTitle } from "../components/ui";
import VerdictBadge from "../components/VerdictBadge";
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
  const beforeReport = flagged.filter((s) => s.discovered_by !== "user").length;
  const median = medianHours(scans);

  const feed = [...flagged].sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen)).slice(0, 7);

  const rows = new Map<string, { name: string; fraud: number; suspicious: number }>();
  for (const s of flagged) {
    if (!s.impersonated_brand) continue;
    const row = rows.get(s.impersonated_brand) ?? { name: brandName(s.impersonated_brand) ?? s.impersonated_brand, fraud: 0, suspicious: 0 };
    row[s.verdict as "fraud" | "suspicious"] += 1;
    rows.set(s.impersonated_brand, row);
  }
  const byBrand = [...rows.values()].sort((a, b) => b.fraud + b.suspicious - (a.fraud + a.suspicious));

  return (
    <div className="space-y-10">
      <PageHeader page="overview" />
      {failed && <p className="text-fraud">{t("error.load")}</p>}

      {stats && (
        <section className="grid grid-cols-2 gap-y-6 border-y border-line py-6 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-line rtl:lg:divide-x-reverse">
          <Kpi label={t("ops.kpi_scans")} value={<CountUp value={scans.length} lang={lang} />} />
          <div className="lg:ps-6">
            <Kpi label={t("ops.kpi_fraud")} value={<CountUp value={fraudCount} lang={lang} />} tone="text-fraud" />
          </div>
          <div className="lg:ps-6">
            <Kpi label={t("ops.kpi_before_report")} value={<CountUp value={beforeReport} lang={lang} />} tone="text-gold" />
          </div>
          <div className="lg:ps-6">
            <Kpi label={t("ops.kpi_fake_helplines")} value={<CountUp value={stats.fake_helplines} lang={lang} />} />
          </div>
          {median !== null && (
            <div className="lg:ps-6">
              <Kpi
                label={t("ops.kpi_median_detect")}
                value={
                  median < 1
                    ? t("ops.minutes", { count: Math.max(1, Math.round(median * 60)) })
                    : median < 48
                      ? t("ops.hours", { count: Math.round(median) })
                      : t("ops.days", { count: Math.round(median / 24) })
                }
                tone="text-gold"
              />
            </div>
          )}
        </section>
      )}

      <div className="grid gap-12 lg:grid-cols-5">
        <section data-tour="feed" className="lg:col-span-3">
          <SectionTitle aside={<span className="flex items-center gap-1.5 text-xs text-muted"><span className="size-1.5 animate-pulse-dot rounded-full bg-safe" />{t("ops.live")}</span>}>
            {t("ops.feed")}
          </SectionTitle>
          <ul className="divide-y divide-line border-y border-line">
            {feed.map((scan) => (
              <li key={scan.id}>
                <Link
                  to={`/cases/${scan.id}`}
                  className={`flex items-center gap-4 px-1 py-3 hover:bg-black/[0.02] ${scan.id === highlight || isFresh(scan) ? "animate-ring-alert rounded-md" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[15px]" dir="ltr">
                      {hostOf(scan)}
                    </span>
                    <span className="text-sm text-muted">
                      {[brandName(scan.impersonated_brand), t(`source.${scan.discovered_by}`)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <VerdictBadge verdict={scan.verdict} />
                  <span className="w-24 text-end text-sm text-muted">{relativeTime(scan.first_seen, lang)}</span>
                </Link>
              </li>
            ))}
            {feed.length === 0 && <li className="py-3 text-sm text-muted">{t("ops.feed_empty")}</li>}
          </ul>
          <Link to="/cases" className="mt-3 inline-block text-sm font-medium text-gold hover:underline">
            {t("ops.all_cases")} →
          </Link>
        </section>

        <section className="lg:col-span-2">
          <SectionTitle>{t("ops.by_brand")}</SectionTitle>
          <div style={{ height: Math.max(220, byBrand.length * 44) }} dir="ltr">
            {byBrand.length > 0 ? (
              <ResponsiveContainer>
                <BarChart data={byBrand} layout="vertical" margin={{ left: 0, right: 12 }}>
                  <XAxis type="number" allowDecimals={false} stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={120} stroke="#374151" fontSize={13} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.03)" }} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8 }} />
                  <Bar dataKey="fraud" name={t("verdict.fraud")} stackId="v" fill="#b42318" barSize={18} />
                  <Bar dataKey="suspicious" name={t("verdict.suspicious")} stackId="v" fill="#d97706" barSize={18} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted">{t("ops.no_data")}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
