import type { EntityCard, EntityProfile, ScoreBreakdown, SegmentId } from "./types";

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
    help: "Qloo affinity for this fandom with a location signal on your city (/v2/insights · signal.location.query).",
  },
  segmentFit: {
    label: "Audience fit",
    help: "Qloo affinity when the same shortlist is scored for the night's target segment (age or life-stage audience signal).",
  },
  nearVenue: {
    label: "Fans near the venue",
    help: "Share of the fandom's Qloo heatmap affinity inside the venue's catchment vs the wider metro (urn:heatmap).",
  },
  momentum: {
    label: "Momentum",
    help: "Change in Qloo trending percentile over the last 16 weeks (/v2/trending).",
  },
  newFanReach: {
    label: "New-fan reach",
    help: "1 minus the affinity existing sport fans already have for this fandom: high = brings people who aren't coming yet.",
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
  const localAffinity = clamp(input.localAffinity ?? input.entity.affinity ?? 0.5);
  const segmentFit = clamp(input.segmentFit?.[input.segment] ?? 0.5);
  const nearVenue = clamp(input.profile?.heat?.nearVenueIndex ?? 0.5);
  const change = input.profile?.trend?.changePct ?? 0;
  const momentum = clamp(0.5 + change / 40);
  const newFanReach = clamp(input.fanOverlap === undefined ? 0.5 : 1 - input.fanOverlap * 0.8);
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
  };
}
