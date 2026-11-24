import type { MapsSweep, PhoneStatus } from "@shared/contract";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, useDataMode } from "../api";
import { PageHeader, primaryButton } from "../components/ui";
import { dateTime } from "../lib/format";
import { useBrands } from "../lib/useBrands";

const STATUS_STYLE: Record<PhoneStatus, string> = {
  official: "bg-safe/15 text-safe ring-safe/40",
  fake_listing: "bg-fraud/15 text-fraud ring-fraud/50",
  reported_scam: "bg-fraud/15 text-fraud ring-fraud/50",
  unknown: "bg-black/5 text-muted ring-line",
};

const pretty = (e164: string) => e164.replace(/^\+971(\d{1,2})(\d{3})(\d{4})$/, "+971 $1 $2 $3");

export default function HelplinesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const mode = useDataMode();
  const { brands, brandName } = useBrands();
  const [sweep, setSweep] = useState<MapsSweep | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.mapsSweep().then(setSweep).catch(() => undefined);
  }, [mode]);

  async function run() {
    setBusy(true);
    try {
      setSweep(await api.runMapsSweep());
    } finally {
      setBusy(false);
    }
  }

  const listings = sweep?.listings ?? [];
  const counts = { fake: 0, official: 0, unknown: 0 };
  for (const l of listings) {
    if (l.phone_status === "official") counts.official += 1;
    else if (l.phone_status === "unknown") counts.unknown += 1;
    else counts.fake += 1;
  }
  const official = (brandId: string) => brands[brandId]?.official_phones.find((p) => p.verified)?.number ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        page="helplines"
       
        aside={
          <button
            type="button"
            onClick={run}
            disabled={busy || mode !== "live"}
            className={primaryButton}
          >
            {busy ? t("helplines.running") : t("helplines.run")}
          </button>
        }
      />

      {sweep && (
        <section className="grid grid-cols-3 border-y border-line py-6">
          {(
            [
              ["fake", "text-fraud"],
              ["official", "text-safe"],
              ["unknown", "text-text"],
            ] as const
          ).map(([key, tone]) => (
            <div key={key} className="px-1">
              <div className={`text-4xl font-semibold tabular-nums ${tone}`}>{counts[key]}</div>
              <div className="mt-1 text-sm text-muted">{t(`helplines.count_${key}`)}</div>
            </div>
          ))}
        </section>
      )}

      <section className="overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          {sweep && <span>{t("helplines.ran_at", { time: dateTime(sweep.ran_at, lang) })}</span>}
          {sweep?.simulated && (
            <span className="rounded-full bg-suspicious/15 px-2.5 py-0.5 font-semibold text-suspicious ring-1 ring-suspicious/40">
              {t("helplines.simulated")}
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              {["listing", "brand", "found", "official", "status"].map((key) => (
                <th key={key} className="px-3 py-2.5 text-start font-medium">
                  {t(`helplines.col_${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => (
              <tr key={listing.id} className="border-b border-line/60">
                <td className="px-3 py-3">
                  <div className="font-medium">{listing.name}</div>
                  {listing.address && <div className="text-xs text-muted">{listing.address}</div>}
                </td>
                <td className="px-3 py-3">{brandName(listing.brand_id) ?? "—"}</td>
                <td className="px-3 py-3 font-mono" dir="ltr">
                  {listing.phones.map(pretty).join(", ") || "—"}
                </td>
                <td className="px-3 py-3 font-mono text-muted" dir="ltr">
                  {official(listing.brand_id) ? pretty(official(listing.brand_id)!) : "—"}
                </td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ring-1 ${STATUS_STYLE[listing.phone_status]}`}>
                    {t(`helplines.status_${listing.phone_status}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {listings.length === 0 && <p className="py-6 text-center text-sm text-muted">{t("helplines.empty")}</p>}
      </section>
    </div>
  );
}
