import type { ScanResult } from "@shared/contract";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { BRAND, localized } from "../brand";
import VerdictBadge from "../components/VerdictBadge";

export default function CheckLink() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setFailed(false);
    setResult(null);
    try {
      setResult(await api.scan(input));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const topReasons = result ? [...result.reasons].sort((a, b) => b.weight - a.weight).slice(0, 3) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{t("citizen.title")}</h1>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("citizen.placeholder")}
          className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 focus:border-navy focus:outline-none"
          dir="auto"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-navy px-5 py-2 font-medium text-white hover:bg-ink disabled:opacity-60"
        >
          {busy ? t("citizen.checking") : t("citizen.check")}
        </button>
      </form>

      {failed && <p className="rounded bg-suspicious/10 p-3 text-suspicious">{t("error.scan")}</p>}

      {result && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <VerdictBadge verdict={result.verdict} />
            <span className="font-mono text-sm" dir="ltr">
              {result.registered_domain}
            </span>
          </div>
          <p>{localized(lang, result.summary_en, result.summary_ar)}</p>
          <div>
            <div className="mb-2 text-sm font-semibold text-slate-600">{t("citizen.top_reasons")}</div>
            <ul className="list-disc space-y-1 ps-5">
              {topReasons.map((reason) => (
                <li key={reason.code}>{localized(lang, reason.en, reason.ar)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <p className="text-sm text-slate-500">{localized(lang, BRAND.privacy_note_en, BRAND.privacy_note_ar)}</p>
    </div>
  );
}
