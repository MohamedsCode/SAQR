// Local preview: `npm run dev`, then open http://localhost:5175. Mounts the real warning with sample engine reasons.
import type { Reason } from "@shared/contract";
import type { CheckOutcome } from "./messages";
import { mountWarning } from "./mount";

const REASONS: Reason[] = [
  { code: "BRAND_IN_DOMAIN", weight: 28, evidence: "adpolice",
    en: "Domain uses the name of Abu Dhabi Police but is not an official Abu Dhabi Police domain.",
    ar: "يستخدم النطاق اسم شرطة أبوظبي لكنه ليس نطاقاً رسمياً تابعاً لها." },
  { code: "CARD_FORM", weight: 25, evidence: "card number, CVV",
    en: "Page asks for payment card details.", ar: "تطلب الصفحة بيانات بطاقة الدفع." },
  { code: "DOMAIN_AGE_LT_7D", weight: 25, evidence: "Registered 2026-11-21 (3 days ago)",
    en: "Domain was registered less than 7 days ago.", ar: "تم تسجيل النطاق منذ أقل من 7 أيام." },
  { code: "ML_MODEL", weight: 30, evidence: "92%",
    en: "AI model: 92% phishing probability, learned from thousands of labelled URLs.",
    ar: "نموذج الذكاء الاصطناعي: احتمال الاحتيال 92%، بناءً على آلاف الروابط المصنّفة." },
  { code: "URGENCY_LANGUAGE", weight: 10, evidence: "pay within 24 hours",
    en: "Page pressures the visitor to act immediately.", ar: "تضغط الصفحة على الزائر للتصرف فوراً." },
];

const OUTCOMES: Record<string, Exclude<CheckOutcome, { kind: "none" }>> = {
  suspicious: { kind: "suspicious", domain: "uae-parcel-track.site", reasons: [REASONS[2]] },
  fraud: { kind: "fraud", domain: "adpolice-fines-pay.top", reasons: REASONS },
  error: { kind: "error", domain: "example-shop.ae" },
};

const log = document.getElementById("log")!;
let remove: (() => void) | null = null;

function show(kind: string) {
  remove?.();
  remove = mountWarning(OUTCOMES[kind], {
    onLeave: () => (log.textContent = `${kind}: leave`),
    onContinue: () => (log.textContent = `${kind}: continue anyway (bypassed for 30 minutes)`),
  });
  log.textContent = `${kind} shown`;
}

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-show]")) {
  button.addEventListener("click", () => show(button.dataset.show!));
}

const params = new URLSearchParams(location.search);
if (params.get("show")) show(params.get("show")!);
