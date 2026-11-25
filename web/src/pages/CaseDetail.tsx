import type { ScanResult } from "@shared/contract";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, downloadJson, isLive, screenshotUrl } from "../api";
import { IconArrowBack, IconFile, IconShield, IconShieldCheck } from "../components/Icons";
import ScoreGauge from "../components/ScoreGauge";
import { primaryButton, secondaryButton } from "../components/ui";
import VerdictBadge, { verdictColor } from "../components/VerdictBadge";
import { referenceImage } from "../lib/assets";
import { clean, hostOf } from "../lib/display";
import { dateTime, daysSince, duration, number } from "../lib/format";
import { useBrands } from "../lib/useBrands";

type Row = [string, ReactNode | null | undefined, boolean?];

/** A titled list of label/value rows; rows without a real value are dropped, and so is the section if none remain. */
function Facts({ title, rows }: { title: string; rows: Row[] }) {
  const shown = rows.map(([label, value, mono]) => [label, clean(value), mono] as const).filter(([, value]) => value !== null);
  if (!shown.length) return null;
  return (
    <section className="card p-6">
      <h3 className="mb-2 text-base font-semibold">{title}</h3>
      <dl className="divide-y divide-line text-sm">
        {shown.map(([label, value, mono]) => (
          <div key={label} className="flex justify-between gap-6 py-2.5">
            <dt className="shrink-0 text-muted">{label}</dt>
            <dd className={`text-end font-medium ${mono ? "break-all font-mono text-xs font-normal" : ""}`} dir={mono ? "ltr" : undefined}>
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
      <img src={src} alt={label} className="aspect-[4/3] w-full rounded-xl border border-line object-cover object-top shadow-sm" />
      <figcaption className="mt-2 flex justify-between text-[13px] text-muted">
        <span>{label}</span>
        {caption && <span className="rounded-full bg-fraud/10 px-2 py-0.5 font-semibold text-fraud">{caption}</span>}
      </figcaption>
    </figure>
  );
}

function useGap() {
  const { t, i18n } = useTranslation();
  return (ms: number) => {
    const hours = Math.max(0, ms) / 3_600_000;
    const lang = i18n.language;
    return hours < 1
      ? t("ops.lag_m", { n: number(Math.max(1, Math.round(hours * 60)), lang) })
      : hours < 48
        ? t("ops.lag_h", { n: number(hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours), lang) })
        : t("ops.lag_d", { n: number(Math.round(hours / 24), lang) });
  };
}

type Moment = { key: "registered" | "cert" | "saqr" | "call"; at: string };

/** The scam's life on one line: registered, certificate, caught by SAQR, and (in the live demo) the blocked call. */
function ScamTimeline({ scan, callAt }: { scan: ScanResult; callAt: string | null }) {
  const { t, i18n } = useTranslation();
  const gap = useGap();
  const moments = (
    [
      { key: "registered", at: scan.evidence.rdap?.created },
      { key: "cert", at: scan.evidence.tls?.not_before },
      { key: "saqr", at: scan.first_seen },
      { key: "call", at: callAt },
    ] as { key: Moment["key"]; at: string | null | undefined }[]
  )
    .filter((m): m is Moment => !!m.at && !Number.isNaN(Date.parse(m.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (moments.length < 2) return null;
  const tone = (key: Moment["key"]) => (key === "saqr" ? "#c9a04a" : key === "call" ? "#ff6b5e" : "rgb(255 255 255 / 0.5)");
  return (
    <div className="relative overflow-hidden bg-ink px-7 pb-6 pt-5 text-white">
      <div className="eye-rings pointer-events-none absolute -end-40 -top-52 size-[420px] opacity-70" />
      <div className="relative text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/45">{t("case.tl_title")}</div>
      <ol className="relative mt-7 grid" style={{ gridTemplateColumns: `repeat(${moments.length}, minmax(0, 1fr))` }}>
        {moments.map((m, i) => (
          <li key={m.key} className="relative pe-3">
            {i < moments.length - 1 && <span className="absolute start-1.5 top-[5px] h-px w-full bg-white/20" />}
            {i < moments.length - 1 && (
              <span className="font-data absolute -top-6 start-[50%] -translate-x-1/2 whitespace-nowrap text-[11.5px] font-medium text-brass rtl:translate-x-1/2">
                +{gap(Date.parse(moments[i + 1].at) - Date.parse(m.at))}
              </span>
            )}
            <span
              className={`relative block size-3 ${m.key === "saqr" ? "diamond-in rotate-45 shadow-[0_0_14px_3px_rgb(201_160_74/0.55)]" : "rounded-full"} ${m.key === "call" ? "animate-pulse-dot" : ""}`}
              style={{ background: tone(m.key), animationDelay: `${300 + i * 150}ms` }}
            />
            <div className="mt-3 text-[14px] font-semibold" style={{ color: m.key === "saqr" || m.key === "call" ? tone(m.key) : undefined }}>
              {t(`case.tl_${m.key}`)}
            </div>
            <div className="mt-0.5 text-[12px] text-white/50">{dateTime(m.at, i18n.language)}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The risk score as the stacked sum of its reasons, so the number is visibly explained. */
function ScoreBreakdown({ scan }: { scan: ScanResult }) {
  const { t } = useTranslation();
  const parts = scan.reasons.filter((r) => r.weight > 0).sort((a, b) => b.weight - a.weight);
  const total = parts.reduce((sum, r) => sum + r.weight, 0);
  if (parts.length < 2) return null;
  const color = verdictColor[scan.verdict];
  return (
    <div className="mb-5 rounded-2xl bg-slate-50 p-4">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-muted">
        <span className="font-medium text-text">{t("case.breakdown")}</span>
        <span className="tabular-nums" dir="ltr">
          {parts.map((r) => r.weight).join(" + ")} = {total}
          {total > scan.score && <span className="ms-2 font-semibold text-text">→ {scan.score}</span>}
        </span>
      </div>
      <div className="flex h-9 gap-[3px] overflow-hidden rounded-xl" dir="ltr">
        {parts.map((r, i) => (
          <div
            key={r.code}
            title={`+${r.weight} · ${r.en}`}
            className="animate-grow-x grid min-w-0 place-items-center text-[12px] font-semibold text-white"
            style={{ flex: r.weight, background: color, opacity: Math.max(0.35, 1 - i * 0.08), animationDelay: `${i * 70}ms` }}
          >
            {r.weight / total > 0.06 ? `+${r.weight}` : ""}
          </div>
        ))}
      </div>
      {total > scan.score && <div className="mt-2 text-end text-[12px] text-muted">{t("case.capped", { score: scan.score })}</div>}
    </div>
  );
}

/** The scam page next to the real one, with the visual match between them. */
function FakeVsReal({
  fake,
  inset,
  official,
  brand,
  percent,
  host,
}: {
  fake: string;
  inset: string | null;
  official: string;
  brand: string;
  percent?: number;
  host: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <figure>
        <figcaption className="mb-2.5 flex items-center gap-2 text-[13px]">
          <span className="rounded-full bg-fraud/10 px-2.5 py-0.5 font-semibold text-fraud">{t("case.vs_scam")}</span>
          <span className="truncate text-muted" dir="ltr">
            {host}
          </span>
        </figcaption>
        <div className="relative">
          <img src={fake} alt={t("case.vs_scam")} className="aspect-[4/3] w-full rounded-2xl border-2 border-fraud/30 object-cover object-top shadow-lg" />
          {inset && (
            <img src={inset} alt="" className="absolute -bottom-4 end-4 aspect-[9/19] w-20 rounded-xl border-4 border-white object-cover object-top shadow-xl" />
          )}
        </div>
      </figure>
      {percent !== undefined && (
        <div className="mx-auto grid size-28 place-items-center rounded-full bg-ink text-center text-white shadow-xl ring-4 ring-brass/25">
          <div>
            <div className="font-display text-[28px] font-semibold leading-none text-brass">{Math.round(percent)}%</div>
            <div className="mt-1 text-[11px] text-white/60">{t("case.vs_match")}</div>
          </div>
        </div>
      )}
      <figure>
        <figcaption className="mb-2.5 flex items-center gap-2 text-[13px]">
          <span className="rounded-full bg-safe/10 px-2.5 py-0.5 font-semibold text-safe">{t("case.vs_official")}</span>
          <span className="truncate text-muted">{brand}</span>
        </figcaption>
        <img src={official} alt={brand} className="aspect-[4/3] w-full rounded-2xl border-2 border-safe/30 object-cover object-top shadow-lg" />
      </figure>
    </div>
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
    <div className="space-y-6">
      <Link to="/cases" className="inline-flex items-center gap-1 text-sm font-medium text-muted transition hover:text-gold">
        <IconArrowBack size={16} className="rtl:rotate-180" />
        {t("case.back")}
      </Link>

      {callAt && (
        <div className="tour-pop relative flex items-center gap-5 overflow-hidden rounded-[22px] bg-ink px-6 py-5 text-white shadow-[0_24px_50px_-24px_rgb(180_35_24/0.7)] ring-1 ring-[#ff6b5e]/40">
          <span className="relative grid size-14 shrink-0 place-items-center">
            <span className="animate-ping-soft absolute size-14 rounded-full bg-[#ff6b5e]/40" />
            <span className="relative grid size-14 place-items-center rounded-full bg-[#ff6b5e] text-white">
              <IconShield size={26} />
            </span>
          </span>
          <div className="min-w-0">
            <div className="font-display text-[22px] font-semibold leading-tight">{t("demo.blocked_banner")}</div>
            <div className="mt-1 text-[15px] text-brass">
              {Date.parse(scan.first_seen) < Date.parse(callAt)
                ? t("demo.first_seen_before", { duration: duration(Date.parse(callAt) - Date.parse(scan.first_seen), lang) })
                : t("demo.first_seen_now")}
            </div>
          </div>
        </div>
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

      <section data-tour="case-header" className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-10 p-7">
        <div className="rounded-2xl bg-slate-50 px-6 pb-4 pt-6">
          <ScoreGauge score={scan.score} verdict={scan.verdict} size={200} />
        </div>
        <div className="min-w-72 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <VerdictBadge verdict={scan.verdict} large />
            {brand && !safe && (
              <span className="text-[15px]">
                {t("case.impersonates")} <strong>{brandName(brand.id)}</strong>
              </span>
            )}
          </div>
          <h1 className="break-all text-[30px] font-semibold leading-tight tracking-tight" dir="ltr">
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
        </div>
        {!safe && <ScamTimeline scan={scan} callAt={callAt} />}
      </section>

      <section data-tour="reasons" className="section">
        <h2 className="mb-4 text-[17px] font-semibold">{safe ? t("case.trusts") : t("case.reasons")}</h2>
        {!safe && <ScoreBreakdown scan={scan} />}
        <ol className="divide-y divide-line">
          {reasons.map((reason, i) => (
            <li
              key={reason.code}
              className="animate-fade-up grid items-start gap-x-8 gap-y-1 py-3.5 md:grid-cols-[3.5rem_1fr_1fr]"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span
                className="w-fit rounded-lg px-2 py-0.5 text-sm font-semibold tabular-nums"
                style={{
                  color: reason.weight > 0 ? verdictColor[scan.verdict] : "#1b6e45",
                  background: reason.weight > 0 ? `${verdictColor[scan.verdict]}14` : "#1b6e4514",
                }}
              >
                {reason.weight > 0 ? `+${reason.weight}` : reason.weight}
              </span>
              <div dir="ltr" className="text-[15px] font-medium">
                {reason.en}
                {reason.evidence && <div className="mt-0.5 break-words text-[13px] font-normal text-muted" dir="auto">{reason.evidence}</div>}
              </div>
              <div dir="rtl" className="text-[15px] font-medium">
                {reason.ar}
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
          <h2 className="mb-4 text-[17px] font-semibold">{t("case.visual")}</h2>
          {reference && (desktop || mobile) ? (
            <FakeVsReal
              fake={(desktop ?? mobile)!}
              inset={desktop && mobile ? mobile : null}
              official={reference}
              brand={brandName(similarity?.brand_id ?? scan.impersonated_brand) ?? ""}
              percent={similarity?.percent}
              host={hostOf(scan)}
            />
          ) : (
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
          )}
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
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
