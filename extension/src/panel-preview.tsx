// Local preview of the toolbar panel in every state (npm run dev, then open /panel.html). Not part of the build.
import { createRoot } from "react-dom/client";
import type { PanelStatus } from "./messages";
import Panel from "./Panel";
import css from "./styles.css?inline";

const SAMPLES: (PanelStatus | null)[] = [
  { kind: "result", domain: "www.adcb.com", score: 0, reasons: [
    { code: "OFFICIAL_DOMAIN", en: "Verified official domain of ADCB.", ar: "نطاق رسمي موثّق لـبنك أبوظبي التجاري.", weight: 0, evidence: null },
  ] },
  { kind: "result", domain: "rta-fines-pay.top", score: 48, reasons: [
    { code: "SUSPICIOUS_TLD", en: "Uses a domain ending often used for scams (.top).", ar: "يستخدم امتداد نطاق شائعاً في عمليات الاحتيال (.top).", weight: 15, evidence: null },
    { code: "BRAND_KEYWORD", en: "The address mentions RTA but is not an RTA website.", ar: "يذكر العنوان هيئة الطرق والمواصلات لكنه ليس موقعها.", weight: 25, evidence: null },
  ] },
  { kind: "result", domain: "adcb-secure-login.xyz", score: 91, reasons: [
    { code: "BRAND_KEYWORD", en: "The address mentions ADCB but is not an ADCB website.", ar: "يذكر العنوان بنك أبوظبي التجاري لكنه ليس موقعه.", weight: 25, evidence: null },
    { code: "NEW_DOMAIN", en: "The domain was registered 3 days ago.", ar: "سُجّل النطاق قبل 3 أيام.", weight: 20, evidence: null },
    { code: "PASSWORD_FORM", en: "The page asks for a password.", ar: "تطلب الصفحة كلمة مرور.", weight: 15, evidence: null },
  ] },
  null,
  { kind: "error", domain: "example.com" },
  { kind: "skipped" },
];

const style = document.createElement("style");
style.textContent = css;
document.head.append(style);
createRoot(document.getElementById("root")!).render(
  <>{SAMPLES.map((s, i) => <div key={i} className="frame"><Panel status={s} /></div>)}</>,
);
