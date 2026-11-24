import type { Brand, Reason, ScanResult, Verdict } from "@shared/contract";
import mark from "@shared/logo/saqr-mark.png";
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { BRAND, localized, productName } from "../../brand";
import { CheckError, checkLink, fetchBrands, reportLink } from "./api";
import "./check.css";
import { AlertIcon, ClipboardIcon, CloseIcon, GlobeIcon, VerdictIcon } from "./icons";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "cancelled" }
  | { kind: "result"; input: string; result: ScanResult }
  | { kind: "error"; reason: "no_link" | "unavailable" };

const STEPS = ["address", "registration", "dns", "visit", "forms", "compare"] as const;
const STEP_MS = 2000;
const TIMEOUT_MS = 30_000;
const OFFICIAL_CODES = new Set(["OFFICIAL_DOMAIN", "GOV_AE_DOMAIN"]);
const press = "transition-transform duration-100 active:scale-[0.98] motion-reduce:transform-none";
const link = "chk-focus rounded font-semibold underline decoration-1 underline-offset-[5px]";

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function belongsTo(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Evidence to show: positive weights, strongest first. The model's reason carries a percentage, so it is left out. */
function evidence(reasons: Reason[]): Reason[] {
  return reasons.filter((r) => r.weight > 0 && r.code !== "ML_MODEL").sort((a, b) => b.weight - a.weight).slice(0, 3);
}

/** A host name that wraps only after its dots, never in the middle of a label. */
function Breakable({ host }: { host: string }) {
  const parts = host.split(".");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              .<wbr />
            </>
          )}
        </span>
      ))}
    </>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function CheckPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [params, setParams] = useSearchParams();
  const requested = params.get("url") ?? "";
  const [text, setText] = useState(requested);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [step, setStep] = useState(0);
  const [pasteHint, setPasteHint] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const barTopBefore = useRef<number | null>(null);
  const engaged = phase.kind !== "idle";

  const stop = () => {
    const current = controller.current;
    controller.current = null; // detach first, so the aborted request does not report "cancelled"
    current?.abort();
  };

  const run = useCallback(async (value: string) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const timer = window.setTimeout(() => ctrl.abort("timeout"), TIMEOUT_MS);
    setPhase({ kind: "checking" });
    setStep(0);
    try {
      const result = await checkLink(value, ctrl.signal);
      if (controller.current === ctrl) setPhase({ kind: "result", input: value, result });
    } catch (err) {
      if (controller.current !== ctrl) return; // replaced by a newer check
      if (ctrl.signal.aborted && ctrl.signal.reason !== "timeout") {
        setPhase({ kind: "cancelled" });
      } else {
        const noLink = err instanceof CheckError && err.status === 422;
        setPhase({ kind: "error", reason: noLink ? "no_link" : "unavailable" });
      }
    } finally {
      window.clearTimeout(timer);
      if (controller.current === ctrl) controller.current = null;
    }
  }, []);

  // The address bar is the source of truth: ?url= runs a check, so refresh, Back and shared links all work.
  useEffect(() => {
    if (requested) {
      setText(requested);
      void run(requested);
    } else {
      stop();
      setPhase({ kind: "idle" });
    }
  }, [requested, run]);

  useEffect(() => {
    if (phase.kind !== "checking") return;
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), STEP_MS);
    return () => window.clearInterval(id);
  }, [phase.kind]);

  // Slide the bar from the centre to the top the first time a check starts.
  useLayoutEffect(() => {
    const before = barTopBefore.current;
    barTopBefore.current = null;
    const bar = barRef.current;
    if (!engaged || before === null || !bar || prefersReducedMotion()) return;
    const delta = before - bar.getBoundingClientRect().top;
    if (Math.abs(delta) > 1) {
      bar.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }],
                  { duration: 250, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
  }, [engaged]);

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setPasteHint(false);
    if (!engaged) barTopBefore.current = barRef.current?.getBoundingClientRect().top ?? null;
    if (trimmed === requested) void run(trimmed);
    else setParams({ url: trimmed });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(text);
  };

  const paste = async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) throw new Error("empty clipboard");
      setText(clip);
      submit(clip);
    } catch {
      setPasteHint(true);
      inputRef.current?.focus();
    }
  };

  const cancel = () => {
    stop();
    setPhase({ kind: "cancelled" });
  };

  const clear = () => {
    setText("");
    setPasteHint(false);
    inputRef.current?.focus();
  };

  const checkAnother = () => {
    setText("");
    setParams({});
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const toggleLang = () => i18n.changeLanguage(lang === "ar" ? "en" : "ar");
  const verdict = phase.kind === "result" ? phase.result.verdict : undefined;
  const submitLabel = t("check.check");

  return (
    <div className="chk-page" data-verdict={verdict}>
      <header className="chk-pad flex h-16 items-center gap-3 sm:h-20">
        {engaged && (
          <button type="button" onClick={checkAnother}
                  className="chk-enter chk-focus flex min-h-11 items-center gap-2.5 rounded">
            <img src={mark} alt="" width={36} height={36} className="h-8 w-8 sm:h-9 sm:w-9" />
            <span className="text-lg font-semibold tracking-wide sm:text-xl">{productName(lang)}</span>
          </button>
        )}
        <button type="button" onClick={toggleLang} lang={lang === "ar" ? "en" : "ar"}
                className="chk-focus chk-muted ms-auto flex min-h-11 items-center gap-2 rounded-lg px-3 hover:bg-[#0b1e33]/5 hover:text-[#0b1e33]">
          <GlobeIcon className="h-5 w-5" />
          <span className="text-[15px] sm:text-base">{t("lang_toggle")}</span>
        </button>
      </header>

      <main className={`chk-column flex flex-1 flex-col ${engaged ? "pt-2 sm:pt-6" : "justify-center pb-[8vh]"}`}>
        {!engaged && (
          <div className="mb-[clamp(1.5rem,3vh,2.75rem)] flex flex-col items-center text-center">
            <img src={mark} alt="" width={136} height={136} className="chk-mark" />
            <h1 className="chk-title mt-4 font-semibold tracking-tight">{productName(lang)}</h1>
            <p className="chk-gold mt-2 text-[0.95em] font-medium">
              {localized(lang, BRAND.tagline_en, BRAND.tagline_ar)}
            </p>
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="chk-input" className={engaged ? "sr-only" : "chk-intro chk-muted mb-5 block text-center"}>
            {t("check.intro")}
          </label>
          <div ref={barRef}
               className="chk-bar flex items-center rounded-2xl border border-[#0b1e33]/15 bg-white transition-[border-color,box-shadow] duration-150">
            <input
              ref={inputRef}
              id="chk-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("check.placeholder")}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              dir={text ? "auto" : undefined}
              className="chk-input h-full min-w-0 flex-1 bg-transparent ps-5 outline-none placeholder:text-[#0b1e33]/45"
            />
            {text ? (
              <button type="button" onClick={clear} aria-label={t("check.clear")}
                      className="chk-focus me-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#0b1e33]/55 hover:text-[#0b1e33]">
                <CloseIcon className="h-5 w-5" />
              </button>
            ) : (
              <button type="button" onClick={paste}
                      className={`chk-focus me-1.5 flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 font-medium hover:bg-[#0b1e33]/5 ${press}`}>
                <ClipboardIcon className="h-[1.15em] w-[1.15em]" />
                {t("check.paste")}
              </button>
            )}
            <button type="submit" disabled={!text.trim()}
                    className={`chk-focus chk-check-btn me-2 hidden h-[calc(100%-1rem)] shrink-0 items-center rounded-xl px-7 font-semibold sm:flex ${press}`}>
              {submitLabel}
            </button>
          </div>
          <div className={`mt-2.5 ${phase.kind === "checking" ? "chk-progress" : "h-[3px]"}`} aria-hidden="true" />
          <button type="submit" disabled={!text.trim()}
                  className={`chk-focus chk-check-btn mt-3 h-[3.25rem] w-full rounded-2xl text-[1.0625rem] font-semibold sm:hidden ${press}`}>
            {submitLabel}
          </button>
          {pasteHint && <p className="chk-enter chk-muted mt-3 text-[0.95em]">{t("check.paste_hint")}</p>}
        </form>

        <section aria-live="polite" className="mt-[clamp(1.75rem,4vh,3rem)] pb-8">
          {phase.kind === "checking" && (
            <div className="chk-enter flex items-center justify-between gap-4">
              <span className="sr-only">{t("check.checking")}</span>
              <p className="chk-muted" aria-hidden="true">{t(`check.steps.${STEPS[step]}`)}</p>
              <button type="button" onClick={cancel} className={`${link} chk-muted min-h-11 shrink-0 px-1 font-normal`}>
                {t("check.cancel")}
              </button>
            </div>
          )}
          {phase.kind === "cancelled" && <p className="chk-enter chk-muted">{t("check.cancelled")}</p>}
          {phase.kind === "error" && <ErrorView reason={phase.reason} />}
          {phase.kind === "result" && (
            <ResultView key={phase.result.id} input={phase.input} result={phase.result} onAnother={checkAnother} />
          )}
        </section>
      </main>

      <footer className="chk-pad chk-subtle pb-6 text-center text-[0.8125em] leading-relaxed">
        {localized(lang, BRAND.footer_en, BRAND.footer_ar)}
      </footer>
    </div>
  );
}

function ErrorView({ reason }: { reason: "no_link" | "unavailable" }) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="chk-enter flex gap-3">
      <AlertIcon className="chk-gold mt-1 h-7 w-7 shrink-0" />
      <div>
        <h2 ref={heading} tabIndex={-1} className="text-[1.25em] font-semibold outline-none">
          {t(reason === "no_link" ? "check.error_no_link_title" : "check.error_unavailable_title")}
        </h2>
        <p className="chk-muted mt-1 leading-relaxed">
          {t(reason === "no_link" ? "check.error_no_link" : "check.error_unavailable")}
        </p>
      </div>
    </div>
  );
}

function ResultView({ input, result, onAnother }: { input: string; result: ScanResult; onAnother: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const heading = useRef<HTMLHeadingElement>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [report, setReport] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const verdict: Verdict = result.verdict;
  const shown = evidence(result.reasons);
  const official = result.reasons.find((r) => OFFICIAL_CODES.has(r.code));
  const text = (r: Reason) => localized(lang, r.en, r.ar);
  let delay = 0;
  const next = () => ({ animationDelay: `${(delay += 40)}ms` });

  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const id = result.impersonated_brand;
    if (!id || verdict === "safe") return;
    fetchBrands().then((list) => setBrand(list.find((b) => b.id === id) ?? null)).catch(() => setBrand(null));
  }, [result.impersonated_brand, verdict]);

  const sendReport = async () => {
    setReport("sending");
    try {
      await reportLink(input);
      setReport("done");
    } catch {
      setReport("failed");
    }
  };

  const host = hostOf(result.normalized_url) ?? result.registered_domain;
  const domain = result.registered_domain;
  const prefix = belongsTo(host, domain) ? host.slice(0, host.length - domain.length) : "";
  const disguised = prefix !== "" && prefix !== "www.";
  const finalHost = hostOf(result.final_url);
  const redirected = finalHost !== null && !belongsTo(finalHost, domain);
  const phone = brand?.official_phones.find((p) => p.verified);
  const realDomain = brand?.official_domains[0];
  const bullet = (tone: string) => <span className={`mt-[0.62em] h-1.5 w-1.5 shrink-0 rounded-full bg-current ${tone}`} aria-hidden="true" />;

  return (
    <article className="leading-relaxed">
      <div className="chk-enter flex items-start gap-3 sm:gap-4">
        <VerdictIcon verdict={verdict} className="chk-tone mt-1 h-[1.9em] w-[1.9em] shrink-0 sm:h-[2.3em] sm:w-[2.3em]" />
        <div>
          <h2 ref={heading} tabIndex={-1} className="chk-tone chk-verdict font-semibold outline-none">
            {t(`check.verdict.${verdict}`)}
          </h2>
          <p className="chk-muted mt-2">{t(official ? "check.lead.official" : `check.lead.${verdict}`)}</p>
        </div>
      </div>

      <div className="chk-enter mt-8" style={next()}>
        <p className="chk-label">{t("check.goes_to")}</p>
        <p className="chk-domain mt-1 font-semibold [overflow-wrap:anywhere]">
          <bdi dir="ltr">
            {prefix && <span className="chk-subtle font-normal"><Breakable host={prefix} /></span>}
            <Breakable host={domain} />
          </bdi>
        </p>
        {disguised && <p className="chk-muted mt-2 text-[0.95em]">{t("check.disguise_note")}</p>}
        {redirected && (
          <p className="chk-muted mt-2 text-[0.95em]">
            {t("check.redirects_to")} <bdi dir="ltr" className="font-semibold">{finalHost}</bdi>
          </p>
        )}
        {result.status === "offline" && <p className="chk-subtle mt-2 text-[0.95em]">{t("check.offline")}</p>}
      </div>

      {(shown.length > 0 || (verdict === "safe" && official)) && (
        <div className="chk-enter chk-rule mt-7 border-t pt-6" style={next()}>
          <h3 className="chk-label">{t("check.why")}</h3>
          <ul className="mt-3 space-y-2.5">
            {(shown.length ? shown : [official!]).map((r) => (
              <li key={r.code} className="flex gap-3">
                {bullet("chk-tone")}
                <span>{text(r)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="chk-enter chk-rule mt-7 border-t pt-6" style={next()}>
        <h3 className="chk-label">{t("check.what_now")}</h3>
        {verdict === "safe" ? (
          <p className="chk-muted mt-3">{t("check.advice_safe")}</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {(["advice_dont_open", "advice_no_details", "advice_bank"] as const).map((key) => (
              <li key={key} className="flex gap-3">
                {bullet("chk-subtle")}
                <span>{t(`check.${key}`)}</span>
              </li>
            ))}
          </ul>
        )}
        {brand && realDomain && (
          <p className="mt-5">
            {t("check.pretends_to_be", { brand: localized(lang, brand.name_en, brand.name_ar) })}{" "}
            {t("check.real_site")}{" "}
            <a href={`https://${realDomain}`} target="_blank" rel="noopener noreferrer" className={`${link} chk-gold`}>
              <bdi dir="ltr">{realDomain}</bdi>
            </a>
            {phone && (
              <>
                {" "}{t("check.official_number")}{" "}
                <a href={`tel:${phone.number}`} className={`${link} chk-gold`}>
                  <bdi dir="ltr">{phone.number}</bdi>
                </a>
              </>
            )}
          </p>
        )}
      </div>

      <div className="chk-enter mt-8 flex flex-wrap items-center gap-x-7 gap-y-1" style={next()}>
        {verdict !== "safe" && (
          report === "done" ? (
            <p className="chk-muted min-h-11 py-2.5">{t("check.reported")}</p>
          ) : (
            <button type="button" onClick={sendReport} disabled={report === "sending"}
                    className={`${link} chk-tone min-h-11 disabled:opacity-50`}>
              {report === "failed" ? t("check.report_retry") : t("check.report")}
            </button>
          )
        )}
        <button type="button" onClick={onAnother} className={`${link} min-h-11`}>
          {t("check.another")}
        </button>
      </div>
    </article>
  );
}
