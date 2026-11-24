import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { productName } from "./brand";
import ar from "./locales/ar.json";
import en from "./locales/en.json";

const STORAGE_KEY = "lang";

function applyDocumentLanguage(lang: string) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = productName(lang);
}

i18n.on("languageChanged", (lang) => {
  applyDocumentLanguage(lang);
  localStorage.setItem(STORAGE_KEY, lang);
});

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: localStorage.getItem(STORAGE_KEY) ?? "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

applyDocumentLanguage(i18n.language);

export default i18n;
