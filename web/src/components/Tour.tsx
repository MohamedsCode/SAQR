import logo from "@shared/logo/saqr-mark-white.png";
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { BRAND, localized } from "../brand";
import { type DemoEvent, emitDemo, useDemoEvents } from "../lib/demoBus";

// A one-minute story for judges. Each stop spotlights an element marked data-tour="<target>" and names the
// judging criterion it proves; the live-demo stop embeds the phone simulator.
type Criterion = "early" | "uae" | "explain" | "feasibility" | "accuracy";

interface Step {
  id: string;
  route?: string | "case";
  target?: string;
  criterion?: Criterion;
  align?: "top" | "center";
}

const STEPS: Step[] = [
  { id: "welcome", route: "/" },
  { id: "early", route: "/", target: "seen-first", criterion: "early", align: "top" },
  { id: "uae", route: "case", target: "case-header", criterion: "uae", align: "top" },
  { id: "explain", route: "case", target: "reasons", criterion: "explain", align: "top" },
  { id: "act", route: "case", target: "evidence", criterion: "feasibility", align: "center" },
  { id: "accuracy", route: "/model", target: "model-cards", criterion: "accuracy", align: "top" },
  { id: "phone", route: "/" },
  { id: "finish" },
];
const CENTERED = new Set(["welcome", "phone", "finish"]);
const STOPS = STEPS.length - 2;

// Criterion colours, tuned to read on the dark ink card.
const CRITERIA: Record<Criterion, string> = {
  accuracy: "#5fd3a4",
  early: "#c9a04a",
  explain: "#b69cff",
  uae: "#f0a35e",
  feasibility: "#7fa8ff",
};
const CRITERIA_ORDER: Criterion[] = ["accuracy", "early", "explain", "uae", "feasibility"];

const PAD = 12;
const GAP = 18;
const CARD_W = 400;
const AUTOPLAY_MS = 7000;

interface TourContextValue {
  start: () => void;
  active: boolean;
}

const TourContext = createContext<TourContextValue>({ start: () => undefined, active: false });

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
    setAutoplay(false);
    setIndex(0);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tour") === "1") start();
  }, [start]);

  const step = index === null ? null : STEPS[index];
  const route = !step?.route ? null : step.route === "case" ? (caseId ? `/cases/${caseId}` : null) : step.route;
  const waiting = !!step?.route && route === null;

  useEffect(() => {
    if (route && location.pathname !== route) navigate(route);
  }, [route, location.pathname, navigate]);

  const close = useCallback(() => {
    setIndex(null);
    setAutoplay(false);
  }, []);
  const go = useCallback((delta: number) => setIndex((i) => (i === null ? null : Math.min(STEPS.length - 1, Math.max(0, i + delta)))), []);

  // Autoplay pauses on the live demo: that stop waits for the presenter.
  useEffect(() => {
    if (index === null || !autoplay) return;
    if (STEPS[index].id === "phone") {
      setAutoplay(false);
      return;
    }
    const id = setTimeout(() => (index === STEPS.length - 1 ? setAutoplay(false) : go(1)), AUTOPLAY_MS);
    return () => clearTimeout(id);
  }, [index, autoplay, go]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") go(document.dir === "rtl" ? -1 : 1);
      if (event.key === "ArrowLeft") go(document.dir === "rtl" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, close, go]);

  return (
    <TourContext.Provider value={{ start, active: index !== null }}>
      {children}
      {step && index !== null && (
        <TourOverlay
          step={step}
          index={index}
          ready={!waiting && (route === null || location.pathname === route)}
          autoplay={autoplay}
          onNext={() => (index === STEPS.length - 1 ? close() : go(1))}
          onBack={() => go(-1)}
          onClose={close}
          onRestart={start}
          onPlay={() => {
            setAutoplay(true);
            if (index === 0) go(1);
          }}
          onToggleAutoplay={() => setAutoplay((on) => !on)}
          onExplore={() => {
            close();
            navigate("/scan");
          }}
        />
      )}
    </TourContext.Provider>
  );
}

/** Scrolls the target into place once, then follows its position every frame so the spotlight never drifts. */
function useTargetRect(step: Step, ready: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState(false);

  useLayoutEffect(() => {
    setMissing(false);
    if (!step.target || !ready) return;
    let frame = 0;
    let scrolled = false;
    const started = performance.now();
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        if (!scrolled) {
          const r = el.getBoundingClientRect();
          const top = step.align === "center" ? r.top + window.scrollY - (window.innerHeight - r.height) / 2 : r.top + window.scrollY - 28;
          window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
          scrolled = true;
        }
        const next = el.getBoundingClientRect();
        setRect((prev) =>
          prev && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5 && prev.width === next.width && prev.height === next.height
            ? prev
            : next,
        );
      } else if (performance.now() - started > 3500) {
        setMissing(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step, ready]);

  return step.target && !missing ? rect : null;
}

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/** Puts the card below, above, beside, or (for very large targets) in the corner of the spotlight. */
function placeCard(box: { top: number; left: number; width: number; height: number }, w: number, h: number, vw: number, vh: number): CSSProperties {
  const minTop = 12;
  const clampLeft = (x: number) => Math.min(Math.max(16, x), vw - w - 16);
  const clampTop = (y: number) => Math.min(Math.max(minTop, y), vh - h - 16);
  const bottom = box.top + box.height;
  const right = box.left + box.width;
  if (bottom + GAP + h <= vh - 16) return { top: bottom + GAP, left: clampLeft(box.left + box.width / 2 - w / 2) };
  if (box.top - GAP - h >= minTop) return { top: box.top - GAP - h, left: clampLeft(box.left + box.width / 2 - w / 2) };
  if (vw - right - GAP - w >= 16) return { top: clampTop(box.top + box.height / 2 - h / 2), left: right + GAP };
  if (box.left - GAP - w >= 16) return { top: clampTop(box.top + box.height / 2 - h / 2), left: box.left - GAP - w };
  return { top: vh - h - 24, left: document.dir === "rtl" ? 24 : vw - w - 24 };
}

function TourOverlay({
  step,
  index,
  ready,
  autoplay,
  onNext,
  onBack,
  onClose,
  onRestart,
  onPlay,
  onToggleAutoplay,
  onExplore,
}: {
  step: Step;
  index: number;
  ready: boolean;
  autoplay: boolean;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  onRestart: () => void;
  onPlay: () => void;
  onToggleAutoplay: () => void;
  onExplore: () => void;
}) {
  const { t } = useTranslation();
  const { w: vw, h: vh } = useViewport();
  const rect = useTargetRect(step, ready);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(260);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setCardH(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const spotlit = !!rect && !CENTERED.has(step.id);
  const box =
    rect && spotlit
      ? { top: Math.max(4, rect.top - PAD), left: rect.left - PAD, width: rect.width + PAD * 2, height: Math.min(rect.height + PAD * 2, vh - 24) }
      : { top: vh / 2, left: vw / 2, width: 0, height: 0 };

  const hero = !spotlit;
  const width = step.id === "phone" ? Math.min(780, vw - 32) : hero ? Math.min(600, vw - 32) : Math.min(CARD_W, vw - 32);
  const cardStyle: CSSProperties = hero
    ? { width, top: Math.max(16, (vh - cardH) / 2), left: (vw - width) / 2 }
    : { width, ...placeCard(box, width, cardH, vw, vh) };

  return (
    <div className="ops-font fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={t("tour.label")}>
      <div className="absolute inset-0" />
      {/* The dimmed page with a hole cut around the target; it glides between stops. */}
      <div
        className="pointer-events-none absolute rounded-[20px] transition-all duration-700 ease-[cubic-bezier(.22,1,.36,1)]"
        style={{
          ...box,
          boxShadow: `0 0 0 9999px rgb(4 12 10 / ${hero ? 0.66 : 0.72})${spotlit ? ", 0 0 0 2px #c9a04a, 0 0 0 9px rgb(201 160 74 / 0.16), 0 0 60px 10px rgb(201 160 74 / 0.18)" : ""}`,
        }}
      />
      {spotlit && <div key={step.id} className="tour-pulse pointer-events-none absolute rounded-[20px] border-2 border-brass/70" style={box} />}

      <div
        ref={cardRef}
        className="absolute overflow-hidden rounded-[24px] bg-ink text-white shadow-[0_40px_90px_-20px_rgb(0_0_0/0.7)] ring-1 ring-white/10 transition-[top,left,width] duration-700 ease-[cubic-bezier(.22,1,.36,1)]"
        style={cardStyle}
      >
        <div className="eye-rings pointer-events-none absolute -end-32 -top-40 size-[360px] opacity-80" />
        <div className="relative">
          <Progress index={index} autoplay={autoplay} />
          <div key={step.id} className="tour-fade">
            {step.id === "welcome" ? (
              <Welcome onStart={onNext} onPlay={onPlay} onClose={onClose} />
            ) : step.id === "phone" ? (
              <PhoneStop index={index} onNext={onNext} onBack={onBack} onClose={onClose} />
            ) : step.id === "finish" ? (
              <Finish onExplore={onExplore} onRestart={onRestart} onClose={onClose} />
            ) : (
              <StepBody step={step} index={index} autoplay={autoplay} onNext={onNext} onBack={onBack} onClose={onClose} onToggleAutoplay={onToggleAutoplay} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Progress({ index, autoplay }: { index: number; autoplay: boolean }) {
  return (
    <div className="flex gap-1 px-5 pt-4">
      {STEPS.map((s, i) => (
        <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
          {i < index && <span className="block h-full w-full rounded-full bg-brass/60" />}
          {i === index &&
            (autoplay ? (
              <span key={`a${index}`} className="tour-progress block h-full rounded-full bg-brass" style={{ animationDuration: `${AUTOPLAY_MS}ms` }} />
            ) : (
              <span className="block h-full w-full rounded-full bg-brass" />
            ))}
        </span>
      ))}
    </div>
  );
}

const primary =
  "rounded-xl bg-brass px-5 py-2.5 text-sm font-semibold text-ink shadow-[0_8px_24px_-8px_rgb(201_160_74/0.6)] transition hover:-translate-y-px hover:bg-[#d8b462]";
const ghost = "rounded-xl px-3.5 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white";
const outline = "rounded-xl border border-white/20 px-5 py-2.5 text-sm font-medium text-white/90 transition hover:border-brass/60 hover:text-brass";

function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("tour.skip")}
      className="grid size-8 shrink-0 place-items-center rounded-full text-lg leading-none text-white/50 transition hover:bg-white/10 hover:text-white"
    >
      ×
    </button>
  );
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ color, borderColor: `${color}55`, background: `${color}14` }}>
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

function Counter({ index }: { index: number }) {
  const { t } = useTranslation();
  return <span className="text-xs font-medium tabular-nums text-white/45">{t("tour.progress", { current: index, total: STOPS })}</span>;
}

function StepBody({
  step,
  index,
  autoplay,
  onNext,
  onBack,
  onClose,
  onToggleAutoplay,
}: {
  step: Step;
  index: number;
  autoplay: boolean;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  onToggleAutoplay: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="p-5 pt-4">
      <div className="flex items-center gap-2">
        {step.criterion && <Chip color={CRITERIA[step.criterion]}>{t(`tour.criteria.${step.criterion}`)}</Chip>}
        <span className="flex-1" />
        <Counter index={index} />
        <CloseButton onClose={onClose} />
      </div>
      <h3 className="font-display mt-3 text-[22px] font-semibold leading-snug">{t(`tour.steps.${step.id}.title`)}</h3>
      <p className="mt-2 text-[14.5px] leading-relaxed text-white/70">{t(`tour.steps.${step.id}.body`)}</p>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleAutoplay}
          title={t(autoplay ? "tour.pause" : "tour.autoplay")}
          aria-label={t(autoplay ? "tour.pause" : "tour.autoplay")}
          className="grid size-9 place-items-center rounded-full border border-white/15 text-[11px] text-brass transition hover:border-brass/60 hover:bg-brass/10"
        >
          {autoplay ? "❚❚" : "▶"}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onBack} className={ghost}>
          {t("tour.back")}
        </button>
        <button type="button" onClick={onNext} autoFocus className={primary}>
          {t("tour.next")} <span className="inline-block rtl:rotate-180">→</span>
        </button>
      </div>
    </div>
  );
}

function Welcome({ onStart, onPlay, onClose }: { onStart: () => void; onPlay: () => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <div className="relative px-8 pb-7 pt-4 text-center">
      <div className="absolute end-4 top-2">
        <CloseButton onClose={onClose} />
      </div>
      <div className="relative mx-auto mb-4 mt-4 grid size-28 place-items-center">
        <span className="tour-radar absolute inset-0 rounded-full border border-brass/50" />
        <span className="tour-radar absolute inset-0 rounded-full border border-brass/50" style={{ animationDelay: "0.8s" }} />
        <span className="tour-radar absolute inset-0 rounded-full border border-brass/50" style={{ animationDelay: "1.6s" }} />
        <span className="relative grid size-24 place-items-center rounded-full bg-gradient-to-b from-white/10 to-white/[0.02] ring-1 ring-brass/40">
          <img src={logo} alt="" className="size-16 object-contain" />
        </span>
      </div>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brass">{t("tour.kicker")}</div>
      <h2 className="font-display mt-2 text-[34px] font-semibold leading-tight">{t("tour.steps.welcome.title")}</h2>
      <p className="mt-1 text-[15px] font-medium text-brass">{localized(lang, BRAND.tagline_en, BRAND.tagline_ar)}</p>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-white/70">{t("tour.steps.welcome.body")}</p>
      <div className="mt-6 grid grid-cols-3 gap-3 text-start">
        {(["find", "explain", "act"] as const).map((pillar, i) => (
          <div key={pillar} className="tour-pop rounded-2xl border border-white/10 bg-white/[0.04] p-3.5" style={{ animationDelay: `${250 + i * 120}ms` }}>
            <div className="text-[13px] font-semibold text-brass">{t(`tour.pillars.${pillar}.title`)}</div>
            <div className="mt-1 text-xs leading-snug text-white/55">{t(`tour.pillars.${pillar}.body`)}</div>
          </div>
        ))}
      </div>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={onStart} autoFocus className={`${primary} px-6 py-3 text-[15px]`}>
          {t("tour.start")} <span className="inline-block rtl:rotate-180">→</span>
        </button>
        <button type="button" onClick={onPlay} className={`${outline} flex items-center gap-2 py-3 text-[15px]`}>
          <span className="text-[11px] text-brass">▶</span>
          {t("tour.autoplay")}
        </button>
      </div>
      <p className="mt-4 text-xs text-white/40">{t("tour.hint")}</p>
    </div>
  );
}

type PhoneState = "idle" | "ringing" | "in_call" | "sms" | "blocked";

/** The live demo: the phone simulator inside a phone frame, with a button that rings it. */
function PhoneStop({ index, onNext, onBack, onClose }: { index: number; onNext: () => void; onBack: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState<PhoneState>("idle");
  useDemoEvents((event: DemoEvent) => {
    const next: Partial<Record<DemoEvent["type"], PhoneState>> = {
      trigger: "ringing",
      call_answered: "in_call",
      call_ended: "sms",
      blocked: "blocked",
      reset: "idle",
    };
    if (next[event.type]) setPhone(next[event.type]!);
  });
  const url = `${window.location.origin}/demo/phone`;
  const SCALE = 0.56;
  return (
    <div className="grid gap-6 p-6 pt-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <Chip color="#ff6b5e">{t("tour.phone_chip")}</Chip>
          <span className="flex-1" />
          <Counter index={index} />
          <CloseButton onClose={onClose} />
        </div>
        <h3 className="font-display mt-3 text-[26px] font-semibold leading-tight">{t("tour.steps.phone.title")}</h3>
        <p className="mt-2 text-[14.5px] leading-relaxed text-white/70">{t("tour.steps.phone.body")}</p>
        <ol className="mt-5 space-y-2.5">
          {(["1", "2", "3"] as const).map((n) => (
            <li key={n} className="flex items-start gap-3 text-[14px] text-white/85">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brass/15 text-[12px] font-semibold text-brass ring-1 ring-brass/40">{n}</span>
              <span className="pt-0.5">{t(`tour.phone_steps.${n}`)}</span>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => emitDemo({ type: "trigger" })} className={`${primary} flex items-center gap-2`}>
            <span className={`size-2 rounded-full bg-ink ${phone === "ringing" ? "animate-pulse-dot" : ""}`} />
            {t("tour.phone_ring")}
          </button>
          <a href="/demo/phone" target="_blank" rel="noreferrer" className={outline}>
            {t("tour.phone_open")} ↗
          </a>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-white/50">
          <span className={`size-1.5 rounded-full ${phone === "idle" ? "bg-white/40" : phone === "blocked" ? "bg-[#5fd3a4]" : "animate-pulse-dot bg-[#ff6b5e]"}`} />
          {t(`demo.state_${phone}`)}
          <span className="text-white/25">·</span>
          <span className="font-data truncate" dir="ltr">
            {url}
          </span>
        </div>
        <div className="mt-auto flex items-center justify-end gap-2 pt-6">
          <button type="button" onClick={onBack} className={ghost}>
            {t("tour.back")}
          </button>
          <button type="button" onClick={onNext} className={primary}>
            {t("tour.next")} <span className="inline-block rtl:rotate-180">→</span>
          </button>
        </div>
      </div>
      <div className="mx-auto rounded-[38px] bg-black p-2 shadow-[0_30px_60px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/15" dir="ltr">
        <div className="relative overflow-hidden rounded-[30px]" style={{ width: 390 * SCALE, height: 844 * SCALE }}>
          <iframe
            src="/demo/phone"
            title={t("tour.phone_open")}
            className="absolute start-0 top-0 origin-top-left border-0"
            style={{ width: 390, height: 844, transform: `scale(${SCALE})` }}
          />
        </div>
      </div>
    </div>
  );
}

function Finish({ onExplore, onRestart, onClose }: { onExplore: () => void; onRestart: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative px-8 pb-7 pt-4">
      <div className="absolute end-4 top-2">
        <CloseButton onClose={onClose} />
      </div>
      <div className="mt-4 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-brass/15 text-2xl text-brass ring-1 ring-brass/40">✓</div>
        <h2 className="font-display mt-3 text-[30px] font-semibold">{t("tour.steps.finish.title")}</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-white/70">{t("tour.steps.finish.body")}</p>
      </div>
      <ul className="mt-6 space-y-2">
        {CRITERIA_ORDER.map((key, i) => (
          <li
            key={key}
            className="tour-pop flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5"
            style={{ animationDelay: `${150 + i * 90}ms` }}
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-ink" style={{ background: CRITERIA[key] }}>
              ✓
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{t(`tour.criteria.${key}`)}</span>
              <span className="block text-[13px] text-white/55">{t(`tour.proof.${key}`)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={onExplore} autoFocus className={`${primary} px-6 py-3 text-[15px]`}>
          {t("tour.try")}
        </button>
        <button type="button" onClick={onRestart} className={`${outline} py-3 text-[15px]`}>
          {t("tour.again")}
        </button>
      </div>
    </div>
  );
}
