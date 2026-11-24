import config from "@shared/brand_config.json";

export const BRAND = config;

export function localized(lang: string, en: string, ar: string): string {
  return lang === "ar" ? ar : en;
}

export function productName(lang: string): string {
  return localized(lang, BRAND.product_name_en, BRAND.product_name_ar);
}
