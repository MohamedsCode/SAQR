import type { ScanResult } from "@shared/contract";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, downloadJson, isLive, screenshotUrl } from "../api";
import { localized } from "../brand";
import {
  IconAlert,
  IconArrowBack,
  IconCard,
  IconEye,
  IconFile,
  IconGlobe,
  IconHash,
  IconLink,
  IconLock,
  IconMail,
  IconPhone,
  IconServer,
} from "../components/Icons";
import ScoreGauge from "../components/ScoreGauge";
import VerdictBadge, { SourceBadge, verdictColor } from "../components/VerdictBadge";
import { referenceImage } from "../lib/assets";
import { dateTime, daysSince, duration } from "../lib/format";
import { useBrands } from "../lib/useBrands";

function Panel({ title, icon, children, className = "" }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-5 ${className}`}>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-gold-soft">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/60 py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-end ${mono ? "font-mono text-xs break-all" : ""}`} dir={mono ? "ltr" : undefined}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function Shot({ label, src, caption, accent }: { label: string; src: string | null; caption?: string; accent?: boolean }) {
  const { t } = useTranslation();
  return (
    <figure className={`overflow-hidden rounded-xl border bg-bg/60 ${accent ? "border-gold/50" : "border-line"}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs">
        <span className={accent ? "text-gold-soft" : "text-muted"}>{label}</span>
        {caption && <span className="text-muted">{caption}</span>}
      </div>
      <div className="grid aspect-[4/3] place-items-center bg-[repeating-linear-gradient(45deg,#0b1422,#0b1422_10px,#0d182a_10px,#0d182a_20px)]">
        {src ? (
          <img src={src} alt={label} className="size-full object-cover object-top" />
        ) : (
          <span className="px-4 text-center text-xs text-muted">{t("case.no_capture")}</span>
        )}
      </div>
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
      <div className="panel mx-auto max-w-lg p-8 text-center">
        <p className="mb-4">{t("case.not_found")}</p>
        <Link to="/" className="text-gold hover:underline">
          {t("case.back")}
        </Link>
      </div>
    );
  }
  if (!scan) return <div className="py-20 text-center text-muted">{t("case.loading")}</div>;

  const ev = scan.evidence;
  const brand = scan.impersonated_brand ? brands[scan.impersonated_brand] : undefined;
  const officialPhones = new Set(brand?.official_phones.map((p) => p.number) ?? []);
  const reasons = [...scan.reasons].sort((a, b) => b.weight - a.weight);
  const maxWeight = Math.max(1, ...reasons.map((r) => Math.abs(r.weight)));
  const age = daysSince(ev.rdap?.created, scan.scanned_at);
  const similarity = ev.visual_similarity;
  const asksFor = [...new Set(ev.forms.flatMap((f) => f.asks_for))];
  const glow = scan.verdict === "fraud" ? "glow-fraud" : scan.verdict === "suspicious" ? "glow-suspicious" : "glow-safe";

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
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-gold-soft">
        <IconArrowBack size={16} className="rtl:rotate-180" />
        {t("case.back")}
      </Link>

      {callAt && (
        <section className="panel animate-ring-alert flex flex-wrap items-center gap-3 border-fraud/60 p-4">
          <IconPhone className="text-fraud" />
          <span className="font-semibold text-fraud">{t("demo.blocked_banner")}</span>
          <span className="text-text/90">
            {Date.parse(scan.first_seen) < Date.parse(callAt)
              ? t("demo.first_seen_before", { duration: duration(Date.parse(callAt) - Date.parse(scan.first_seen), lang) })
              : t("demo.first_seen_now")}
          </span>
        </section>
      )}

      <section className={`panel animate-fade-up flex flex-wrap items-center gap-8 p-6 ${glow}`}>
        <ScoreGauge score={scan.score} verdict={scan.verdict} />
        <div className="min-w-64 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-mono" dir="ltr">
              {scan.id}
            </span>
            <SourceBadge source={scan.discovered_by} />
            {scan.status !== "live" && (
              <span className="rounded bg-white/5 px-2 py-0.5">{t(`status.${scan.status}`)}</span>
            )}
          </div>
          <h1 className="break-all font-mono text-2xl font-bold sm:text-3xl" dir="ltr">
            {scan.registered_domain}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <VerdictBadge verdict={scan.verdict} large />
            {brand && (
              <span className="text-sm">
                {t("case.impersonates")} <strong className="text-gold-soft">{brandName(brand.id)}</strong>
              </span>
            )}
            {scan.category && (
              <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-muted">
                {t(`category.${scan.category}`, { defaultValue: scan.category })}
              </span>
            )}
          </div>
          <p className="max-w-3xl text-[15px] leading-relaxed text-text/90">{localized(lang, scan.summary_en, scan.summary_ar)}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={downloadPdf}
              disabled={pdfState === "loading"}
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg hover:bg-gold-soft disabled:opacity-60"
            >
              <IconFile size={16} />
              {pdfState === "loading" ? t("case.pdf_loading") : t("case.download_pdf")}
            </button>
            <button
              type="button"
              onClick={downloadEvidence}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm hover:border-gold/60 hover:text-gold-soft"
            >
              {t("case.download_json")}
            </button>
          </div>
          {pdfState === "unavailable" && <p className="text-sm text-suspicious">{t("case.pdf_unavailable")}</p>}
        </div>
        <dl className="w-full min-w-56 text-sm sm:w-auto">
          <Field label={t("case.first_seen")} value={dateTime(scan.first_seen, lang)} />
          <Field label={t("case.scanned_at")} value={dateTime(scan.scanned_at, lang)} />
          <Field label={t("case.domain_age")} value={age === null ? "—" : t("case.days", { count: age })} />
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title={t("case.reasons")} icon={<IconAlert size={16} />} className="lg:col-span-3">
          <ol className="space-y-3">
            {reasons.map((reason, index) => (
              <li key={reason.code} className="animate-fade-up rounded-lg border border-line bg-bg/40 p-3" style={{ animationDelay: `${index * 60}ms` }}>
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="font-medium">{localized(lang, reason.en, reason.ar)}</div>
                    <div className="mt-0.5 text-sm text-muted" dir="auto">
                      {localized(lang, reason.ar, reason.en)}
                    </div>
                    {reason.evidence && (
                      <div className="mt-2 rounded bg-white/5 px-2 py-1 font-mono text-xs text-muted" dir="ltr">
                        {reason.evidence}
                      </div>
                    )}
                  </div>
                  <span
                    className="shrink-0 rounded-md px-2 py-0.5 text-sm font-bold tabular-nums"
                    style={{ color: reason.weight > 0 ? verdictColor[scan.verdict] : "#2fbf71" }}
                  >
                    {reason.weight > 0 ? `+${reason.weight}` : reason.weight}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(Math.abs(reason.weight) / maxWeight) * 100}%`,
                      background: reason.weight > 0 ? verdictColor[scan.verdict] : "#2fbf71",
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="space-y-6 lg:col-span-2">
          <Panel title={t("case.redirects")} icon={<IconLink size={16} />}>
            {ev.redirect_chain.length ? (
              <ol className="relative space-y-3 border-s border-line ps-5">
                {ev.redirect_chain.map((url, index) => (
                  <li key={`${url}-${index}`} className="relative">
                    <span className="absolute -start-[25px] top-1.5 size-2.5 rounded-full bg-gold ring-4 ring-panel" />
                    <span className="block break-all font-mono text-xs" dir="ltr">
                      {url}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">{t("case.none")}</p>
            )}
            {ev.cloaking?.detected && (
              <div className="mt-4 rounded-lg border border-fraud/50 bg-fraud/10 p-3 text-sm">
                <div className="mb-1 font-semibold text-fraud">{t("case.cloaking")}</div>
                <div className="text-text/80" dir="ltr">
                  {ev.cloaking.details}
                </div>
              </div>
            )}
          </Panel>

          <Panel title={t("case.indicators")} icon={<IconPhone size={16} />}>
            <div className="space-y-4 text-sm">
              <div>
                <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">{t("case.phones")}</div>
                {ev.phones_found.length ? (
                  <ul className="space-y-1.5">
                    {ev.phones_found.map((phone) => (
                      <li key={phone} className="flex items-center justify-between gap-2">
                        <span className="font-mono" dir="ltr">
                          {phone}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] ${
                            officialPhones.has(phone) ? "bg-safe/15 text-safe" : "bg-fraud/15 text-fraud"
                          }`}
                        >
                          {officialPhones.has(phone) ? t("case.phone_official") : t("case.phone_not_official")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">{t("case.none")}</p>
                )}
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted">
                  <IconMail size={14} />
                  {t("case.emails")}
                </div>
                {ev.emails_found.length ? (
                  ev.emails_found.map((email) => (
                    <div key={email} className="font-mono text-xs" dir="ltr">
                      {email}
                    </div>
                  ))
                ) : (
                  <p className="text-muted">{t("case.none")}</p>
                )}
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted">
                  <IconCard size={14} />
                  {t("case.form_asks")}
                </div>
                {asksFor.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {asksFor.map((kind) => (
                      <span key={kind} className="rounded-md bg-fraud/15 px-2 py-0.5 text-xs text-fraud ring-1 ring-fraud/30">
                        {t(`field.${kind}`, { defaultValue: kind })}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted">{t("case.none")}</p>
                )}
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title={t("case.visual")} icon={<IconEye size={16} />}>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto_1fr] md:items-center">
          <Shot label={t("case.shot_desktop")} src={screenshotUrl(scan, "desktop")} />
          <Shot label={t("case.shot_mobile")} src={screenshotUrl(scan, "mobile")} />
          <div className="flex flex-col items-center gap-1 px-2 text-center">
            <div
              className="grid size-24 place-items-center rounded-full text-2xl font-bold tabular-nums"
              style={{
                background: similarity
                  ? `conic-gradient(#d4a63c ${similarity.percent * 3.6}deg, #1b2a40 0deg)`
                  : "#1b2a40",
              }}
            >
              <span className="grid size-[80px] place-items-center rounded-full bg-panel text-gold-soft">
                {similarity ? `${Math.round(similarity.percent)}%` : "—"}
              </span>
            </div>
            <div className="max-w-28 text-xs text-muted">{t("case.visual_match")}</div>
          </div>
          <Shot
            label={t("case.shot_official", { brand: brandName(similarity?.brand_id ?? scan.impersonated_brand) ?? "—" })}
            src={referenceImage(similarity?.brand_id ?? scan.impersonated_brand)}
            accent
          />
        </div>
      </Panel>

      <div className="grid gap-6 md:grid-cols-3">
        <Panel title={t("case.registration")} icon={<IconGlobe size={16} />}>
          <dl>
            <Field label={t("case.registrar")} value={ev.rdap?.registrar} />
            <Field label={t("case.created")} value={dateTime(ev.rdap?.created, lang)} />
            <Field label={t("case.expires")} value={dateTime(ev.rdap?.expires, lang)} />
            <Field label={t("case.abuse")} value={ev.rdap?.abuse_email} mono />
            <Field label={t("case.nameservers")} value={ev.rdap?.nameservers.join(", ") || null} mono />
          </dl>
        </Panel>
        <Panel title={t("case.hosting")} icon={<IconServer size={16} />}>
          <dl>
            <Field label={t("case.ip")} value={ev.hosting?.ip} mono />
            <Field label="ASN" value={ev.hosting?.asn ? `AS${ev.hosting.asn}` : null} mono />
            <Field label={t("case.org")} value={ev.hosting?.org} />
            <Field label={t("case.country")} value={ev.hosting?.country} />
            <Field label="DNS A" value={ev.dns?.a.join(", ") || null} mono />
            <Field label="DNS MX" value={ev.dns ? ev.dns.mx.join(", ") || t("case.none") : null} mono />
          </dl>
        </Panel>
        <Panel title={t("case.tls")} icon={<IconLock size={16} />}>
          <dl>
            <Field label={t("case.issuer")} value={ev.tls?.issuer} />
            <Field label={t("case.valid_from")} value={dateTime(ev.tls?.not_before, lang)} />
            <Field label={t("case.ct_first_seen")} value={dateTime(ev.tls?.first_seen_crtsh, lang)} />
          </dl>
        </Panel>
      </div>

      <Panel title={t("case.integrity")} icon={<IconHash size={16} />}>
        <dl className="grid gap-x-8 md:grid-cols-2">
          <Field label={t("case.scanned_utc")} value={dateTime(scan.scanned_at, lang, "UTC")} />
          <Field label={t("case.scanned_gst")} value={dateTime(scan.scanned_at, lang)} />
          <Field label={t("case.html_hash")} value={ev.html_sha256} mono />
          <Field label={t("case.shot_hash")} value={ev.screenshot_sha256} mono />
          <Field label={t("case.input")} value={scan.input.trim()} mono />
          <Field label={t("case.final_url")} value={scan.final_url} mono />
        </dl>
      </Panel>
    </div>
  );
}
