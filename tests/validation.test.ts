import { describe, expect, it } from "vitest";
import { PRESETS, teamFromPreset } from "@/lib/presets";
import type { TeamConfig } from "@/lib/types";
import { TeamSchema } from "@/lib/validation";

const base = (): TeamConfig => teamFromPreset(PRESETS[0], 4);

/** Parse a team after applying `change`; returns the first failing path, or "ok". */
function check(change: (team: TeamConfig) => void): string {
  const team = structuredClone(base());
  change(team);
  const result = TeamSchema.safeParse(team);
  return result.success ? "ok" : result.error.issues[0].path.join(".");
}

describe("TeamSchema", () => {
  it("accepts every preset team", () => {
    for (const preset of PRESETS) expect(TeamSchema.safeParse(teamFromPreset(preset)).success).toBe(true);
  });

  it("rejects dates that aren't YYYY-MM-DD", () => {
    for (const bad of ["2027/04/06", "04-06-2027", "2027-4-6", "2027-04-06T19:05:00Z", ""]) {
      expect(check((t) => (t.dates[0].date = bad))).toBe("dates.0.date");
    }
  });

  it("rejects out-of-range or non-numeric venue coordinates", () => {
    expect(check((t) => (t.venue.lat = 90.5))).toBe("venue.lat");
    expect(check((t) => (t.venue.lat = -91))).toBe("venue.lat");
    expect(check((t) => (t.venue.lon = 180.1))).toBe("venue.lon");
    expect(check((t) => (t.venue.lon = -181))).toBe("venue.lon");
    expect(check((t) => (t.venue.lat = Number.NaN))).toBe("venue.lat");
    expect(check((t) => ((t.venue as { lat: unknown }).lat = "35.99"))).toBe("venue.lat");
    expect(
      check((t) => {
        t.venue.lat = 90;
        t.venue.lon = -180;
      }),
    ).toBe("ok");
  });

  it("rejects unknown enums", () => {
    expect(check((t) => ((t as { sport: string }).sport = "cricket"))).toBe("sport");
    expect(check((t) => ((t.dates[0] as { segment: string }).segment = "everyone"))).toBe("dates.0.segment");
    expect(check((t) => ((t.dates[0] as { time: string }).time = "evening"))).toBe("dates.0.time");
    expect(check((t) => ((t as { ipPolicy: string }).ipPolicy = "anything_goes"))).toBe("ipPolicy");
  });

  it("enforces size limits that keep requests and prompts bounded", () => {
    expect(check((t) => (t.teamName = ""))).toBe("teamName");
    expect(check((t) => (t.teamName = "x".repeat(81)))).toBe("teamName");
    expect(check((t) => (t.venue.city = "D"))).toBe("venue.city");
    expect(check((t) => (t.dates = Array.from({ length: 121 }, () => t.dates[0])))).toBe("dates");
    expect(check((t) => (t.sponsorCategories = Array.from({ length: 9 }, (_, i) => `Category ${i}`)))).toBe("sponsorCategories");
    expect(check((t) => (t.notes = "x".repeat(601)))).toBe("notes");
  });
});
