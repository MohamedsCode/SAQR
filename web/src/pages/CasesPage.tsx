import type { DiscoveredBy, Verdict } from "@shared/contract";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { IconSearch } from "../components/Icons";
import { PageHeader, selectClass } from "../components/ui";
import VerdictBadge, { SourceBadge, verdictColor } from "../components/VerdictBadge";
import { hostOf } from "../lib/display";
import { relativeTime } from "../lib/format";
import { useBrands } from "../lib/useBrands";
import { useCases } from "../lib/useCases";

export default function CasesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const { brandName } = useBrands();
  const { scans, failed } = useCases();
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<Verdict | "">("");
  const [brand, setBrand] = useState("");
  const [source, setSource] = useState<DiscoveredBy | "">("");

  const sorted = [...scans].sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen));
  const filtered = sorted.filter((s) => {
    if (verdict && s.verdict !== verdict) return false;
    if (brand && s.impersonated_brand !== brand) return false;
    if (source && s.discovered_by !== source) return false;
    const q = query.trim().toLowerCase();
    return !q || hostOf(s).includes(q) || s.input.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
  });
  const usedBrands = [...new Set(scans.map((s) => s.impersonated_brand).filter(Boolean))] as string[];
  const usedSources = [...new Set(scans.map((s) => s.discovered_by))];

  return (
    <div className="space-y-6">
      <PageHeader page="cases" />
      {failed && <p className="text-fraud">{t("error.load")}</p>}
      <section>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-56 flex-1">
            <IconSearch className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted" size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ops.search")} className={`${selectClass} w-full ps-9`} />
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
          <span className="text-xs text-muted">{t("ops.showing", { shown: filtered.length, total: scans.length })}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                {["col_domain", "col_brand", "col_score", "col_verdict", "col_source", "col_first_seen"].map((key) => (
                  <th key={key} className="px-3 py-2.5 text-start font-medium">
                    {t(`ops.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((scan) => (
                <tr key={scan.id} onClick={() => navigate(`/cases/${scan.id}`)} className="cursor-pointer border-b border-line/60 transition hover:bg-black/[0.03]">
                  <td className="px-3 py-3 font-mono" dir="ltr">
                    {hostOf(scan)}
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
