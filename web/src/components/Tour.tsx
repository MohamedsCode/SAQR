import logo from "@shared/logo/saqr-logo.png";
import { createContext, type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { BRAND, localized } from "../brand";

// The tour walks judges through the product; each step points at an element marked data-tour="<target>".
type Criterion = "accuracy" | "early" | "explain" | "uae" | "feasibility";
interface Step {
  id: string;
  route: string | "case";
  target?: string;
  criteria: Criterion[];
}

const STEPS: Step[] = [
  { id: "welcome", route: "/", criteria: [] },
  { id: "feed", route: "/", target: "feed", criteria: ["early", "uae"] },
  { id: "case", route: "case", target: "case-header", criteria: ["accuracy"] },
  { id: "reasons", route: "case", target: "reasons", criteria: ["explain", "uae"] },
  { id: "visual", route: "case", target: "visual", criteria: ["accuracy", "uae"] },
  { id: "evidence", route: "case", target: "evidence", criteria: ["explain", "feasibility"] },
  { id: "model", route: "/model", target: "model-cards", criteria: ["accuracy"] },
  { id: "demo", route: "/", target: "demo", criteria: ["feasibility", "early"] },
];

const PAD = 10;
const CARD_W = 380;
const AUTOPLAY_MS = 5000;

interface TourContextValue {
  start: () => void;
}

const TourContext = createContext<TourContextValue>({ start: () => undefined });

export function useTour() {
  return useContext(TourContext);
}

async function showcaseCase(): Promise<string | null> {
  const scans = await api.scans().catch(() => []);
  const best = [...scans].sort((a, b) => b.score - a.score || b.reasons.length - a.reasons.length)[0];
  return best?.id ?? null;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<number | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const start = useCallback(() => {
    showcaseCase().then(setCaseId);
    setIndex(0);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tour") === "1") start();
  }, [start]);

  const step = index === null ? null : STEPS[index];
  const route = step ? (step.route === "case" ? (caseId ? `/cases/${caseId}` : null) : step.route) : null;

  useEffect(() => {
    if (route && location.pathname !== route) navigate(route);
  }, [route, location.pathname, navigate]);

  const close = () => {
    setIndex(null);
    setAutoplay(false);
  };
  const go = (delta: number) =>
    setIndex((i) => (i === null ? null : Math.min(STEPS.length - 1, Math.max(0, i + delta))));

  useEffect(() => {
    if (index === null || !autoplay) return;
    const id = setTimeout(() => (index === STEPS.length - 1 ? setAutoplay(false) : go(1)), AUTOPLAY_MS);
    return () => clearTimeout(id);
  }, [index, autoplay]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") go(document.dir === "rtl" ? -1 : 1);
      if (event.key === "ArrowLeft") go(document.dir === "rtl" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index]);

  return (
    <TourContext.Provider value={{ start }}>
      {children}
      {step && index !== null && (
        <TourOverlay
          step={step}
          index={index}
          ready={route !== null && location.pathname === route}
          onNext={() => (index === STEPS.length - 1 ? close() : go(1))}
          onBack={() => go(-1)}
          onClose={close}
          autoplay={autoplay}
          onToggleAutoplay={() => setAutoplay((on) => !on)}
        />
      )}
    </TourContext.Provider>
  );
}

function useTargetRect(target: string | undefined, ready: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!target) setRect(null);
    if (!target || !ready) return;
    let frame = 0;
    let scrolled = false;
    const started = performance.now();
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) {
        if (!scrolled) {
          el.scrollIntoView({ behavior: "smooth", block: el.offsetHeight > window.innerHeight * 0.6 ? "start" : "center" });
          scrolled = true;
        }
        const next = el.getBoundingClientRect();
        setRect((prev) =>
          prev && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5 && prev.width === next.width && prev.height === next.height
            ? prev
            : next,
        );
      } else if (performance.now() - started > 4000) {
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ready]);

  return rect;
}

function TourOverlay({
  step,
  index,
  ready,
  onNext,
  onBack,
  onClose,
  autoplay,
  onToggleAutoplay,
}: {
  step: Step;
  index: number;
  ready: boolean;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  autoplay: boolean;
  onToggleAutoplay: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const rect = useTargetRect(step.target, ready);
  const centered = !step.target;
  const last = index === STEPS.length - 1;

  const box = rect && {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: Math.min(rect.height + PAD * 2, window.innerHeight - 20),
  };

  let cardStyle: CSSProperties = { width: CARD_W };
  if (box) {
    const cardHeight = 280;
    const below = box.top + box.height + 16;
    const above = box.top - cardHeight - 16;
    const top = below + cardHeight < window.innerHeight ? below : above > 16 ? above : window.innerHeight - cardHeight - 16;
    const left = Math.min(Math.max(16, box.left + box.width / 2 - CARD_W / 2), window.innerWidth - CARD_W - 16);
    cardStyle = { ...cardStyle, top, left };
  }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={t("tour.label")}>
      {centered || !box ? (
        <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      ) : (
        <>
          <div className="absolute inset-0" onClick={onClose} />
          <div
            className="pointer-events-none absolute rounded-2xl ring-2 ring-gold transition-all duration-700 ease-[cubic-bezier(.2,.9,.2,1)]"
            style={{ ...box, boxShadow: "0 0 0 9999px rgb(5 10 19 / 0.78), 0 0 40px 6px rgb(212 166 60 / 0.55)" }}
          />
          <div
            key={step.id}
            className="tour-pulse pointer-events-none absolute rounded-2xl border-2 border-gold/70 transition-all duration-700"
            style={box}
          />
        </>
      )}

      {centered ? (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="panel glow-gold animate-fade-up w-full max-w-xl p-8 text-center">
            {step.id === "welcome" && (
              <div className="relative mx-auto mb-5 grid size-44 place-items-center">
                <span className="tour-radar absolute inset-0 rounded-full border border-gold/60" />
                <span className="tour-radar absolute inset-0 rounded-full border border-gold/60" style={{ animationDelay: "0.8s" }} />
                <span className="tour-radar absolute inset-0 rounded-full border border-gold/60" style={{ animationDelay: "1.6s" }} />
                <img src={logo} alt="" className="tour-float relative h-36 rounded-2xl bg-white p-3 shadow-[0_0_40px_rgba(212,166,60,0.5)]" />
              </div>
            )}
            <h2 className="text-3xl font-bold">{t(`tour.steps.${step.id}.title`)}</h2>
            <p className="mt-1 font-semibold text-gold-soft">{localized(lang, BRAND.tagline_en, BRAND.tagline_ar)}</p>
            <p className="mx-auto mt-3 max-w-md leading-relaxed text-text/85">{t(`tour.steps.${step.id}.body`)}</p>
            {step.id === "welcome" && (
              <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
                {(["find", "explain", "act"] as const).map((pillar, i) => (
                  <div key={pillar} className="animate-fade-up rounded-xl border border-line bg-bg/50 p-3" style={{ animationDelay: `${300 + i * 180}ms` }}>
                    <div className="font-semibold text-gold-soft">{t(`tour.pillars.${pillar}.title`)}</div>
                    <div className="mt-1 text-xs text-muted">{t(`tour.pillars.${pillar}.body`)}</div>
                  </div>
                ))}
              </div>
            )}
            <Controls index={index} last={last} onNext={onNext} onBack={onBack} onClose={onClose} autoplay={autoplay} onToggleAutoplay={onToggleAutoplay} centered />
          </div>
        </div>
      ) : (
        box && (
          <div className="panel animate-fade-up absolute p-5 shadow-2xl" style={cardStyle} key={step.id}>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {step.criteria.map((criterion, i) => (
                <span key={criterion} style={{ animationDelay: `${150 + i * 120}ms` }} className="tour-pop rounded-full bg-gold/15 px-2.5 py-0.5 text-[11px] font-semibold text-gold-soft ring-1 ring-gold/40">
                  {t(`tour.criteria.${criterion}`)}
                </span>
              ))}
            </div>
            <h3 className="text-lg font-bold">{t(`tour.steps.${step.id}.title`)}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-text/85">{t(`tour.steps.${step.id}.body`)}</p>
            <Controls index={index} last={last} onNext={onNext} onBack={onBack} onClose={onClose} autoplay={autoplay} onToggleAutoplay={onToggleAutoplay} />
          </div>
        )
      )}
    </div>
  );
}

function Controls({
  index,
  last,
  onNext,
  onBack,
  onClose,
  autoplay,
  onToggleAutoplay,
  centered = false,
}: {
  index: number;
  last: boolean;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  autoplay: boolean;
  onToggleAutoplay: () => void;
  centered?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {autoplay && (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-line">
          <div key={index} className="tour-progress h-full rounded-full bg-gold" style={{ animationDuration: `${AUTOPLAY_MS}ms` }} />
        </div>
      )}
      <div className={`mt-4 flex items-center gap-3 ${centered ? "justify-center" : ""}`}>
        <button
          type="button"
          onClick={onToggleAutoplay}
          title={t(autoplay ? "tour.pause" : "tour.autoplay")}
          aria-label={t(autoplay ? "tour.pause" : "tour.autoplay")}
          className="grid size-7 shrink-0 place-items-center rounded-full text-xs text-gold-soft ring-1 ring-gold/50 hover:bg-gold/15"
        >
          {autoplay ? "❚❚" : "▶"}
        </button>
      <div className="flex gap-1" aria-label={t("tour.progress", { current: index + 1, total: STEPS.length })}>
        {STEPS.map((s, i) => (
          <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-gold" : i < index ? "w-1.5 bg-gold/60" : "w-1.5 bg-line"}`} />
        ))}
      </div>
      <span className="flex-1" />
      {!last && (
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-text">
          {t("tour.skip")}
        </button>
      )}
      {index > 0 && (
        <button type="button" onClick={onBack} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-gold/60">
          {t("tour.back")}
        </button>
      )}
      <button type="button" onClick={onNext} className="rounded-lg bg-gold px-4 py-1.5 text-sm font-semibold text-bg hover:bg-gold-soft" autoFocus>
        {last ? t("tour.finish") : index === 0 ? t("tour.start") : t("tour.next")}
      </button>
    </div>
    </>
  );
}
