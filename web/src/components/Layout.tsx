import logoMark from "@shared/logo/saqr-mark.png";
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";
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
  `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-[15px] transition-colors ${
    isActive ? "bg-brand-tint font-semibold text-gold" : "text-text/80 hover:bg-black/[0.04] hover:text-text"
  }`;

export default function Layout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();

  useDemoEvents((event) => {
    if (event.type === "blocked") {
      rememberSkitCase(event.scan_id);
      const call = event.call_at ? `?call=${encodeURIComponent(event.call_at)}` : "";
      navigate(`/cases/${encodeURIComponent(event.scan_id)}${call}`);
    }
  });

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="z-30 flex shrink-0 flex-col border-line bg-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-e">
        <NavLink to="/" className="flex items-center gap-2.5 px-5 pb-4 pt-6">
          <img src={logoMark} alt="" className="size-9 object-contain" />
          <span className="text-xl font-bold text-gold">{BRAND.product_name_en}</span>
          <span className="text-lg font-semibold text-gold">{BRAND.product_name_ar}</span>
        </NavLink>
        <nav className="flex gap-0.5 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible">
          {NAV.map(({ to, key, icon: Icon, end }) => (
            <NavLink key={key} to={to} end={end} className={navClass}>
              <Icon size={17} />
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="hidden space-y-1 border-t border-line px-3 py-4 text-sm lg:block">
          <a href="/check" target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-1.5 text-muted hover:text-gold">
            {t("nav.public_app")} ↗
          </a>
          <DemoMenu />
          <button
            type="button"
            onClick={() => i18n.changeLanguage(lang === "ar" ? "en" : "ar")}
            className="block rounded-lg px-3 py-1.5 text-muted hover:text-gold"
          >
            {t("lang_toggle")}
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-6xl px-8 py-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-8 pb-8 text-xs text-muted">
          {localized(lang, BRAND.privacy_note_en, BRAND.privacy_note_ar)}
        </footer>
      </div>
    </div>
  );
}
