import type { Brand, ScanResult, Stats } from "@shared/contract";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { localized } from "../brand";
import VerdictBadge from "../components/VerdictBadge";

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{label}</div>
    </div>
  );
}

export default function Operations() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [stats, setStats] = useState<Stats | null>(null);
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [brands, setBrands] = useState<Record<string, Brand>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([api.stats(), api.scans(), api.brands()])
      .then(([s, list, brandList]) => {
        setStats(s);
        setScans(list);
        setBrands(Object.fromEntries(brandList.map((b) => [b.id, b])));
      })
      .catch(() => setFailed(true));
  }, []);

  const brandName = (id: string | null) =>
    id && brands[id] ? localized(lang, brands[id].name_en, brands[id].name_ar) : "—";
  const date = (iso: string) =>
    new Date(iso).toLocaleString(lang === "ar" ? "ar-AE" : "en-AE", {
      timeZone: "Asia/Dubai",
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">{t("ops.title")}</h1>
      {failed && <p className="rounded bg-fraud/10 p-3 text-fraud">{t("error.load")}</p>}

      {stats && (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Kpi label={t("ops.kpi_scans")} value={stats.scans} />
          <Kpi label={t("ops.kpi_fraud")} value={stats.fraud_found} />
          <Kpi label={t("ops.kpi_before_report")} value={stats.found_before_report} />
          <Kpi label={t("ops.kpi_fake_helplines")} value={stats.fake_helplines} />
          <Kpi label={t("ops.kpi_time_to_detect")} value={stats.avg_hours_to_detect ?? "—"} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("ops.cases")}</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {["col_domain", "col_brand", "col_score", "col_verdict", "col_source", "col_first_seen"].map((key) => (
                  <th key={key} className="px-4 py-2 text-start font-medium">
                    {t(`ops.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono" dir="ltr">
                    {scan.registered_domain}
                    {scan.status === "offline" && (
                      <span className="ms-2 text-xs text-slate-500">({t("ops.status_offline")})</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{brandName(scan.impersonated_brand)}</td>
                  <td className="px-4 py-2 tabular-nums">{scan.score}</td>
                  <td className="px-4 py-2">
                    <VerdictBadge verdict={scan.verdict} />
                  </td>
                  <td className="px-4 py-2">{t(`source.${scan.discovered_by}`)}</td>
                  <td className="px-4 py-2 text-slate-600">{date(scan.first_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
