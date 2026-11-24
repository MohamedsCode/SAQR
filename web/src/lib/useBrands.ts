import type { Brand } from "@shared/contract";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { localized } from "../brand";

let cache: Promise<Brand[]> | null = null;

export function useBrands() {
  const { i18n } = useTranslation();
  const [brands, setBrands] = useState<Record<string, Brand>>({});

  useEffect(() => {
    cache ??= api.brands().catch((error) => {
      cache = null;
      throw error;
    });
    cache.then((list) => setBrands(Object.fromEntries(list.map((b) => [b.id, b])))).catch(() => undefined);
  }, []);

  const brandName = (id: string | null | undefined) =>
    id && brands[id] ? localized(i18n.language, brands[id].name_en, brands[id].name_ar) : null;

  return { brands, brandName };
}
