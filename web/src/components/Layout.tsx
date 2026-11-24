import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { BRAND, localized, productName } from "../brand";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-2 text-sm font-medium ${isActive ? "bg-white/15 text-white" : "text-white/75 hover:text-white"}`;

export default function Layout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  return (
    <div className="min-h-screen">
      <header className="border-b-4 border-accent bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
          <div className="me-auto">
            <div className="text-xl font-bold tracking-wide">{productName(lang)}</div>
            <div className="text-xs text-white/70">{localized(lang, BRAND.tagline_en, BRAND.tagline_ar)}</div>
          </div>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>
              {t("nav.operations")}
            </NavLink>
            <NavLink to="/check" className={navClass}>
              {t("nav.citizen")}
            </NavLink>
          </nav>
          <button
            type="button"
            onClick={() => i18n.changeLanguage(lang === "ar" ? "en" : "ar")}
            className="rounded border border-white/40 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            {t("lang_toggle")}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
