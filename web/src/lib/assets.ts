const references = import.meta.glob("../../../shared/brand_assets/*/reference.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export function referenceImage(brandId: string | null | undefined): string | null {
  if (!brandId) return null;
  const key = Object.keys(references).find((path) => path.endsWith(`/${brandId}/reference.png`));
  return key ? references[key] : null;
}
