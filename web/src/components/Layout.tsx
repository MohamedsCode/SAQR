import logoMark from "@shared/logo/saqr-mark-white.png";
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";
import { useDataMode } from "../api";
import { BRAND, localized } from "../brand";
import { rememberSkitCase } from "../lib/display";
import { useDemoEvents } from "../lib/demoBus";
import DemoMenu from "./DemoPanel";
import { IconEye, IconFile, IconLink, IconPhone, IconRadar, IconSearch, IconShieldCheck } from "./Icons";

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
  `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
    isActive ? "bg-gold/15 text-gold-soft ring-1 ring-gold/40" : "text-muted hover:bg-white/5 hover:text-text"
  }`;

export default function Layout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const mode = useDataMode();

  useDemoEvents((event) => {
    if (event.type === "blocked") {
      rememberSkitCase(event.scan_id);
      const call = event.call_at ? `?call=${encodeURIComponent(event.call_at)}` : "";
      navigate(`/cases/${encodeURIComponent(event.scan_id)}${call}`);
    }
  });

  return (
    <div className="grid-bg flex min-h-screen flex-col lg:flex-row">
      <aside className="z-30 flex shrink-0 flex-col border-line bg-bg/90 backdrop-blur-md lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-e">
        <NavLink to="/" className="flex items-center gap-3 px-5 py-5">
          <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-panel-2 to-bg ring-1 ring-gold/40 glow-gold">
            <img src={logoMark} alt="" className="size-8 object-contain" />
          </span>
          <span>
            <span className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-[0.18em]">{BRAND.product_name_en}</span>
              <span className="text-lg font-semibold text-gold">{BRAND.product_name_ar}</span>
            </span>
            <span className="block text-[11px] leading-tight text-muted">{localized(lang, BRAND.tagline_en, BRAND.tagline_ar)}</span>
          </span>
        </NavLink>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible">
          {NAV.map(({ to, key, icon: Icon, end }) => (
            <NavLink key={key} to={to} end={end} className={navClass}>
              <Icon size={18} />
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="hidden space-y-2 border-t border-line px-4 py-4 text-sm lg:block">
          <a href="/check" target="_blank" rel="noreferrer" className="block text-muted hover:text-gold-soft">
            {t("nav.public_app")} ↗
          </a>
          <DemoMenu />
          <div className="flex items-center justify-between pt-2">
            {mode && (
              <span className={`flex items-center gap-1.5 text-[11px] ${mode === "live" ? "text-safe" : "text-suspicious"}`}>
                <span className="size-1.5 rounded-full bg-current" />
                {t(mode === "live" ? "mode.live" : "mode.sample")}
              </span>
            )}
            <button
              type="button"
              onClick={() => i18n.changeLanguage(lang === "ar" ? "en" : "ar")}
              className="rounded-lg border border-line px-2.5 py-1 text-xs hover:border-gold/60 hover:text-gold-soft"
            >
              {t("lang_toggle")}
            </button>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-6 pb-8 text-xs text-muted">
          {localized(lang, BRAND.privacy_note_en, BRAND.privacy_note_ar)}
        </footer>
      </div>
    </div>
  );
}
