import { describe, expect, it } from "vitest";
import { computeScore, SCORE_WEIGHTS } from "@/lib/scoring";
import type { EntityCard, EntityProfile } from "@/lib/types";

const entity: EntityCard = { id: "m1", name: "The Sandlot", kind: "movie" };

const profile = (opts: { changePct?: number; nearVenueIndex?: number }): EntityProfile => ({
  entity,
  evidence: [],
  trend: opts.changePct === undefined ? undefined : { points: [], direction: "steady", changePct: opts.changePct },
  heat: opts.nearVenueIndex === undefined ? undefined : { points: [], nearVenueIndex: opts.nearVenueIndex, catchmentKm: 16 },
});

describe("SCORE_WEIGHTS", () => {
  it("sums to 1 so a perfect fandom scores 100", () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe("computeScore", () => {
  it("defaults every unmeasured component to 0.5 (total 50)", () => {
    expect(computeScore({ entity, segment: "families" })).toEqual({
      total: 50,
      localAffinity: 0.5,
      segmentFit: 0.5,
      nearVenue: 0.5,
      momentum: 0.5,
      newFanReach: 0.5,
    });
  });

  it("prefers the measured local rank over the card's raw affinity", () => {
    const card = { ...entity, affinity: 0.2 };
    expect(computeScore({ entity: card, segment: "families" }).localAffinity).toBe(0.2);
    expect(computeScore({ entity: card, segment: "families", localAffinity: 0.9 }).localAffinity).toBe(0.9);
  });

  it("reads segment fit for the requested segment only", () => {
    const segmentFit = { families: 0.8, gen_z: 0.1 };
    expect(computeScore({ entity, segment: "families", segmentFit }).segmentFit).toBe(0.8);
    expect(computeScore({ entity, segment: "gen_z", segmentFit }).segmentFit).toBe(0.1);
    expect(computeScore({ entity, segment: "boomers", segmentFit }).segmentFit).toBe(0.5);
  });

  it("takes near-venue strength from the heatmap summary", () => {
    expect(computeScore({ entity, segment: "families", profile: profile({ nearVenueIndex: 0.72 }) }).nearVenue).toBe(0.72);
  });

  it("maps trend change to momentum = 0.5 + changePct / 40, clamped to 0..1", () => {
    const momentum = (changePct: number) => computeScore({ entity, segment: "families", profile: profile({ changePct }) }).momentum;
    expect(momentum(0)).toBe(0.5);
    expect(momentum(10)).toBe(0.75);
    expect(momentum(-10)).toBe(0.25);
    expect(momentum(20)).toBe(1);
    expect(momentum(120)).toBe(1);
    expect(momentum(-60)).toBe(0);
    expect(momentum(1 / 3)).toBe(0.508); // rounded to 3 decimals
  });

  it("maps fan overlap to new-fan reach = 1 - overlap * 0.8", () => {
    const reach = (fanOverlap: number) => computeScore({ entity, segment: "families", fanOverlap }).newFanReach;
    expect(reach(0)).toBe(1);
    expect(reach(0.5)).toBe(0.6);
    expect(reach(1)).toBe(0.2);
  });

  it("clamps out-of-range inputs to 0..1", () => {
    const high = computeScore({
      entity,
      segment: "families",
      localAffinity: 1.4,
      segmentFit: { families: 2 },
      profile: profile({ nearVenueIndex: 3 }),
      fanOverlap: -1,
    });
    expect(high).toMatchObject({ localAffinity: 1, segmentFit: 1, nearVenue: 1, newFanReach: 1 });

    const low = computeScore({ entity, segment: "families", localAffinity: -0.3, segmentFit: { families: -1 }, fanOverlap: 5 });
    expect(low).toMatchObject({ localAffinity: 0, segmentFit: 0, newFanReach: 0 });
  });

  it("weights components into a 0-100 total", () => {
    const best = computeScore({
      entity,
      segment: "families",
      localAffinity: 1,
      segmentFit: { families: 1 },
      profile: profile({ changePct: 20, nearVenueIndex: 1 }),
      fanOverlap: 0,
    });
    expect(best.total).toBe(100);

    const worst = computeScore({
      entity,
      segment: "families",
      localAffinity: 0,
      segmentFit: { families: 0 },
      profile: profile({ changePct: -20, nearVenueIndex: 0 }),
      fanOverlap: 1,
    });
    // Only new-fan reach has a floor (1 - 0.8 = 0.2): 100 * 0.1 * 0.2.
    expect(worst.total).toBe(2);

    const mixed = computeScore({
      entity,
      segment: "families",
      localAffinity: 0.9,
      segmentFit: { families: 0.8 },
      profile: profile({ changePct: 20, nearVenueIndex: 0.8 }),
      fanOverlap: 0.25,
    });
    // 100 * (0.3*0.9 + 0.25*0.8 + 0.2*0.8 + 0.15*1 + 0.1*0.8) = 86
    expect(mixed.total).toBe(86);
  });

  it("rounds the total to the nearest integer", () => {
    // 100 * (0.3*0.51 + 0.7*0.5) = 50.3
    expect(computeScore({ entity, segment: "families", localAffinity: 0.51 }).total).toBe(50);
    // 100 * (0.3*0.52 + 0.7*0.5) = 50.6
    expect(computeScore({ entity, segment: "families", localAffinity: 0.52 }).total).toBe(51);
  });
});
