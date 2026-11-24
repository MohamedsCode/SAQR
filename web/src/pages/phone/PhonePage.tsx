import blockedSound from "@data/demo/blocked.mp3";
import ringtoneSound from "@data/demo/ringtone.mp3";
import callSound from "@data/demo/saqr_scam_call.mp3";
import smsSound from "@data/demo/sms.mp3";
import type { ScanResult } from "@shared/contract";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { sampleBrands, sampleScans } from "../../data/fixtures";
import { DEMO_URL, emitDemo, useDemoEvents } from "../../lib/demoBus";
import "./phone.css";

type Screen = "lock" | "incoming" | "incall" | "thread" | "blocked";

const SMS_EN = `Abu Dhabi Police: unpaid fine AED 3,000. Pay now to avoid impound: ${DEMO_URL}`;
const SMS_AR = `شرطة أبوظبي: مخالفة غير مدفوعة بقيمة 3,000 درهم. ادفع الآن لتجنب حجز المركبة: ${DEMO_URL}`;
const NO_AUDIO_CALL_MS = 8000;

function randomCaller(): string {
  const digit = () => Math.floor(Math.random() * 10);
  const prefix = ["50", "52", "54", "55", "56", "58"][Math.floor(Math.random() * 6)];
  return `+971 ${prefix} ${digit()}${digit()}${digit()} ${digit()}${digit()}${digit()}${digit()}`;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function useSound(src: string, loop = false) {
  const ref = useRef<HTMLAudioElement | null>(null);
  if (!ref.current && typeof Audio !== "undefined") {
    ref.current = new Audio(src);
    ref.current.loop = loop;
    ref.current.preload = "auto";
  }
  return ref.current;
}

function play(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => undefined);
}

function stop(...audios: (HTMLAudioElement | null)[]) {
  for (const audio of audios) {
    if (!audio) continue;
    audio.pause();
    audio.currentTime = 0;
  }
}

const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

function StatusBar({ now, dark = false }: { now: Date; dark?: boolean }) {
  const color = dark ? "#000" : "#fff";
  return (
    <div className="ph-status" style={{ color }}>
      <span>{hhmm(now)}</span>
      <span className="ph-status-icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill={color} aria-hidden="true">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill={color} aria-hidden="true">
          <path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.8 10.8 0 008 .4 10.8 10.8 0 00.5 3.4l1.2 1.3A9 9 0 018 2.2z" />
          <path d="M8 5.6c1.5 0 2.9.6 4 1.6l1.2-1.3A7.4 7.4 0 008 3.8a7.4 7.4 0 00-5.2 2.1L4 7.2c1.1-1 2.5-1.6 4-1.6z" />
          <path d="M8 9c.6 0 1.2.2 1.6.6L8 11.4 6.4 9.6C6.8 9.2 7.4 9 8 9z" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke={color} strokeOpacity="0.4" />
          <rect x="2" y="2" width="17" height="9" rx="2" fill={color} />
          <path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill={color} fillOpacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

const PhoneIcon = ({ size = 30, color = "#fff", rotate = 0 }: { size?: number; color?: string; rotate?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ transform: `rotate(${rotate}deg)` }} aria-hidden="true">
    <path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" />
  </svg>
);

const Glyph = ({ d }: { d: string }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const GRID = [
  { label: "mute", d: "M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3M4 4l16 16" },
  { label: "keypad", d: "M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01" },
  { label: "speaker", d: "M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12", active: true },
  { label: "add call", d: "M12 5v14M5 12h14" },
  { label: "FaceTime", d: "M3 7h12v10H3zM15 10l6-3v10l-6-3" },
  { label: "contacts", d: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" },
];

export default function PhonePage() {
  const now = useClock();
  const [armed, setArmed] = useState(false);
  const [screen, setScreen] = useState<Screen>("lock");
  const [caller, setCaller] = useState(randomCaller);
  const [banner, setBanner] = useState(false);
  const [callStart, setCallStart] = useState<number | null>(null);
  const [callAt, setCallAt] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const ringtone = useSound(ringtoneSound, true);
  const call = useSound(callSound);
  const sms = useSound(smsSound);
  const blocked = useSound(blockedSound);
  const timers = useRef<number[]>([]);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function reset() {
    clearTimers();
    stop(ringtone, call, sms, blocked);
    setScreen("lock");
    setBanner(false);
    setScan(null);
    setCallStart(null);
  }

  function ring() {
    reset();
    setCaller(randomCaller());
    setCallAt(new Date().toISOString());
    setScreen("incoming");
    play(ringtone);
    navigator.vibrate?.([800, 400, 800, 400, 800]);
  }

  function endCall() {
    clearTimers();
    stop(ringtone, call);
    setScreen("lock");
    setCallStart(null);
    emitDemo({ type: "call_ended" });
    later(() => {
      setBanner(true);
      play(sms);
    }, 2000);
  }

  function answer() {
    stop(ringtone);
    setScreen("incall");
    setCallStart(Date.now());
    emitDemo({ type: "call_answered" });
    if (call) {
      call.onended = endCall;
      call.currentTime = 0;
      call.play().catch(() => later(endCall, NO_AUDIO_CALL_MS));
    } else {
      later(endCall, NO_AUDIO_CALL_MS);
    }
  }

  function decline() {
    stop(ringtone);
    setScreen("lock");
  }

  async function openLink() {
    setScreen("blocked");
    play(blocked);
    let result: ScanResult;
    try {
      result = await api.scan(DEMO_URL);
    } catch {
      result = sampleScans.find((s) => s.impersonated_brand === "adpolice" && s.verdict === "fraud") ?? sampleScans[0];
    }
    setScan(result);
    emitDemo({ type: "blocked", scan_id: result.id, call_at: callAt });
  }

  useDemoEvents((event) => {
    if (event.type === "trigger") ring();
    if (event.type === "reset") reset();
  });

  function arm() {
    for (const audio of [ringtone, call, sms, blocked]) {
      if (!audio) continue;
      audio.muted = true;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
        .catch(() => (audio.muted = false));
    }
    setArmed(true);
  }

  const elapsed = callStart ? Math.floor((now.getTime() - callStart) / 1000) : 0;
  const timer = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const dateLabel = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" });
  const topReasons = scan ? [...scan.reasons].sort((a, b) => b.weight - a.weight).slice(0, 3) : [];
  const darkStatus = screen === "thread";
  const brand = sampleBrands.find((b) => b.id === scan?.impersonated_brand);

  return (
    <div className="ph-root">
      <div className="ph-device">
        <div className="ph-wall" />
        <div className="ph-demo-label">Demo simulation</div>
        <StatusBar now={now} dark={darkStatus} />
        <div className={`ph-island ${screen === "incall" ? "wide" : ""}`}>
          {screen === "incall" && (
            <>
              <span className="ph-island-dot">
                <PhoneIcon size={13} />
              </span>
              <span className="ph-island-wave">
                <span />
                <span />
                <span />
                <span />
              </span>
            </>
          )}
        </div>

        {screen === "lock" && (
          <div className="ph-screen" key="lock">
            <div className="ph-lock-date">{dateLabel}</div>
            <div className="ph-lock-clock">{hhmm(now)}</div>
            {banner && (
              <div className="ph-banner" onClick={() => setScreen("thread")} role="button">
                <BannerContent caller={caller} />
              </div>
            )}
            <div className="ph-lock-bottom">
              <span className="ph-round">
                <Glyph d="M9 2h6l-1 7h-4zM10 9h4v11a2 2 0 01-4 0z" />
              </span>
              <span className="ph-round">
                <Glyph d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z" />
              </span>
            </div>
          </div>
        )}

        {screen === "incoming" && (
          <div className="ph-screen" key="incoming">
            <div className="ph-blur" />
            <div className="ph-caller">
              <div className="ph-caller-name">Unknown</div>
              <div className="ph-caller-sub" dir="ltr">
                {caller}
              </div>
              <div className="ph-caller-sub">mobile</div>
            </div>
            <div className="ph-call-row top">
              <span className="ph-small-icon">
                <Glyph d="M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z" />
                Remind Me
              </span>
              <span className="ph-small-icon">
                <Glyph d="M4 5h16v11H8l-4 4z" />
                Message
              </span>
            </div>
            <div className="ph-call-row main">
              <span>
                <button type="button" className="ph-call-btn red" onClick={decline} aria-label="Decline">
                  <PhoneIcon rotate={135} />
                </button>
                Decline
              </span>
              <span>
                <button type="button" className="ph-call-btn green" onClick={answer} aria-label="Accept">
                  <PhoneIcon />
                </button>
                Accept
              </span>
            </div>
          </div>
        )}

        {screen === "incall" && (
          <div className="ph-screen" key="incall">
            <div className="ph-blur" />
            <div className="ph-caller" style={{ marginTop: 100 }}>
              <div className="ph-caller-name" style={{ fontSize: 30 }} dir="ltr">
                {caller}
              </div>
              <div className="ph-caller-sub">{timer}</div>
            </div>
            <div className="ph-grid">
              {GRID.map((item) => (
                <span key={item.label}>
                  <span className={`ph-grid-btn ${item.active ? "active" : ""}`}>
                    <Glyph d={item.d} />
                  </span>
                  {item.label}
                </span>
              ))}
            </div>
            <div className="ph-end">
              <button type="button" className="ph-call-btn red" onClick={endCall} aria-label="End call">
                <PhoneIcon rotate={135} />
              </button>
            </div>
          </div>
        )}

        {screen === "thread" && (
          <div className="ph-msgs ph-screen" key="thread">
            <div className="ph-msgs-head">
              <span className="ph-msgs-back" onClick={() => setScreen("lock")} role="button">
                ‹
              </span>
              <div className="ph-avatar">
                <Glyph d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" />
              </div>
              <div style={{ fontSize: 12 }} dir="ltr">
                {caller} ›
              </div>
            </div>
            <div className="ph-msgs-body">
              <div className="ph-msgs-meta">Text Message · Today {hhmm(now)}</div>
              <div className="ph-bubble" dir="rtl">
                {SMS_AR.replace(DEMO_URL, "")}
                <a onClick={openLink} dir="ltr">
                  {DEMO_URL}
                </a>
              </div>
              <div className="ph-bubble">
                {SMS_EN.replace(DEMO_URL, "")}
                <a onClick={openLink}>{DEMO_URL}</a>
              </div>
            </div>
            <div className="ph-msgs-input">Text Message</div>
          </div>
        )}

        {screen === "blocked" && (
          <div className="ph-blocked ph-screen" key="blocked">
            <div className="ph-shield">
              <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#ff453a" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
                <path d="M9 9l6 6M15 9l-6 6" strokeLinecap="round" />
              </svg>
            </div>
            <h1>SAQR blocked this page</h1>
            <h2>صقر حظر هذه الصفحة</h2>
            <div className="ph-blocked-card">
              {scan ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ opacity: 0.7 }}>Pretends to be · ينتحل صفة</span>
                    <span style={{ color: "#ff453a", fontWeight: 700, fontSize: 22 }}>{scan.score}/100</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 17, margin: "2px 0 8px" }}>
                    {brand ? `${brand.name_en} · ${brand.name_ar}` : "—"}
                  </div>
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, opacity: 0.6, marginBottom: 6 }} dir="ltr">
                    {scan.registered_domain}
                  </div>
                  {topReasons.map((reason) => (
                    <div key={reason.code} className="ph-reason">
                      <span style={{ color: "#ff453a" }}>●</span>
                      <span>
                        {reason.en}
                        <div className="ph-reason-ar">{reason.ar}</div>
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ textAlign: "center", opacity: 0.7 }}>Checking the link… · جارٍ فحص الرابط…</div>
              )}
            </div>
            <button type="button" className="ph-btn-primary" onClick={reset} style={{ marginTop: 24 }}>
              Go back to safety · العودة إلى الأمان
            </button>
            {scan && (
              <a className="ph-link" href={`/cases/${encodeURIComponent(scan.id)}`}>
                View details · عرض التفاصيل
              </a>
            )}
          </div>
        )}

        <div className={`ph-home ${screen === "thread" ? "dark" : ""}`} />

        {!armed && (
          <div className="ph-arm" onClick={arm} role="button">
            <div>
              <b>Tap to arm demo</b>
              <span style={{ opacity: 0.7 }}>Enables sound for the simulation</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BannerContent({ caller }: { caller: string }) {
  return (
    <>
      <span className="ph-app-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.6 1.4 4.9 3.6 6.5L5 21l3.6-1.9c1.1.3 2.2.4 3.4.4 5.5 0 10-3.8 10-8.5S17.5 3 12 3z" />
        </svg>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="ph-banner-head">
          <span style={{ fontWeight: 600, opacity: 0.6 }}>MESSAGES</span>
          <span style={{ opacity: 0.5 }}>now</span>
        </span>
        <span className="ph-banner-title" dir="ltr" style={{ display: "block" }}>
          {caller}
        </span>
        <span className="ph-banner-text">{SMS_EN}</span>
      </span>
    </>
  );
}
