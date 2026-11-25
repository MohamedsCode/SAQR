import logoMark from "@shared/logo/saqr-mark-white.png";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BRAND, localized } from "../brand";
import { rememberSkitCase } from "../lib/display";
import { useDemoEvents } from "../lib/demoBus";
import DemoMenu from "./DemoPanel";
import { IconEye, IconFile, IconLink, IconPhone, IconRadar, IconSearch, IconShieldCheck } from "./Icons";
import { useTour } from "./Tour";

const NAV: { to: string; key: string; icon: ComponentType<{ size?: number }>; end?: boolean }[] = [
  { to: "/", key: "overview", icon: IconRadar, end: true },
  { to: "/detection", key: "detection", icon: IconEye },
  { to: "/helplines", key: "helplines", icon: IconPhone },
  { to: "/cases", key: "cases", icon: IconFile },
  { to: "/networks", key: "networks", icon: IconLink },
  { to: "/scan", key: "scan", icon: IconSearch },
  { to: "/model", key: "model", icon: IconShieldCheck },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  `group relative flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-[14.5px] transition-all duration-200 ${
    isActive ? "bg-white/[0.07] font-medium text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white/90"
  }`;

const SEEN_KEY = "saqr.tour.seen";

export default function Layout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const location = useLocation();
  const { start, active } = useTour();
  const [seen, setSeen] = useState(true);

  useEffect(() => {
    try {
      setSeen(localStorage.getItem(SEEN_KEY) === "1");
    } catch {
      setSeen(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    setSeen(true);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* storage unavailable: the hint simply shows again next time */
    }
  }, [active]);

  useDemoEvents((event) => {
    if (event.type === "blocked") {
      rememberSkitCase(event.scan_id);
      const call = event.call_at ? `?call=${encodeURIComponent(event.call_at)}` : "";
      navigate(`/cases/${encodeURIComponent(event.scan_id)}${call}`);
    }
  });

  return (
    <div className="ops flex min-h-screen flex-col lg:flex-row">
      <aside className="relative z-30 flex shrink-0 flex-col bg-ink text-white lg:sticky lg:top-0 lg:h-screen lg:w-[264px]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="eye-rings absolute -start-40 -top-40 size-96 opacity-70" />
        </div>
        <NavLink to="/" className="relative flex items-center gap-3 px-6 pb-6 pt-7">
          <img src={logoMark} alt="" className="size-11 object-contain" />
          <span className="leading-none">
            <span className="flex items-baseline gap-2">
              <span className="font-display text-[24px] font-bold tracking-tight">{BRAND.product_name_en}</span>
              <span className="text-[19px] font-semibold text-brass">{BRAND.product_name_ar}</span>
            </span>
            <span className="mt-1.5 block whitespace-nowrap text-[11.5px] text-white/45">{t("nav.portal")}</span>
          </span>
        </NavLink>

        <nav className="relative flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-4">
          <div className="mb-1.5 hidden px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/30 lg:block">{t("nav.section")}</div>
          {NAV.map(({ to, key, icon: Icon, end }) => (
            <NavLink key={key} to={to} end={end} className={navClass}>
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute inset-y-2.5 start-0 w-[3px] rounded-full bg-brass transition-all duration-300 ${isActive ? "opacity-100" : "scale-y-0 opacity-0"}`}
                  />
                  <span className={isActive ? "text-brass" : "text-white/45 group-hover:text-white/80"}>
                    <Icon size={18} />
                  </span>
                  {t(`nav.${key}`)}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="relative hidden space-y-3 px-4 pb-5 lg:block">
          <button
            type="button"
            onClick={start}
            data-tour="tour-button"
            className="group relative w-full overflow-hidden rounded-2xl border border-brass/30 bg-gradient-to-br from-brass/[0.16] to-transparent p-4 text-start transition hover:border-brass/60"
          >
            {!seen && (
              <span className="absolute end-3 top-3 grid size-2.5 place-items-center">
                <span className="animate-ping-soft absolute size-2.5 rounded-full bg-brass" />
                <span className="size-2 rounded-full bg-brass" />
              </span>
            )}
            <span className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-full bg-brass text-[10px] text-ink transition group-hover:scale-110">▶</span>
              <span>
                <span className="block text-[14px] font-semibold">{t("tour.cta")}</span>
                <span className="block text-[12px] text-white/50">{t("tour.cta_hint")}</span>
              </span>
            </span>
          </button>
          <div className="flex items-center gap-1 border-t border-white/10 pt-3 text-[13px]">
            <a href="/check" target="_blank" rel="noreferrer" className="rounded-full px-2.5 py-1.5 text-white/55 transition hover:bg-white/5 hover:text-white">
              {t("nav.public_app")} ↗
            </a>
            <DemoMenu />
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => i18n.changeLanguage(lang === "ar" ? "en" : "ar")}
              className="rounded-full border border-white/15 px-2.5 py-1 text-white/80 transition hover:border-white/40 hover:text-white"
            >
              {t("lang_toggle")}
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <main key={location.pathname} className="animate-page mx-auto max-w-[1180px] px-5 py-8 lg:px-12 lg:py-11">
          {children}
        </main>
        <footer className="mx-auto max-w-[1180px] px-5 pb-8 text-xs text-muted lg:px-12">{localized(lang, BRAND.footer_en, BRAND.footer_ar)}</footer>
      </div>
    </div>
  );
}
