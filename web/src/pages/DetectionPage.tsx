import type { DiscoveryRun } from "@shared/contract";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useDataMode } from "../api";
import { PageHeader, SectionTitle, primaryButton, selectClass } from "../components/ui";
import VerdictBadge, { SourceBadge } from "../components/VerdictBadge";
import { hostOf } from "../lib/display";
import { dateTime } from "../lib/format";
import { useBrands } from "../lib/useBrands";
import { useCases } from "../lib/useCases";

const DISCOVERY_SOURCES = new Set(["lookalike", "crtsh", "graph_expansion", "search_sweep"]);

export default function DetectionPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const mode = useDataMode();
  const { brands, brandName } = useBrands();
  const { scans } = useCases();
  const [brand, setBrand] = useState("adpolice");
  const [run, setRun] = useState<DiscoveryRun | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!run || run.status === "done") return;
    const id = setInterval(() => api.discoveryRun(run.id).then(setRun).catch(() => undefined), 1500);
    return () => clearInterval(id);
  }, [run]);

  async function start() {
    setError(false);
    try {
      setRun(await api.startDiscovery(brand));
    } catch {
      setError(true);
    }
  }

  const found = scans
    .filter((s) => DISCOVERY_SOURCES.has(s.discovered_by))
    .sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen));
  const lag = found
    .filter((s) => s.evidence.rdap?.created)
    .map((s) => ({
      host: hostOf(s),
      hours: Math.max(0, Math.round((Date.parse(s.first_seen) - Date.parse(s.evidence.rdap!.created!)) / 360_000) / 10),
    }))
    .sort((a, b) => a.hours - b.hours);

  return (
    <div className="space-y-6">
      <PageHeader page="detection" />

      <section className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">{t("detection.run_for")}</span>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className={selectClass}>
          {Object.values(brands).map((b) => (
            <option key={b.id} value={b.id}>
              {brandName(b.id)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={start}
          disabled={mode !== "live" || (run !== null && run.status === "running")}
          className={primaryButton}
        >
          {run?.status === "running" ? t("detection.running") : t("detection.run")}
        </button>
        {run && (
          <span className="text-sm text-muted">
            {t("detection.progress", { checked: run.candidates_checked, total: run.candidates_total, found: run.found_ids.length })}
            {run.simulated && <span className="ms-2 rounded bg-suspicious/15 px-2 py-0.5 text-xs text-suspicious">{t("detection.simulated")}</span>}
          </span>
        )}
        {error && <span className="text-sm text-fraud">{t("detection.error")}</span>}
      </section>

      {lag.length > 0 && (
        <section className="section">
          <SectionTitle>{t("detection.lag_title")}</SectionTitle>
          <div style={{ height: Math.max(140, lag.length * 34) }} dir="ltr">
            <ResponsiveContainer>
              <BarChart data={lag} layout="vertical" margin={{ left: 8, right: 24 }}>
                <XAxis type="number" unit="h" stroke="#6b7280" fontSize={11} />
                <YAxis type="category" dataKey="host" width={230} stroke="#6b7280" fontSize={11} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 10 }} formatter={(v) => `${v} h`} />
                <Bar dataKey="hours" name={t("detection.lag")} fill="#17644f" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-sm text-muted">
            <tr className="border-b border-line">
              {["domain", "brand", "source", "registered", "first_seen", "score", "verdict"].map((key) => (
                <th key={key} className="px-3 py-2.5 text-start font-medium">
                  {t(`detection.col_${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {found.map((scan) => (
              <tr key={scan.id} onClick={() => navigate(`/cases/${scan.id}`)} className="cursor-pointer border-b border-line/60 hover:bg-black/[0.03]">
                <td className="px-3 py-3 font-mono" dir="ltr">
                  {hostOf(scan)}
                </td>
                <td className="px-3 py-3">{brandName(scan.impersonated_brand) ?? "—"}</td>
                <td className="px-3 py-3">
                  <SourceBadge source={scan.discovered_by} />
                </td>
                <td className="px-3 py-3 text-muted">{dateTime(scan.evidence.rdap?.created, lang)}</td>
                <td className="px-3 py-3 text-muted">{dateTime(scan.first_seen, lang)}</td>
                <td className="px-3 py-3 tabular-nums">{scan.score}</td>
                <td className="px-3 py-3">
                  <VerdictBadge verdict={scan.verdict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {found.length === 0 && <p className="py-6 text-center text-sm text-muted">{t("detection.empty")}</p>}
      </section>
    </div>
  );
}
