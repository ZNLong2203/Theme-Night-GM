"use client";

import { SCORE_LABELS, SCORE_WEIGHTS } from "@/lib/scoring";
import type { AgeBucket, Demographics, EntityKind, EntityProfile, ScoreBreakdown, TrendSeries } from "@/lib/types";
import { cn, Meter } from "./ui";

const AGE_LABELS: Record<AgeBucket, string> = {
  "24_and_younger": "≤24",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55+",
};

/** Diverging bars: Qloo demographic affinity is relative to average (−1 … +1). */
export function DemographicsBars({ demographics, className }: { demographics?: Demographics; className?: string }) {
  if (!demographics) return <p className="text-xs text-faint">No demographic signal returned.</p>;
  const ages = Object.keys(AGE_LABELS) as AgeBucket[];
  const max = Math.max(0.25, ...ages.map((a) => Math.abs(demographics.age[a] ?? 0)));
  const male = demographics.gender.male ?? 0;
  const female = demographics.gender.female ?? 0;
  return (
    <div className={cn("space-y-1.5", className)}>
      {ages.map((age) => {
        const v = demographics.age[age] ?? 0;
        const w = (Math.abs(v) / max) * 50;
        return (
          <div key={age} className="flex items-center gap-2 text-[11px]">
            <span className="w-10 shrink-0 text-right font-mono text-muted">{AGE_LABELS[age]}</span>
            <div className="relative h-3 flex-1 rounded-sm bg-surface-2">
              <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
              <div
                className="absolute inset-y-0 rounded-sm"
                style={{
                  left: v >= 0 ? "50%" : `${50 - w}%`,
                  width: `${w}%`,
                  background: v >= 0 ? "var(--turf)" : "var(--rose)",
                  opacity: 0.85,
                }}
              />
            </div>
            <span className={cn("w-10 shrink-0 font-mono", v >= 0 ? "text-turf" : "text-rose")}>
              {v > 0 ? "+" : ""}
              {v.toFixed(2)}
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-1 font-mono text-[10px] text-faint">
        <span>under-indexes</span>
        <span>
          gender skew: {female > male ? `female +${(female - male).toFixed(2)}` : male > female ? `male +${(male - female).toFixed(2)}` : "even"}
        </span>
        <span>over-indexes</span>
      </div>
    </div>
  );
}

/** "Qloo request failed (429)" when the profile's trend request failed, as opposed to Qloo having no data. */
export const trendFailure = (profile?: EntityProfile) => profile?.unavailable?.find((u) => u.startsWith("Trend: "))?.slice("Trend: ".length);

export function TrendSpark({
  trend,
  failed,
  kind,
  width = 220,
  height = 48,
}: {
  trend?: TrendSeries;
  failed?: string;
  kind?: EntityKind;
  width?: number;
  height?: number;
}) {
  if (failed) return <p className="text-xs text-rose">Trend unavailable: {failed}.</p>;
  if (kind === "book" || kind === "videogame") return <p className="text-xs text-faint">Qloo doesn&apos;t track trending for books or video games.</p>;
  if (!trend || trend.points.length < 2) return <p className="text-xs text-faint">Not tracked in Qloo&apos;s trending data.</p>;
  const values = trend.points.map((p) => p.percentile);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const xs = (i: number) => (i / (values.length - 1)) * width;
  const ys = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  const line = values.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  const color = trend.direction === "rising" ? "var(--turf)" : trend.direction === "cooling" ? "var(--rose)" : "var(--sky)";
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-12 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`g-${trend.direction}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#g-${trend.direction})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-faint" title="Qloo trending population percentile, weekly">
        <span>{trend.points[0].date}</span>
        <span style={{ color }}>
          {trend.direction} {trend.changePct > 0 ? "+" : ""}
          {trend.changePct}%
        </span>
        <span>{trend.points.at(-1)?.date}</span>
      </div>
    </div>
  );
}

const SCORE_COLORS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  localAffinity: "var(--amber)",
  segmentFit: "var(--turf)",
  nearVenue: "var(--sky)",
  momentum: "var(--violet)",
  newFanReach: "var(--rose)",
};

export function ScoreBars({ score }: { score: ScoreBreakdown }) {
  return (
    <div className="space-y-2.5">
      {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((key) => (
        <div key={key} title={SCORE_LABELS[key].help}>
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="text-muted">
              {SCORE_LABELS[key].label} <span className="text-faint">×{SCORE_WEIGHTS[key]}</span>
              {score.estimated?.includes(key) && (
                <span className="ml-1.5 rounded border border-line px-1 font-mono text-[9px] uppercase text-faint" title="Qloo couldn't measure this for the fandom, so it scores a neutral 0.5">
                  est.
                </span>
              )}
            </span>
            <span className="font-mono text-text">{score[key].toFixed(2)}</span>
          </div>
          <Meter value={score[key]} color={SCORE_COLORS[key]} />
        </div>
      ))}
    </div>
  );
}
