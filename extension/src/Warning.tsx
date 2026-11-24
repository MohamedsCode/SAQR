import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { Reason } from "@shared/contract";
import markDark from "@shared/logo/saqr-mark.png";
import markLight from "@shared/logo/saqr-mark-white.png";
import { type AnimationEvent, type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { STRINGS } from "./i18n";
import type { CheckOutcome } from "./messages";

export interface WarningActions {
  onLeave: () => void;
  onContinue: () => void;
}

type Shown = Exclude<CheckOutcome, { kind: "none" }>;
type Key = keyof (typeof STRINGS)["en"];

interface Props {
  outcome: Shown;
  actions: WarningActions;
  portal: HTMLElement;
  onClosed: () => void;
}

const Z_OVERLAY = "z-[2147483646]";
const Z_SURFACE = "z-[2147483647]";
const EN = STRINGS.en;
const AR = STRINGS.ar;

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

/** English and Arabic side by side (English left, Arabic right); stacked on narrow screens. */
function Pair({ en, ar, className = "" }: { en: ReactNode; ar: ReactNode; className?: string }) {
  return (
    <div className={`grid gap-x-8 gap-y-1 sm:grid-cols-2 ${className}`}>
      <div lang="en" dir="ltr">{en}</div>
      <div lang="ar" dir="rtl">{ar}</div>
    </div>
  );
}

const pair = (key: Key, className?: string) => <Pair en={EN[key]} ar={AR[key]} className={className} />;

/** A button label in both languages: English, with Arabic underneath. */
function Both({ k }: { k: Key }) {
  return (
    <span className="flex flex-col items-center leading-tight">
      <span>{EN[k]}</span>
      <span lang="ar" dir="rtl" className="mt-1 text-[0.92em] font-medium">{AR[k]}</span>
    </span>
  );
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

function BrandBar({ light }: { light: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src={light ? markLight : markDark} alt="" width={28} height={28} className="h-7 w-7" />
      <span className="text-sm font-semibold tracking-wide">{EN.product}</span>
      <span lang="ar" className="text-sm font-semibold">{AR.product}</span>
    </div>
  );
}

function Site({ domain, className }: { domain: string; className: string }) {
  return (
    <p className={className}>
      <span>{EN.domainLabel}</span>
      <span aria-hidden="true"> · </span>
      <span lang="ar">{AR.domainLabel}</span>
      <span>: </span>
      <bdi dir="ltr" className="font-semibold break-all">{domain}</bdi>
    </p>
  );
}

function Notice({ domain, closing, close, onExitEnd }: {
  domain: string; closing: boolean; close: () => void; onExitEnd: (e: AnimationEvent) => void;
}) {
  return (
    <div role="status" aria-live="polite"
         className={`saqr-root fixed end-4 top-4 ${Z_SURFACE} w-[min(420px,calc(100vw-32px))]`}>
      <div onAnimationEnd={onExitEnd}
           className={`rounded-xl border border-black/15 bg-notice-surface p-5 text-notice-ink ${closing ? "saqr-exit" : "saqr-enter"}`}>
        <BrandBar light={false} />
        <p className="mt-4 font-semibold">{EN.errorTitle}</p>
        <p lang="ar" dir="rtl" className="font-semibold">{AR.errorTitle}</p>
        <Site domain={domain} className="mt-2 text-sm" />
        <p className="mt-2 text-sm">{EN.errorBody}</p>
        <p lang="ar" dir="rtl" className="mt-1 text-sm">{AR.errorBody}</p>
        <button type="button" onClick={close}
                className="saqr-focus-dark mt-4 rounded-lg border border-notice-ink px-4 py-2 text-sm font-semibold">
          <Both k="dismiss" />
        </button>
      </div>
    </div>
  );
}

export default function Warning({ outcome, actions, portal, onClosed }: Props) {
  const [closing, setClosing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const onExitEnd = (e: AnimationEvent) => {
    if (closing && e.target === e.currentTarget && e.animationName === "saqr-exit") onClosed();
  };

  if (outcome.kind === "error") {
    return <Notice domain={outcome.domain} closing={closing} close={() => setClosing(true)} onExitEnd={onExitEnd} />;
  }

  const fraud = outcome.kind === "fraud";
  const reasons = evidence(outcome.reasons);
  const top = reasons[0];
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
        <div onAnimationEnd={onExitEnd}
             className={`saqr-root fixed inset-0 ${Z_SURFACE} flex items-center justify-center overflow-y-auto p-4 ${closing ? "saqr-exit" : ""}`}>
          <AlertDialog.Content
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              primary.current?.focus();
            }}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onKeyDown={trapTab}
            className={fraud
              ? "saqr-enter my-auto w-full max-w-3xl py-8 text-white"
              : "saqr-enter w-full max-w-2xl rounded-xl bg-amber-surface p-7 text-amber-ink"}
          >
            <BrandBar light={fraud} />

            {fraud ? (
              <div className="mt-10">
                <ShieldIcon className="h-12 w-12" />
                <AlertDialog.Title asChild>
                  <div>{pair("fraudTitle", "mt-5 text-3xl font-semibold leading-tight")}</div>
                </AlertDialog.Title>
                <Site domain={outcome.domain} className="mt-4 text-lg" />
                <AlertDialog.Description asChild>
                  <div>{pair("fraudBody", "mt-3 text-white/90")}</div>
                </AlertDialog.Description>
                {top && <Pair en={top.en} ar={top.ar} className="mt-3 font-medium" />}
                <div className="mt-8 flex flex-wrap gap-3">
                  <AlertDialog.Cancel asChild>
                    <button ref={primary} type="button" onClick={leave}
                            className="saqr-focus-light rounded-lg bg-white px-5 py-2.5 font-semibold text-fraud-surface">
                      <Both k="backToSafety" />
                    </button>
                  </AlertDialog.Cancel>
                  <button type="button" onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen}
                          aria-controls="saqr-details"
                          className="saqr-focus-light rounded-lg border border-white/70 px-5 py-2.5 font-semibold">
                    <Both k={detailsOpen ? "hideDetails" : "viewDetails"} />
                  </button>
                </div>
                {detailsOpen && (
                  <section id="saqr-details" className="mt-8 border-t border-white/30 pt-6">
                    {pair("detailsTitle", "font-semibold")}
                    <ul className="mt-3 space-y-3 text-white/90">
                      {reasons.length
                        ? reasons.slice(0, 6).map((r) => <li key={r.code}><Pair en={r.en} ar={r.ar} /></li>)
                        : <li>{pair("modelOnly")}</li>}
                    </ul>
                    <AlertDialog.Action asChild>
                      <button type="button" onClick={continueAnyway}
                              className="saqr-focus-light mt-6 rounded px-1 text-sm text-white/80 underline underline-offset-4">
                        {EN.continueAnyway} · <span lang="ar">{AR.continueAnyway}</span>
                      </button>
                    </AlertDialog.Action>
                    {pair("bypassNote", "mt-2 text-xs text-white/70")}
                  </section>
                )}
              </div>
            ) : (
              <div className="mt-6">
                <div className="flex items-start gap-3">
                  <ShieldIcon className="mt-0.5 h-7 w-7 shrink-0" />
                  <AlertDialog.Title asChild>
                    <div className="flex-1">{pair("suspiciousTitle", "text-xl font-semibold leading-snug")}</div>
                  </AlertDialog.Title>
                </div>
                <Site domain={outcome.domain} className="mt-4" />
                <AlertDialog.Description asChild>
                  <div>{pair("suspiciousBody", "mt-2 text-sm")}</div>
                </AlertDialog.Description>
                {top ? <Pair en={top.en} ar={top.ar} className="mt-3 text-sm font-medium" />
                     : pair("modelOnly", "mt-3 text-sm font-medium")}
                <div className="mt-6 flex flex-wrap gap-3">
                  <AlertDialog.Cancel asChild>
                    <button ref={primary} type="button" onClick={leave}
                            className="saqr-focus-dark rounded-lg bg-amber-ink px-5 py-2.5 font-semibold text-white">
                      <Both k="leave" />
                    </button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <button type="button" onClick={continueAnyway}
                            className="saqr-focus-dark rounded-lg border border-amber-ink px-5 py-2.5 font-semibold">
                      <Both k="continueAnyway" />
                    </button>
                  </AlertDialog.Action>
                </div>
                {pair("bypassNote", "mt-3 text-xs")}
              </div>
            )}
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
