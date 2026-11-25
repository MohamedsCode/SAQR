import type { ScanResult } from "@shared/contract";
import { Trans, useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Bars, Card, CountUp } from "../components/ui";
import VerdictBadge, { verdictColor } from "../components/VerdictBadge";
import { hostOf, medianHours } from "../lib/display";
import { number, relativeTime } from "../lib/format";
import { useBrands } from "../lib/useBrands";
import { useCases } from "../lib/useCases";

const isFresh = (scan: ScanResult) => Date.now() - Date.parse(scan.scanned_at) < 3 * 60_000;

/** Hours between a domain's registration and SAQR first seeing it, or null without a registration date. */
function lagHours(scan: ScanResult): number | null {
  const created = scan.evidence.rdap?.created;
  if (!created) return null;
  return Math.max(0, (Date.parse(scan.first_seen) - Date.parse(created)) / 3_600_000);
}

function useLagLabel() {
  const { t, i18n } = useTranslation();
  return (hours: number) =>
    hours < 1
      ? t("ops.lag_m", { n: number(Math.max(1, Math.round(hours * 60)), i18n.language) })
      : hours < 48
        ? t("ops.lag_h", { n: number(hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours), i18n.language) })
        : t("ops.lag_d", { n: number(Math.round(hours / 24), i18n.language) });
}

/** The thesis of SAQR: each scam site on a line from registration to the moment SAQR caught it. */
function SeenFirst({ scans }: { scans: ScanResult[] }) {
  const { t } = useTranslation();
  const { brandName } = useBrands();
  const lagLabel = useLagLabel();
  const flagged = scans.filter((s) => s.verdict !== "safe");
  const caught = flagged.filter((s) => s.discovered_by !== "user").length;
  const median = medianHours(scans);
  const rows = flagged
    .map((scan) => ({ scan, lag: lagHours(scan) }))
    .filter((r): r is { scan: ScanResult; lag: number } => r.lag !== null)
    .sort((a, b) => a.lag - b.lag)
    .slice(0, 5);
  const max = Math.max(1, ...rows.map((r) => r.lag));

  return (
    <section data-tour="seen-first" className="relative overflow-hidden rounded-[28px] bg-ink text-white shadow-[0_30px_60px_-30px_rgb(10_23_20/0.7)]">
      <div className="eye-rings pointer-events-none absolute -end-48 -top-56 size-[620px]" />
      <div className="relative grid gap-10 p-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:p-10">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em]">
            <span className="text-white/45">{t("pages.overview.title")}</span>
            <span className="text-white/25">/</span>
            <span className="text-brass">{t("ops.hero_eyebrow")}</span>
          </div>
          <h1 className="mt-5 text-[34px] font-semibold leading-[1.1] text-white lg:text-[37px]">
            <Trans i18nKey="ops.hero_title" values={{ caught, total: flagged.length }} components={{ b: <span className="text-brass" /> }} />
          </h1>
          {median !== null && <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/60">{t("ops.hero_sub", { median: lagLabel(median) })}</p>}
          <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 pt-8 text-[12px] text-white/50">
            <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-white/35" />{t("ops.legend_registered")}</span>
            <span className="flex items-center gap-2"><span className="size-2 rotate-45 bg-brass" />{t("ops.legend_saqr")}</span>
            <span className="flex items-center gap-2"><span className="size-2 rounded-full border border-white/70" />{t("ops.legend_citizen")}</span>
          </div>
        </div>

        <ol className="space-y-5 self-center">
          {rows.map(({ scan, lag }, i) => {
            const x = 8 + Math.sqrt(lag / max) * 70;
            const citizen = scan.discovered_by === "user";
            return (
              <li key={scan.id}>
                <Link to={`/cases/${scan.id}`} className="group block">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="font-data truncate text-[13px] text-white/85 transition group-hover:text-white" dir="ltr">
                      {hostOf(scan)}
                    </span>
                    <span className="shrink-0 text-[12px] text-white/40">{brandName(scan.impersonated_brand) ?? t(`source.${scan.discovered_by}`)}</span>
                  </div>
                  <div className="relative h-4">
                    <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
                    <span
                      className="animate-grow-x absolute start-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full"
                      style={{
                        width: `${x}%`,
                        background: citizen ? "rgb(255 255 255 / 0.4)" : "linear-gradient(90deg, rgb(255 255 255 / 0.15), #c9a04a)",
                        animationDelay: `${300 + i * 110}ms`,
                      }}
                    />
                    <span className="absolute start-0 top-1/2 size-2 -translate-y-1/2 rounded-full bg-white/35" />
                    <span className="absolute top-1/2 -translate-y-1/2" style={{ insetInlineStart: `calc(${x}% - 6px)` }}>
                      {citizen ? (
                        <span className="block size-3 rounded-full border-2 border-white/80 bg-ink" />
                      ) : (
                        <span
                          className="diamond-in block size-3 bg-brass shadow-[0_0_14px_3px_rgb(201_160_74/0.55)]"
                          style={{ animationDelay: `${800 + i * 110}ms` }}
                        />
                      )}
                    </span>
                    <span
                      className="font-data absolute top-1/2 -translate-y-1/2 whitespace-nowrap ps-4 text-[12px] font-medium"
                      style={{ insetInlineStart: `${x}%`, color: citizen ? "rgb(255 255 255 / 0.6)" : "#c9a04a" }}
                    >
                      {lagLabel(lag)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
          {rows.length === 0 && <li className="text-sm text-white/50">{t("ops.hero_none")}</li>}
        </ol>
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [params] = useSearchParams();
  const highlight = params.get("highlight");
  const { brandName } = useBrands();
  const { scans, stats, failed } = useCases();

  const flagged = scans.filter((s) => s.verdict !== "safe");
  const fraudCount = scans.filter((s) => s.verdict === "fraud").length;
  const feed = [...flagged].sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen)).slice(0, 6);

  const counts = new Map<string, { fraud: number; suspicious: number }>();
  for (const s of flagged) {
    if (!s.impersonated_brand) continue;
    const row = counts.get(s.impersonated_brand) ?? { fraud: 0, suspicious: 0 };
    row[s.verdict as "fraud" | "suspicious"] += 1;
    counts.set(s.impersonated_brand, row);
  }
  const byBrand = [...counts.entries()]
    .map(([id, c]) => ({ label: brandName(id) ?? id, value: c.fraud + c.suspicious, color: c.fraud ? "#b42318" : "#b45309" }))
    .sort((a, b) => b.value - a.value);

  const strip: { label: string; value: number; tone?: string }[] = stats
    ? [
        { label: t("ops.kpi_scans"), value: scans.length },
        { label: t("ops.kpi_fraud"), value: fraudCount, tone: "text-fraud" },
        { label: t("ops.kpi_fake_helplines"), value: stats.fake_helplines, tone: "text-suspicious" },
        { label: t("ops.kpi_brands"), value: counts.size },
      ]
    : [];

  return (
    <div className="space-y-6">
      {failed && <p className="text-fraud">{t("error.load")}</p>}
      <SeenFirst scans={scans} />

      {strip.length > 0 && (
        <section data-tour="kpis" className="card grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x rtl:lg:divide-x-reverse">
          {strip.map((s, i) => (
            <div key={s.label} className="animate-fade-up px-6 py-5" style={{ animationDelay: `${120 + i * 70}ms` }}>
              <div className="text-[13px] text-muted">{s.label}</div>
              <div className={`font-display mt-1.5 text-[34px] font-semibold leading-none tabular-nums ${s.tone ?? "text-text"}`}>
                <CountUp value={s.value} lang={lang} />
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          tour="feed"
          className="lg:col-span-2"
          bodyClass="px-3 pb-3 pt-2"
          title={t("ops.feed")}
          aside={
            <span className="flex items-center gap-2 rounded-full bg-safe/10 px-2.5 py-1 text-xs font-semibold text-safe">
              <span className="relative grid size-2 place-items-center">
                <span className="animate-ping-soft absolute size-2 rounded-full bg-safe" />
                <span className="size-1.5 rounded-full bg-safe" />
              </span>
              {t("ops.live")}
            </span>
          }
        >
          <ul>
            {feed.map((scan, i) => (
              <li key={scan.id} className="animate-fade-up" style={{ animationDelay: `${200 + i * 50}ms` }}>
                <Link
                  to={`/cases/${scan.id}`}
                  className={`group flex items-center gap-4 rounded-xl px-3 py-3 transition hover:bg-slate-50 ${scan.id === highlight || isFresh(scan) ? "animate-ring-alert" : ""}`}
                >
                  <span
                    className="font-display grid size-11 shrink-0 place-items-center rounded-xl text-[15px] font-bold tabular-nums"
                    style={{ background: `${verdictColor[scan.verdict]}12`, color: verdictColor[scan.verdict] }}
                  >
                    {scan.score}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold" dir="ltr">
                      {hostOf(scan)}
                    </span>
                    <span className="text-[13px] text-muted">
                      {[brandName(scan.impersonated_brand), t(`source.${scan.discovered_by}`)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <VerdictBadge verdict={scan.verdict} />
                  <span className="hidden w-24 text-end text-[13px] text-muted sm:block">{relativeTime(scan.first_seen, lang)}</span>
                  <span className="text-muted/40 transition group-hover:translate-x-0.5 group-hover:text-gold rtl:rotate-180">›</span>
                </Link>
              </li>
            ))}
            {feed.length === 0 && <li className="px-3 py-4 text-sm text-muted">{t("ops.feed_empty")}</li>}
          </ul>
          <Link to="/cases" className="mx-3 mt-1 inline-block py-2 text-sm font-semibold text-gold hover:underline">
            {t("ops.all_cases")} →
          </Link>
        </Card>

        <Card title={t("ops.by_brand")} subtitle={t("ops.by_brand_hint")}>
          {byBrand.length ? <Bars rows={byBrand} /> : <p className="text-sm text-muted">{t("ops.no_data")}</p>}
          <div className="mt-6 flex gap-4 border-t border-line pt-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-fraud" />{t("verdict.fraud")}</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-suspicious" />{t("verdict.suspicious")}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
