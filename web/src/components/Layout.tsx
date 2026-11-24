import logoMark from "@shared/logo/saqr-mark-white.png";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";
import { useDataMode } from "../api";
import { BRAND, localized, productName } from "../brand";
import { useDemoEvents } from "../lib/demoBus";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-gold/15 text-gold-soft ring-1 ring-gold/40" : "text-muted hover:bg-white/5 hover:text-text"
  }`;

function DataModeBadge() {
  const { t } = useTranslation();
  const mode = useDataMode();
  if (!mode) return null;
  const live = mode === "live";
  return (
    <span
      title={t(live ? "mode.live_hint" : "mode.sample_hint")}
      className={`hidden items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 sm:inline-flex ${
        live ? "text-safe ring-safe/40" : "text-suspicious ring-suspicious/40"
      }`}
    >
      <span className="size-2 animate-pulse-dot rounded-full bg-current" />
      {t(live ? "mode.live" : "mode.sample")}
    </span>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();

  useDemoEvents((event) => {
    if (event.type === "blocked") {
      const call = event.call_at ? `?call=${encodeURIComponent(event.call_at)}` : "";
      navigate(`/cases/${encodeURIComponent(event.scan_id)}${call}`);
    }
  });

  return (
    <div className="grid-bg min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-6 py-3">
          <NavLink to="/" className="me-auto flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-panel-2 to-bg ring-1 ring-gold/40 glow-gold">
              <img src={logoMark} alt="" className="size-8 object-contain" />
            </span>
            <span>
              <span className="flex items-baseline gap-2">
                <span className="text-xl font-bold tracking-[0.18em] text-text">{BRAND.product_name_en}</span>
                <span className="text-lg font-semibold text-gold">{BRAND.product_name_ar}</span>
              </span>
              <span className="block text-xs text-muted">{localized(lang, BRAND.tagline_en, BRAND.tagline_ar)}</span>
            </span>
          </NavLink>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/" end className={navClass}>
              {t("nav.operations")}
            </NavLink>
            <NavLink to="/scan" className={navClass}>
              {t("nav.scan")}
            </NavLink>
            <NavLink to="/check" className={navClass}>
              {t("nav.citizen_view")}
            </NavLink>
          </nav>
          <DataModeBadge />
          <button
            type="button"
            onClick={() => i18n.changeLanguage(lang === "ar" ? "en" : "ar")}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-text hover:border-gold/60 hover:text-gold-soft"
          >
            {t("lang_toggle")}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-7xl px-6 pb-8 text-xs text-muted">
        {productName(lang)} · {localized(lang, BRAND.privacy_note_en, BRAND.privacy_note_ar)}
      </footer>
    </div>
  );
}
