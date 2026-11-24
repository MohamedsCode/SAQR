import type { Verdict } from "@shared/contract";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { verdictColor } from "./VerdictBadge";

const RADIUS = 80;
const ARC = Math.PI * RADIUS;

export default function ScoreGauge({ score, verdict, size = 220 }: { score: number; verdict: Verdict; size?: number }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(id);
  }, [score]);

  const color = verdictColor[verdict];
  return (
    <div className="relative" style={{ width: size, height: size * 0.62 }} dir="ltr">
      <svg viewBox="0 0 200 124" className="size-full overflow-visible">
        <defs>
          <filter id="gauge-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d="M20 110 A80 80 0 0 1 180 110" fill="none" stroke="#1b2a40" strokeWidth="14" strokeLinecap="round" />
        {[30, 70].map((mark) => {
          const angle = Math.PI * (1 - mark / 100);
          return (
            <line
              key={mark}
              x1={100 + 66 * Math.cos(angle)}
              y1={110 - 66 * Math.sin(angle)}
              x2={100 + 94 * Math.cos(angle)}
              y2={110 - 94 * Math.sin(angle)}
              stroke="#8797b0"
              strokeOpacity="0.5"
              strokeWidth="1.5"
            />
          );
        })}
        <path
          d="M20 110 A80 80 0 0 1 180 110"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={ARC}
          strokeDashoffset={ARC * (1 - shown / 100)}
          filter="url(#gauge-glow)"
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-5xl font-bold tabular-nums" style={{ color }}>
          {score}
        </div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted">{t("case.risk_score")}</div>
      </div>
    </div>
  );
}
