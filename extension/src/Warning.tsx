import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { Reason } from "@shared/contract";
import markDark from "@shared/logo/saqr-mark.png";
import markLight from "@shared/logo/saqr-mark-white.png";
import { type AnimationEvent, type KeyboardEvent, useRef, useState } from "react";
import { type Lang, STRINGS } from "./i18n";
import type { CheckOutcome } from "./messages";

export interface WarningActions {
  onLeave: () => void;
  onContinue: () => void;
}

type Shown = Exclude<CheckOutcome, { kind: "none" }>;

interface Props {
  outcome: Shown;
  actions: WarningActions;
  portal: HTMLElement;
  lang: Lang;
  onClosed: () => void;
}

const Z_OVERLAY = "z-[2147483646]";
const Z_SURFACE = "z-[2147483647]";

/**
 * Keep Tab inside the warning. Radix's focus trap reads document.activeElement, which inside a Shadow DOM is the
 * shadow host, so focus would escape to the page; this uses the shadow root's own activeElement instead.
 */
function trapTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const container = event.currentTarget;
  const focusable = [...container.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
  if (!focusable.length) return;
  const root = container.getRootNode() as ShadowRoot | Document;
  const index = focusable.indexOf(root.activeElement as HTMLElement);
  const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
  event.preventDefault();
  focusable[next].focus();
}

/** Evidence the engine found, strongest first. The model's probability is a score, so it is not shown. */
function evidence(reasons: Reason[]): Reason[] {
  return reasons.filter((r) => r.weight > 0 && r.code !== "ML_MODEL").sort((a, b) => b.weight - a.weight);
}

function ShieldIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="M12 8.5v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function BrandBar({ lang, light, onToggleLang }: { lang: Lang; light: boolean; onToggleLang: () => void }) {
  const t = STRINGS[lang];
  const other: Lang = lang === "ar" ? "en" : "ar";
  return (
    <div className="flex items-center gap-2">
      <img src={light ? markLight : markDark} alt="" width={28} height={28} className="h-7 w-7" />
      <span className="text-sm font-semibold tracking-wide">{t.product}</span>
      <button
        type="button"
        lang={other}
        onClick={onToggleLang}
        aria-label={t.switchLanguageLabel}
        className={`ms-auto rounded px-1 text-sm underline underline-offset-4 ${light ? "saqr-focus-light" : "saqr-focus-dark"}`}
      >
        {t.switchLanguage}
      </button>
    </div>
  );
}

function Domain({ lang, domain, className }: { lang: Lang; domain: string; className: string }) {
  return (
    <p className={className}>
      <span>{STRINGS[lang].domainLabel}: </span>
      <bdi dir="ltr" className="font-semibold break-all">{domain}</bdi>
    </p>
  );
}

function Notice({ domain, lang, setLang, closing, close, onExitEnd }: {
  domain: string; lang: Lang; setLang: (l: Lang) => void; closing: boolean; close: () => void;
  onExitEnd: (e: AnimationEvent) => void;
}) {
  const t = STRINGS[lang];
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} role="status" aria-live="polite"
         className={`saqr-root fixed end-4 top-4 ${Z_SURFACE} w-[min(380px,calc(100vw-32px))]`}>
      <div onAnimationEnd={onExitEnd}
           className={`rounded-xl border border-black/15 bg-notice-surface p-5 text-notice-ink ${closing ? "saqr-exit" : "saqr-enter"}`}>
        <BrandBar lang={lang} light={false} onToggleLang={() => setLang(lang === "ar" ? "en" : "ar")} />
        <p className="mt-4 font-semibold">{t.errorTitle}</p>
        <Domain lang={lang} domain={domain} className="mt-1 text-sm" />
        <p className="mt-2 text-sm">{t.errorBody}</p>
        <button type="button" onClick={close}
                className="saqr-focus-dark mt-4 rounded-lg border border-notice-ink px-4 py-2 text-sm font-semibold">
          {t.dismiss}
        </button>
      </div>
    </div>
  );
}

export default function Warning({ outcome, actions, portal, lang: startLang, onClosed }: Props) {
  const [lang, setLang] = useState<Lang>(startLang);
  const [closing, setClosing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const t = STRINGS[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  const toggleLang = () => setLang(lang === "ar" ? "en" : "ar");
  const onExitEnd = (e: AnimationEvent) => {
    if (closing && e.target === e.currentTarget && e.animationName === "saqr-exit") onClosed();
  };

  if (outcome.kind === "error") {
    return <Notice domain={outcome.domain} lang={lang} setLang={setLang} closing={closing}
                   close={() => setClosing(true)} onExitEnd={onExitEnd} />;
  }

  const fraud = outcome.kind === "fraud";
  const reasons = evidence(outcome.reasons);
  const text = (r: Reason) => (lang === "ar" ? r.ar : r.en);
  const leave = () => actions.onLeave();
  const continueAnyway = () => {
    actions.onContinue();
    setClosing(true);
  };

  return (
    <AlertDialog.Root open>
      <AlertDialog.Portal container={portal}>
        <AlertDialog.Overlay
          className={`fixed inset-0 ${Z_OVERLAY} ${fraud ? "bg-fraud-surface" : "bg-black/30"} ${closing ? "saqr-exit" : ""}`}
        />
        <div dir={dir} lang={lang} onAnimationEnd={onExitEnd}
             className={`saqr-root fixed inset-0 ${Z_SURFACE} flex items-center justify-center overflow-y-auto p-4 ${closing ? "saqr-exit" : ""}`}>
          <AlertDialog.Content
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              primary.current?.focus();
            }}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onKeyDown={trapTab}
            className={fraud
              ? "saqr-enter my-auto w-full max-w-xl py-8 text-white"
              : "saqr-enter w-full max-w-md rounded-xl bg-amber-surface p-7 text-amber-ink"}
          >
            <BrandBar lang={lang} light={fraud} onToggleLang={toggleLang} />

            {fraud ? (
              <div className="mt-12">
                <ShieldIcon className="h-12 w-12" />
                <AlertDialog.Title className="mt-5 text-3xl font-semibold leading-tight">{t.fraudTitle}</AlertDialog.Title>
                <Domain lang={lang} domain={outcome.domain} className="mt-4 text-lg" />
                <AlertDialog.Description className="mt-3 text-white/90">{t.fraudBody}</AlertDialog.Description>
                {reasons[0] && <p className="mt-3 font-medium">{text(reasons[0])}</p>}
                <div className="mt-8 flex flex-wrap gap-3">
                  <AlertDialog.Cancel asChild>
                    <button ref={primary} type="button" onClick={leave}
                            className="saqr-focus-light rounded-lg bg-white px-5 py-3 font-semibold text-fraud-surface">
                      {t.backToSafety}
                    </button>
                  </AlertDialog.Cancel>
                  <button type="button" onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen}
                          aria-controls="saqr-details"
                          className="saqr-focus-light rounded-lg border border-white/70 px-5 py-3 font-semibold">
                    {detailsOpen ? t.hideDetails : t.viewDetails}
                  </button>
                </div>
                {detailsOpen && (
                  <section id="saqr-details" className="mt-8 border-t border-white/30 pt-6">
                    <h2 className="font-semibold">{t.detailsTitle}</h2>
                    <ul className="mt-3 list-disc space-y-2 ps-5 text-white/90">
                      {reasons.length
                        ? reasons.slice(0, 6).map((r) => <li key={r.code}>{text(r)}</li>)
                        : <li>{t.modelOnly}</li>}
                    </ul>
                    <AlertDialog.Action asChild>
                      <button type="button" onClick={continueAnyway}
                              className="saqr-focus-light mt-6 rounded px-1 text-sm text-white/80 underline underline-offset-4">
                        {t.continueAnyway}
                      </button>
                    </AlertDialog.Action>
                    <p className="mt-1 text-xs text-white/70">{t.bypassNote}</p>
                  </section>
                )}
              </div>
            ) : (
              <div className="mt-6">
                <div className="flex items-start gap-3">
                  <ShieldIcon className="mt-0.5 h-7 w-7 shrink-0" />
                  <AlertDialog.Title className="text-xl font-semibold leading-snug">{t.suspiciousTitle}</AlertDialog.Title>
                </div>
                <Domain lang={lang} domain={outcome.domain} className="mt-4" />
                <AlertDialog.Description className="mt-2 text-sm">{t.suspiciousBody}</AlertDialog.Description>
                <p className="mt-3 text-sm font-medium">{reasons[0] ? text(reasons[0]) : t.modelOnly}</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <AlertDialog.Cancel asChild>
                    <button ref={primary} type="button" onClick={leave}
                            className="saqr-focus-dark rounded-lg bg-amber-ink px-5 py-2.5 font-semibold text-white">
                      {t.leave}
                    </button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <button type="button" onClick={continueAnyway}
                            className="saqr-focus-dark rounded-lg border border-amber-ink px-5 py-2.5 font-semibold">
                      {t.continueAnyway}
                    </button>
                  </AlertDialog.Action>
                </div>
                <p className="mt-3 text-xs">{t.bypassNote}</p>
              </div>
            )}
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
