import type { DiscoveredBy, ScanResult, Stats, Verdict } from "@shared/contract";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useDataMode } from "../api";
import DemoPanel from "../components/DemoPanel";
import { IconAlert, IconClock, IconPhone, IconRadar, IconSearch, IconShield } from "../components/Icons";
import VerdictBadge, { SourceBadge, verdictColor } from "../components/VerdictBadge";
import { number, relativeTime } from "../lib/format";
import { useBrands } from "../lib/useBrands";

const POLL_MS = 4000;
const CATEGORY_COLORS = ["#d4a63c", "#ff4d5e", "#2bb673", "#7c8cff", "#f2a93b", "#38bdf8", "#e879f9"];

function Kpi({
  icon,
  label,
  value,
  hint,
  tone = "text-gold-soft",
  delay = 0,
}: {
  icon: ReactNode;
  label: string;
  value: string;
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

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-soft">{children}</h2>
      {aside}
    </div>
  );
}

const isFresh = (scan: ScanResult) => Date.now() - Date.parse(scan.scanned_at) < 3 * 60_000;

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const mode = useDataMode();
  const [params] = useSearchParams();
  const highlight = params.get("highlight");
  const { brandName } = useBrands();
  const [stats, setStats] = useState<Stats | null>(null);
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<Verdict | "">("");
  const [brand, setBrand] = useState("");
  const [source, setSource] = useState<DiscoveredBy | "">("");

  useEffect(() => {
    let active = true;
    const load = () =>
      Promise.all([api.stats(), api.scans()])
        .then(([s, list]) => {
          if (!active) return;
          setStats(s);
          setScans(list);
          setFailed(false);
        })
        .catch(() => active && setFailed(true));
    load();
    const id = mode === "live" ? setInterval(load, POLL_MS) : undefined;
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [mode]);

  useEffect(() => {
    if (highlight) document.getElementById(`case-${highlight}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight, scans.length]);

  const feed = useMemo(
    () =>
      scans
        .filter((s) => s.verdict !== "safe")
        .sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen))
        .slice(0, 8),
    [scans],
  );

  const brandRows = new Map<string, { name: string; fraud: number; suspicious: number }>();
  for (const s of scans) {
    if (s.verdict === "safe" || !s.impersonated_brand) continue;
    const row = brandRows.get(s.impersonated_brand) ?? {
      name: brandName(s.impersonated_brand) ?? s.impersonated_brand,
      fraud: 0,
      suspicious: 0,
    };
    row[s.verdict] += 1;
    brandRows.set(s.impersonated_brand, row);
  }
  const byBrand = [...brandRows.values()].sort((a, b) => b.fraud + b.suspicious - (a.fraud + a.suspicious));

  const byCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of scans) {
      if (s.verdict === "safe") continue;
      const key = s.category ?? "other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([key, value]) => ({ name: t(`category.${key}`, { defaultValue: key }), value }));
  }, [scans, t]);

  const filtered = scans.filter((s) => {
    if (verdict && s.verdict !== verdict) return false;
    if (brand && s.impersonated_brand !== brand) return false;
    if (source && s.discovered_by !== source) return false;
    const q = query.trim().toLowerCase();
    return !q || s.registered_domain.includes(q) || s.input.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
  });

  const usedBrands = [...new Set(scans.map((s) => s.impersonated_brand).filter(Boolean))] as string[];
  const usedSources = [...new Set(scans.map((s) => s.discovered_by))];
  const selectClass = "rounded-lg border border-line bg-panel px-3 py-2 text-sm text-text focus:border-gold/60 focus:outline-none";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold">{t("ops.kicker")}</div>
          <h1 className="mt-1 text-3xl font-bold">{t("ops.title")}</h1>
        </div>
        <Link
          to="/scan"
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg hover:bg-gold-soft"
        >
          {t("ops.check_cta")}
        </Link>
      </div>

      {failed && <p className="panel p-3 text-fraud">{t("error.load")}</p>}

      <DemoPanel />

      {stats && (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Kpi icon={<IconRadar />} label={t("ops.kpi_scans")} value={number(stats.scans, lang)} delay={0} />
          <Kpi
            icon={<IconAlert />}
            label={t("ops.kpi_fraud")}
            value={number(stats.fraud_found, lang)}
            hint={t("ops.kpi_suspicious", { count: stats.suspicious_found })}
            tone="text-fraud"
            delay={60}
          />
          <Kpi
            icon={<IconShield />}
            label={t("ops.kpi_before_report")}
            value={number(stats.found_before_report, lang)}
            tone="text-cyber"
            delay={120}
          />
          <Kpi
            icon={<IconPhone />}
            label={t("ops.kpi_fake_helplines")}
            value={number(stats.fake_helplines, lang)}
            tone="text-suspicious"
            delay={180}
          />
          <Kpi
            icon={<IconClock />}
            label={t("ops.kpi_time_to_detect")}
            value={stats.avg_hours_to_detect === null ? "—" : number(stats.avg_hours_to_detect, lang)}
            hint={t("ops.kpi_time_hint")}
            delay={240}
          />
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-5">
        <div className="panel p-5 lg:col-span-2">
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
                      {scan.registered_domain}
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

        <div className="grid gap-6 lg:col-span-3 lg:grid-cols-5">
          <div className="panel p-5 lg:col-span-3">
            <SectionTitle>{t("ops.by_brand")}</SectionTitle>
            <div className="h-64" dir="ltr">
              {byBrand.length > 0 ? (
                <ResponsiveContainer>
                  <BarChart data={byBrand} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" allowDecimals={false} stroke="#8797b0" fontSize={11} />
                    <YAxis type="category" dataKey="name" width={110} stroke="#8797b0" fontSize={12} />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      contentStyle={{ background: "#0b1422", border: "1px solid #1b2a40", borderRadius: 10 }}
                    />
                    <Bar dataKey="fraud" name={t("verdict.fraud")} stackId="v" fill="#ff4d5e" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="suspicious" name={t("verdict.suspicious")} stackId="v" fill="#f2a93b" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted">{t("ops.no_data")}</p>
              )}
            </div>
          </div>
          <div className="panel p-5 lg:col-span-2">
            <SectionTitle>{t("ops.by_category")}</SectionTitle>
            <div className="h-44" dir="ltr">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3} stroke="none">
                    {byCategory.map((entry, index) => (
                      <Cell key={entry.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#0b1422", border: "1px solid #1b2a40", borderRadius: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {byCategory.map((entry, index) => (
                <li key={entry.name} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm" style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
                  <span className="flex-1 text-muted">{entry.name}</span>
                  <span className="tabular-nums">{entry.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <SectionTitle aside={<span className="text-xs text-muted">{t("ops.showing", { shown: filtered.length, total: scans.length })}</span>}>
          {t("ops.cases")}
        </SectionTitle>
        <div className="mb-4 flex flex-wrap gap-2">
          <label className="relative min-w-56 flex-1">
            <IconSearch className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ops.search")}
              className={`${selectClass} w-full ps-9`}
            />
          </label>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict | "")} className={selectClass}>
            <option value="">{t("ops.all_verdicts")}</option>
            {(["fraud", "suspicious", "safe"] as Verdict[]).map((v) => (
              <option key={v} value={v}>
                {t(`verdict.${v}`)}
              </option>
            ))}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className={selectClass}>
            <option value="">{t("ops.all_brands")}</option>
            {usedBrands.map((id) => (
              <option key={id} value={id}>
                {brandName(id) ?? id}
              </option>
            ))}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value as DiscoveredBy | "")} className={selectClass}>
            <option value="">{t("ops.all_sources")}</option>
            {usedSources.map((s) => (
              <option key={s} value={s}>
                {t(`source.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                {["col_case", "col_domain", "col_brand", "col_score", "col_verdict", "col_source", "col_first_seen"].map((key) => (
                  <th key={key} className="px-3 py-2.5 text-start font-medium">
                    {t(`ops.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((scan) => (
                <tr
                  key={scan.id}
                  id={`case-${scan.id}`}
                  onClick={() => navigate(`/cases/${scan.id}`)}
                  className={`cursor-pointer border-b border-line/60 transition hover:bg-white/[0.03] ${
                    scan.id === highlight ? "bg-fraud/10 outline outline-1 outline-fraud/60" : ""
                  }`}
                >
                  <td className="px-3 py-3 font-mono text-xs text-muted" dir="ltr">
                    {scan.id}
                  </td>
                  <td className="px-3 py-3 font-mono" dir="ltr">
                    {scan.registered_domain}
                    {scan.status === "offline" && (
                      <span className="ms-2 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">{t("ops.status_offline")}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">{brandName(scan.impersonated_brand) ?? "—"}</td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-line">
                        <span className="block h-full rounded-full" style={{ width: `${scan.score}%`, background: verdictColor[scan.verdict] }} />
                      </span>
                      <span className="tabular-nums">{scan.score}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <VerdictBadge verdict={scan.verdict} />
                  </td>
                  <td className="px-3 py-3">
                    <SourceBadge source={scan.discovered_by} />
                  </td>
                  <td className="px-3 py-3 text-muted">{relativeTime(scan.first_seen, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="py-6 text-center text-sm text-muted">{t("ops.no_match")}</p>}
        </div>
      </section>
    </div>
  );
}
