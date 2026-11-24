const GULF = "Asia/Dubai";

function locale(lang: string) {
  return lang === "ar" ? "ar-AE" : "en-GB";
}

export function dateTime(iso: string | null | undefined, lang: string, timeZone = GULF): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale(lang), { timeZone, dateStyle: "medium", timeStyle: "short" });
}

export function dateOnly(iso: string | null | undefined, lang: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale(lang), { timeZone: GULF, dateStyle: "medium" });
}

export function relativeTime(iso: string, lang: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(Math.round(seconds), "second");
}

export function daysSince(iso: string | null | undefined, reference: string): number | null {
  if (!iso) return null;
  const day = (value: string) => Math.floor(Date.parse(value) / 86_400_000);
  return Math.max(0, day(reference) - day(iso));
}

export function number(value: number, lang: string): string {
  return value.toLocaleString(locale(lang));
}
