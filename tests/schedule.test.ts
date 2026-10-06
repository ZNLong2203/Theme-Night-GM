import { describe, expect, it } from "vitest";
import { defaultSegment, generateSchedule, pickWeakDates, weaknessScore, weekdayOf, withTargets } from "@/lib/schedule";
import type { GameDate, SegmentId, Sport } from "@/lib/types";

const DAY = 86400000;
const daysBetween = (a: string, b: string) => Math.abs(new Date(b).getTime() - new Date(a).getTime()) / DAY;

const game = (date: string, segment: SegmentId, time: GameDate["time"] = "night"): GameDate => ({
  date,
  weekday: weekdayOf(date),
  time,
  target: false,
  segment,
});

describe("weekdayOf", () => {
  it("returns the short UTC weekday for an ISO date", () => {
    expect(weekdayOf("2027-04-06")).toBe("Tue");
    expect(weekdayOf("2027-09-12")).toBe("Sun");
    expect(weekdayOf("2024-02-29")).toBe("Thu");
    expect(weekdayOf("2026-12-31")).toBe("Thu");
  });
});

describe("defaultSegment", () => {
  it("programs weekend day games for families and midweek nights for older or younger crowds", () => {
    expect(defaultSegment("Sat", "day", 4)).toBe("families");
    expect(defaultSegment("Wed", "day", 7)).toBe("families");
    expect(defaultSegment("Wed", "day", 4)).toBe("boomers");
    expect(defaultSegment("Fri", "night", 5)).toBe("young_pros");
    expect(defaultSegment("Thu", "night", 5)).toBe("young_pros");
    expect(defaultSegment("Mon", "night", 5)).toBe("boomers");
    expect(defaultSegment("Wed", "night", 5)).toBe("gen_z");
  });
});

describe("generateSchedule", () => {
  const SEASONS: Record<Sport, { from: string; to: string; minGames: number; maxGames: number }> = {
    baseball: { from: "2027-04-01", to: "2027-09-30", minGames: 72, maxGames: 72 },
    basketball: { from: "2026-11-01", to: "2027-03-31", minGames: 30, maxGames: 50 },
    hockey: { from: "2026-10-01", to: "2027-04-30", minGames: 40, maxGames: 70 },
    soccer: { from: "2027-03-01", to: "2027-10-31", minGames: 12, maxGames: 24 },
    football: { from: "2027-09-01", to: "2027-11-30", minGames: 7, maxGames: 7 },
  };

  for (const sport of Object.keys(SEASONS) as Sport[]) {
    it(`builds a plausible ${sport} home schedule`, () => {
      const season = SEASONS[sport];
      const dates = generateSchedule(sport);
      expect(dates.length).toBeGreaterThanOrEqual(season.minGames);
      expect(dates.length).toBeLessThanOrEqual(season.maxGames);
      for (const [i, g] of dates.entries()) {
        expect(g.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(g.date >= season.from && g.date <= season.to).toBe(true);
        if (i > 0) expect(g.date > dates[i - 1].date).toBe(true); // sorted, no doubleheaders
        expect(g.weekday).toBe(weekdayOf(g.date));
        expect(g.segment).toBe(defaultSegment(g.weekday, g.time, Number(g.date.slice(5, 7))));
        expect(g.target).toBe(false);
        expect(g.opponent).toBeTruthy();
      }
    });
  }

  it("plays baseball in Tuesday-Sunday homestands with Sunday day games", () => {
    const dates = generateSchedule("baseball");
    expect(dates.some((g) => g.weekday === "Mon")).toBe(false);
    for (const g of dates) expect(g.time).toBe(g.weekday === "Sun" ? "day" : "night");
    // 12 six-game homestands, one opponent each.
    const opponents = new Map<string, number>();
    for (const g of dates) opponents.set(g.opponent!, (opponents.get(g.opponent!) ?? 0) + 1);
    expect([...opponents.values()].every((n) => n === 6)).toBe(true);
  });

  it("plays soccer on Saturdays with occasional Wednesday fixtures, never drifting off that cadence", () => {
    const dates = generateSchedule("soccer");
    const weekdays = new Set(dates.map((g) => g.weekday));
    expect([...weekdays].sort()).toEqual(["Sat", "Wed"]);
    expect(dates.filter((g) => g.weekday === "Sat").length).toBeGreaterThan(dates.filter((g) => g.weekday === "Wed").length);
    for (let i = 1; i < dates.length; i++) expect(daysBetween(dates[i - 1].date, dates[i].date)).toBeGreaterThanOrEqual(10);
  });

  it("plays college football on Saturdays", () => {
    expect(generateSchedule("football").every((g) => g.weekday === "Sat")).toBe(true);
  });

  it("plays basketball and hockey every two to five days through the winter", () => {
    for (const sport of ["basketball", "hockey"] as const) {
      const dates = generateSchedule(sport);
      for (let i = 1; i < dates.length; i++) {
        const gap = daysBetween(dates[i - 1].date, dates[i].date);
        expect(gap).toBeGreaterThanOrEqual(2);
        expect(gap).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe("weaknessScore", () => {
  it("rates shoulder-season weeknights as weak and weekends as strong", () => {
    expect(weaknessScore(game("2027-04-06", "boomers"))).toBe(4.5); // Tue in April
    expect(weaknessScore(game("2027-07-08", "young_pros"))).toBe(2); // Thu in July
    expect(weaknessScore(game("2027-07-11", "gen_z", "night"))).toBe(1); // Sunday night
    expect(weaknessScore(game("2027-07-10", "young_pros"))).toBe(-3); // Saturday
  });
});

describe("pickWeakDates", () => {
  const baseball = generateSchedule("baseball");

  it("flags exactly n targets without reordering or mutating the schedule", () => {
    const picked = pickWeakDates(baseball, 6);
    expect(picked).toHaveLength(baseball.length);
    expect(picked.map((g) => g.date)).toEqual(baseball.map((g) => g.date));
    expect(picked.filter((g) => g.target)).toHaveLength(6);
    expect(baseball.some((g) => g.target)).toBe(false);
  });

  it("spreads targets at least gapDays apart", () => {
    for (const [n, gapDays] of [
      [6, 9],
      [4, 21],
    ] as const) {
      const targets = pickWeakDates(baseball, n, gapDays).filter((g) => g.target);
      expect(targets).toHaveLength(n);
      for (const a of targets) {
        for (const b of targets) if (a !== b) expect(daysBetween(a.date, b.date)).toBeGreaterThanOrEqual(gapDays);
      }
    }
  });

  it("rotates through audience segments instead of stacking the weakest one", () => {
    const four = pickWeakDates(baseball, 4).filter((g) => g.target);
    expect(new Set(four.map((g) => g.segment)).size).toBe(4);

    const six = pickWeakDates(baseball, 6).filter((g) => g.target);
    const counts = new Map<SegmentId, number>();
    for (const g of six) counts.set(g.segment, (counts.get(g.segment) ?? 0) + 1);
    expect(counts.size).toBe(4);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  it("picks a weaker date from a new segment before a second date from the same one", () => {
    const dates = [
      game("2027-04-06", "boomers"), // Tue, score 4.5
      game("2027-04-20", "boomers"), // Tue, score 4.5
      game("2027-04-24", "young_pros"), // Sat, score -1.5
      game("2027-05-04", "boomers"), // Tue, score 4.5
    ];
    const targets = pickWeakDates(dates, 2).filter((g) => g.target);
    expect(targets.map((g) => g.date)).toEqual(["2027-04-06", "2027-04-24"]);
  });

  it("breaks ties by the earlier date", () => {
    const dates = [game("2027-05-04", "boomers"), game("2027-04-06", "boomers")];
    expect(pickWeakDates(dates, 1).filter((g) => g.target).map((g) => g.date)).toEqual(["2027-04-06"]);
  });

  it("returns fewer than n targets when the spacing rule cannot be met", () => {
    const dates = [game("2027-04-06", "boomers"), game("2027-04-07", "gen_z"), game("2027-04-08", "young_pros")];
    expect(pickWeakDates(dates, 3).filter((g) => g.target)).toHaveLength(1);
  });

  it("is what withTargets uses with the default 9-day gap", () => {
    expect(withTargets(baseball, 5)).toEqual(pickWeakDates(baseball, 5, 9));
  });
});
