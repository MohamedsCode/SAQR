import type { ScanResult } from "@shared/contract";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, downloadJson, isLive, screenshotUrl } from "../api";
import { IconArrowBack, IconFile, IconShieldCheck } from "../components/Icons";
import ScoreGauge from "../components/ScoreGauge";
import { primaryButton, secondaryButton } from "../components/ui";
import VerdictBadge, { verdictColor } from "../components/VerdictBadge";
import { referenceImage } from "../lib/assets";
import { clean, hostOf } from "../lib/display";
import { dateTime, daysSince, duration } from "../lib/format";
import { useBrands } from "../lib/useBrands";

type Row = [string, ReactNode | null | undefined, boolean?];

/** A titled list of label/value rows; rows without a real value are dropped, and so is the section if none remain. */
function Facts({ title, rows }: { title: string; rows: Row[] }) {
  const shown = rows.map(([label, value, mono]) => [label, clean(value), mono] as const).filter(([, value]) => value !== null);
  if (!shown.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold">{title}</h3>
      <dl className="divide-y divide-line border-y border-line text-sm">
        {shown.map(([label, value, mono]) => (
          <div key={label} className="flex justify-between gap-6 py-2">
            <dt className="text-muted">{label}</dt>
            <dd className={`text-end ${mono ? "break-all font-mono text-xs" : ""}`} dir={mono ? "ltr" : undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Shot({ label, src, caption }: { label: string; src: string; caption?: string }) {
  return (
    <figure>
      <img src={src} alt={label} className="aspect-[4/3] w-full rounded-lg border border-line object-cover object-top" />
      <figcaption className="mt-1.5 flex justify-between text-xs text-muted">
        <span>{label}</span>
        {caption && <span>{caption}</span>}
      </figcaption>
    </figure>
  );
}

export default function CaseDetail() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const callAt = params.get("call");
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { brands, brandName } = useBrands();
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [missing, setMissing] = useState(false);
  const [pdfState, setPdfState] = useState<"idle" | "loading" | "unavailable">("idle");

  useEffect(() => {
    setScan(null);
    setMissing(false);
    api.scanById(id).then(setScan).catch(() => setMissing(true));
  }, [id]);

  if (missing) {
    return (
      <div className="py-20 text-center">
        <p className="mb-4">{t("case.not_found")}</p>
        <Link to="/cases" className="text-gold hover:underline">
          {t("case.back")}
        </Link>
      </div>
    );
  }
  if (!scan) return <div className="py-20 text-center text-muted">{t("case.loading")}</div>;

  const ev = scan.evidence;
  const safe = scan.verdict === "safe";
  const brandId = scan.impersonated_brand;
  const brand = brandId ? brands[brandId] : undefined;
  const officialPhones = new Set(brand?.official_phones.map((p) => p.number) ?? []);
  const reasons = [...scan.reasons].sort((a, b) => b.weight - a.weight);
  const official = scan.reasons.find((r) => r.code === "ALLOWLIST_OFFICIAL");
  const age = daysSince(ev.rdap?.created, scan.scanned_at);
  const desktop = screenshotUrl(scan, "desktop");
  const mobile = screenshotUrl(scan, "mobile");
  const similarity = ev.visual_similarity;
  const reference = referenceImage(similarity?.brand_id ?? scan.impersonated_brand);
  const asksFor = [...new Set(ev.forms.flatMap((f) => f.asks_for))];
  const nameservers = [...new Set([...(ev.rdap?.nameservers ?? []), ...(ev.dns?.ns ?? [])])].filter((n) => clean(n));

  async function downloadPdf() {
    if (!scan) return;
    if (!isLive()) {
      setPdfState("unavailable");
      return;
    }
    setPdfState("loading");
    try {
      const response = await fetch(`/api/scans/${encodeURIComponent(scan.id)}/evidence.pdf`);
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      Object.assign(document.createElement("a"), { href: url, download: `${scan.id}-evidence.pdf` }).click();
      URL.revokeObjectURL(url);
      setPdfState("idle");
    } catch {
      setPdfState("unavailable");
    }
  }

  function downloadEvidence() {
    if (!scan) return;
    if (isLive()) window.location.href = `/api/scans/${encodeURIComponent(scan.id)}/evidence.json`;
    else downloadJson(`${scan.id}-evidence.json`, scan);
  }

  return (
    <div className="space-y-10">
      <Link to="/cases" className="inline-flex items-center gap-1 text-sm text-muted hover:text-gold">
        <IconArrowBack size={16} className="rtl:rotate-180" />
        {t("case.back")}
      </Link>

      {callAt && (
        <p className="animate-ring-alert rounded-lg border border-fraud/40 bg-fraud/5 px-4 py-3 text-[15px]">
          <strong className="text-fraud">{t("demo.blocked_banner")}</strong>{" "}
          {Date.parse(scan.first_seen) < Date.parse(callAt)
            ? t("demo.first_seen_before", { duration: duration(Date.parse(callAt) - Date.parse(scan.first_seen), lang) })
            : t("demo.first_seen_now")}
        </p>
      )}

      {safe && official && (
        <p className="flex items-center gap-3 rounded-lg border border-safe/30 bg-safe/5 px-4 py-3 text-[15px] text-safe">
          <IconShieldCheck size={22} />
          <span className="font-semibold">{lang === "ar" ? official.ar : official.en}</span>
          <span className="text-safe/80" dir={lang === "ar" ? "ltr" : "rtl"}>
            {lang === "ar" ? official.en : official.ar}
          </span>
        </p>
      )}

      <section data-tour="case-header" className="flex flex-wrap items-center gap-10">
        <ScoreGauge score={scan.score} verdict={scan.verdict} />
        <div className="min-w-72 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <VerdictBadge verdict={scan.verdict} large />
            {brand && !safe && (
              <span className="text-[15px]">
                {t("case.impersonates")} <strong>{brandName(brand.id)}</strong>
              </span>
            )}
          </div>
          <h1 className="break-all font-mono text-[28px] font-semibold leading-tight" dir="ltr">
            {hostOf(scan)}
          </h1>
          <p className="max-w-3xl text-[15px] leading-relaxed">{lang === "ar" ? scan.summary_ar : scan.summary_en}</p>
          <p className="max-w-3xl text-[15px] leading-relaxed text-text/80" dir={lang === "ar" ? "ltr" : "rtl"}>
            {lang === "ar" ? scan.summary_en : scan.summary_ar}
          </p>
          <div data-tour="evidence" className="flex flex-wrap gap-2 pt-2">
            <button type="button" onClick={downloadPdf} disabled={pdfState === "loading"} className={`${primaryButton} inline-flex items-center gap-2`}>
              <IconFile size={16} />
              {pdfState === "loading" ? t("case.pdf_loading") : t("case.download_pdf")}
            </button>
            <button type="button" onClick={downloadEvidence} className={secondaryButton}>
              {t("case.download_json")}
            </button>
            {!safe && (
              <Link to={`/networks/${encodeURIComponent(scan.id)}`} className={secondaryButton}>
                {t("case.expand")}
              </Link>
            )}
          </div>
          {pdfState === "unavailable" && <p className="text-sm text-suspicious">{t("case.pdf_unavailable")}</p>}
          <p className="text-xs text-muted">
            {[
              scan.id,
              `${t("case.first_seen")} ${dateTime(scan.first_seen, lang)}`,
              age !== null ? `${t("case.domain_age")} ${t("case.days", { count: age })}` : null,
              scan.status === "offline" ? t("status.offline") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </section>

      <section data-tour="reasons" className="section">
        <h2 className="mb-4 text-lg font-semibold">{safe ? t("case.trusts") : t("case.reasons")}</h2>
        <ol className="divide-y divide-line border-y border-line">
          {reasons.map((reason) => (
            <li key={reason.code} className="grid gap-x-8 gap-y-1 py-3 md:grid-cols-[1fr_1fr_auto]">
              <div dir="ltr" className="text-[15px]">
                {reason.en}
                {reason.evidence && <div className="mt-0.5 break-all font-mono text-xs text-muted">{reason.evidence}</div>}
              </div>
              <div dir="rtl" className="text-[15px]">
                {reason.ar}
              </div>
              <div className="text-end font-semibold tabular-nums" style={{ color: reason.weight > 0 ? verdictColor[scan.verdict] : "#1b6e45" }}>
                {reason.weight > 0 ? `+${reason.weight}` : reason.weight}
              </div>
            </li>
          ))}
        </ol>
        {ev.cloaking?.detected && clean(ev.cloaking.details) && (
          <p className="mt-4 text-[15px]">
            <strong className="text-fraud">{t("case.cloaking")}:</strong> <span dir="ltr">{ev.cloaking.details}</span>
          </p>
        )}
      </section>

      {(desktop || mobile) && (
        <section data-tour="visual" className="section">
          <h2 className="mb-4 text-lg font-semibold">{t("case.visual")}</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {desktop && <Shot label={t("case.shot_desktop")} src={desktop} />}
            {mobile && <Shot label={t("case.shot_mobile")} src={mobile} />}
            {reference && (
              <Shot
                label={t("case.shot_official", { brand: brandName(similarity?.brand_id ?? scan.impersonated_brand) ?? "" })}
                src={reference}
                caption={similarity ? t("case.match", { percent: Math.round(similarity.percent) }) : undefined}
              />
            )}
          </div>
        </section>
      )}

      <div className="section grid gap-10 md:grid-cols-2">
        <Facts
          title={t("case.indicators")}
          rows={[
            [t("case.phones"), ev.phones_found.length ? ev.phones_found.map((p) => `${p}${officialPhones.has(p) ? ` (${t("case.phone_official")})` : brand ? ` (${t("case.phone_not_official")})` : ""}`).join(", ") : null, true],
            [t("case.emails"), ev.emails_found.join(", ") || null, true],
            [t("case.form_asks"), asksFor.map((k) => t(`field.${k}`, { defaultValue: k })).join(", ") || null],
            [t("case.redirects"), ev.redirect_chain.length > 1 ? ev.redirect_chain.join(" → ") : null, true],
          ]}
        />
        <Facts
          title={t("case.registration")}
          rows={[
            [t("case.registrar"), ev.rdap?.registrar],
            [t("case.created"), ev.rdap?.created ? dateTime(ev.rdap.created, lang) : null],
            [t("case.expires"), ev.rdap?.expires ? dateTime(ev.rdap.expires, lang) : null],
            [t("case.abuse"), ev.rdap?.abuse_email, true],
            [t("case.nameservers"), nameservers.join(", ") || null, true],
          ]}
        />
        <Facts
          title={t("case.hosting")}
          rows={[
            [t("case.ip"), ev.hosting?.ip, true],
            ["ASN", ev.hosting?.asn ? `AS${ev.hosting.asn}` : null, true],
            [t("case.org"), ev.hosting?.org],
            [t("case.country"), ev.hosting?.country],
          ]}
        />
        <Facts
          title={t("case.tls")}
          rows={[
            [t("case.issuer"), ev.tls?.issuer],
            [t("case.valid_from"), ev.tls?.not_before ? dateTime(ev.tls.not_before, lang) : null],
            [t("case.ct_first_seen"), ev.tls?.first_seen_crtsh ? dateTime(ev.tls.first_seen_crtsh, lang) : null],
          ]}
        />
        <Facts
          title={t("case.integrity")}
          rows={[
            [t("case.scanned_utc"), dateTime(scan.scanned_at, lang, "UTC")],
            [t("case.scanned_gst"), dateTime(scan.scanned_at, lang)],
            [t("case.html_hash"), ev.html_sha256, true],
            [t("case.shot_hash"), ev.screenshot_sha256, true],
            [t("case.input"), scan.input.trim(), true],
          ]}
        />
      </div>
    </div>
  );
}
