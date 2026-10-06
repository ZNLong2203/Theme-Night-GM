import type { EntityCard, EntityProfile, ScoreBreakdown, ScoreComponent, SegmentId } from "./types";

/** Weights for the Taste Fit Score. Kept in one place so the UI can explain them. */
export const SCORE_WEIGHTS = {
  localAffinity: 0.3,
  segmentFit: 0.25,
  nearVenue: 0.2,
  momentum: 0.15,
  newFanReach: 0.1,
} as const;

export const SCORE_LABELS: Record<keyof typeof SCORE_WEIGHTS, { label: string; help: string }> = {
  localAffinity: {
    label: "Local affinity",
    help: "Rank percentile of this fandom among your city's top 25 in its domain, ranked by Qloo with the city as location signal (/v2/insights · signal.location.query).",
  },
  segmentFit: {
    label: "Audience fit",
    help: "Half: rank percentile when the same pool is re-ranked with the night's age or life-stage audience signal. Half: urn:demographics alignment for that segment.",
  },
  nearVenue: {
    label: "Fans near the venue",
    help: "Share of the fandom's metro hotspots (top 20% of Qloo heatmap cells) inside the venue's 16 km catchment, relative to the catchment's share of all cells. 0.5 = fair share (urn:heatmap).",
  },
  momentum: {
    label: "Momentum",
    help: "Change in Qloo trending percentile across a 16-week window (/v2/trending; uses the latest window with data).",
  },
  newFanReach: {
    label: "New-fan reach",
    help: "Inverse of how highly existing sport fans (a league proxy entity) rank this fandom: high = brings people who aren't coming yet.",
  },
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function computeScore(input: {
  entity: EntityCard;
  segment: SegmentId;
  localAffinity?: number;
  profile?: EntityProfile;
  segmentFit?: Partial<Record<SegmentId, number>>;
  fanOverlap?: number;
}): ScoreBreakdown {
  // A missing measurement scores a neutral 0.5 and is flagged; raw affinity from some other query is
  // never used instead, because Qloo normalizes affinity per query.
  const estimated: ScoreComponent[] = [];
  const measured = (component: ScoreComponent, value: number | undefined) => {
    if (value === undefined) estimated.push(component);
    return clamp(value ?? 0.5);
  };
  const trend = input.profile?.trend;
  const localAffinity = measured("localAffinity", input.localAffinity);
  const segmentFit = measured("segmentFit", input.segmentFit?.[input.segment]);
  const nearVenue = measured("nearVenue", input.profile?.heat?.nearVenueIndex);
  const momentum = measured("momentum", trend && trend.direction !== "unknown" ? 0.5 + trend.changePct / 40 : undefined);
  const newFanReach = measured("newFanReach", input.fanOverlap === undefined ? undefined : 1 - input.fanOverlap * 0.8);
  const total =
    100 *
    (SCORE_WEIGHTS.localAffinity * localAffinity +
      SCORE_WEIGHTS.segmentFit * segmentFit +
      SCORE_WEIGHTS.nearVenue * nearVenue +
      SCORE_WEIGHTS.momentum * momentum +
      SCORE_WEIGHTS.newFanReach * newFanReach);
  const r = (n: number) => Number(n.toFixed(3));
  return {
    total: Math.round(total),
    localAffinity: r(localAffinity),
    segmentFit: r(segmentFit),
    nearVenue: r(nearVenue),
    momentum: r(momentum),
    newFanReach: r(newFanReach),
    ...(estimated.length ? { estimated } : {}),
  };
}
