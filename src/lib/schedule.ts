import type { GameDate, SegmentId, Sport } from "./types";

export const SEGMENTS: Record<SegmentId, { label: string; short: string; qloo: string; emoji: string }> = {
  families: {
    label: "Families",
    short: "Parents with kids",
    qloo: "Qloo audience signal: life-stage parents",
    emoji: "👨‍👩‍👧",
  },
  gen_z: { label: "Gen Z", short: "Students & under-25s", qloo: "Qloo age signal: 24 and younger", emoji: "⚡" },
  young_pros: {
    label: "Young pros",
    short: "25–34, after-work crowd",
    qloo: "Qloo age signal: 25–29, 30–34",
    emoji: "🍻",
  },
  boomers: { label: "55+", short: "Season-ticket core & retirees", qloo: "Qloo age signal: 55 and older", emoji: "🧢" },
};

export const SPORTS: Record<Sport, { label: string; league: string; icon: string }> = {
  baseball: { label: "Baseball", league: "Triple-A (MiLB)", icon: "⚾" },
  basketball: { label: "Basketball", league: "G League", icon: "🏀" },
  hockey: { label: "Hockey", league: "AHL", icon: "🏒" },
  soccer: { label: "Soccer", league: "USL Championship", icon: "⚽" },
  football: { label: "Football", league: "College (FBS)", icon: "🏈" },
};

const OPPONENTS: Record<Sport, string[]> = {
  baseball: ["Norfolk", "Charlotte", "Gwinnett", "Memphis", "Nashville", "Jacksonville", "Louisville", "Indianapolis", "Toledo", "Columbus", "Lehigh Valley", "Worcester"],
  basketball: ["Austin", "Birmingham", "Capital City", "College Park", "Delaware", "Greensboro", "Maine", "Raptors 905", "Wisconsin", "Windy City"],
  hockey: ["Charlotte", "Hershey", "Providence", "Springfield", "Bridgeport", "Hartford", "Lehigh Valley", "Wilkes-Barre"],
  soccer: ["Louisville City", "Tampa Bay", "Charleston", "Indy Eleven", "Pittsburgh", "Detroit City", "Birmingham Legion", "Sacramento"],
  football: ["State", "Tech", "A&M", "Coastal", "Central", "Northern"],
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

export function weekdayOf(date: string) {
  return WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function defaultSegment(weekday: string, time: "day" | "night", month: number): SegmentId {
  if (time === "day" && (weekday === "Sun" || weekday === "Sat")) return "families";
  if (time === "day") return month >= 6 && month <= 8 ? "families" : "boomers";
  if (weekday === "Fri" || weekday === "Sat") return "young_pros";
  if (weekday === "Thu") return "young_pros";
  if (weekday === "Mon" || weekday === "Tue") return "boomers";
  return "gen_z";
}

function game(date: Date, time: "day" | "night", opponent: string): GameDate {
  const weekday = WEEKDAY[date.getUTCDay()];
  return {
    date: iso(date),
    weekday,
    time,
    opponent,
    target: false,
    segment: defaultSegment(weekday, time, date.getUTCMonth() + 1),
  };
}

/** A realistic home schedule for the next season so the demo works without uploading anything. */
export function generateSchedule(sport: Sport): GameDate[] {
  const opponents = OPPONENTS[sport];
  const out: GameDate[] = [];
  if (sport === "baseball") {
    // Six-game homestands (Tue–Sun) on alternating weeks, April through mid-September 2027.
    let tuesday = utc(2027, 4, 6);
    let home = true;
    let o = 0;
    while (tuesday < utc(2027, 9, 20)) {
      if (home) {
        const opp = opponents[o++ % opponents.length];
        for (let i = 0; i < 6; i++) {
          const d = addDays(tuesday, i);
          out.push(game(d, d.getUTCDay() === 0 ? "day" : "night", opp));
        }
      }
      home = !home;
      tuesday = addDays(tuesday, 7);
    }
  } else if (sport === "soccer") {
    let d = utc(2027, 3, 13);
    let o = 0;
    while (d < utc(2027, 10, 20)) {
      out.push(game(d, "night", opponents[o++ % opponents.length]));
      d = addDays(d, o % 5 === 0 ? 11 : 14);
      if (o % 5 === 0) d = addDays(d, -3); // occasional Wednesday match
    }
  } else if (sport === "football") {
    let d = utc(2027, 9, 4);
    for (let i = 0; i < 7; i++) {
      out.push(game(d, i % 3 === 2 ? "night" : "day", opponents[i % opponents.length]));
      d = addDays(d, i % 2 === 0 ? 14 : 7);
    }
  } else {
    // Basketball / hockey: roughly two home dates a week through the winter.
    const start = sport === "hockey" ? utc(2026, 10, 16) : utc(2026, 11, 13);
    const end = sport === "hockey" ? utc(2027, 4, 18) : utc(2027, 3, 28);
    let d = start;
    let o = 0;
    const pattern = [3, 4, 3, 2, 5];
    while (d < end) {
      const day = d.getUTCDay();
      out.push(game(d, day === 0 ? "day" : "night", opponents[o % opponents.length]));
      d = addDays(d, pattern[o++ % pattern.length]);
    }
  }
  return out;
}

/** Weakness heuristic: weekday + shoulder-season dates draw the smallest crowds. */
export function weaknessScore(g: GameDate): number {
  const month = Number(g.date.slice(5, 7));
  let s = 0;
  if (["Mon", "Tue", "Wed"].includes(g.weekday)) s += 3;
  if (g.weekday === "Thu") s += 2;
  if (g.weekday === "Sun" && g.time === "night") s += 1;
  if ([4, 5, 9].includes(month)) s += 1.5; // school year + cold nights for summer sports
  if ([11, 1, 2].includes(month)) s += 1; // winter sports' slow months
  if (g.weekday === "Fri" || g.weekday === "Sat") s -= 3;
  return s;
}

/**
 * Pick `n` weak dates spread across the season (at least `gapDays` apart), rotating through audience
 * segments so a season plan serves more than one crowd.
 */
export function pickWeakDates(dates: GameDate[], n: number, gapDays = 9): GameDate[] {
  const ranked = [...dates].sort((a, b) => weaknessScore(b) - weaknessScore(a) || a.date.localeCompare(b.date));
  const bySegment = new Map<SegmentId, GameDate[]>();
  for (const g of ranked) bySegment.set(g.segment, [...(bySegment.get(g.segment) ?? []), g]);
  const order = [...bySegment.keys()].sort((a, b) => weaknessScore(bySegment.get(b)![0]) - weaknessScore(bySegment.get(a)![0]));

  const chosen: GameDate[] = [];
  const farEnough = (g: GameDate) =>
    chosen.every((c) => Math.abs(new Date(c.date).getTime() - new Date(g.date).getTime()) >= gapDays * 86400000);
  let progress = true;
  while (chosen.length < n && progress) {
    progress = false;
    for (const segment of order) {
      if (chosen.length >= n) break;
      const next = bySegment.get(segment)?.find((g) => !chosen.includes(g) && farEnough(g));
      if (next) {
        chosen.push(next);
        progress = true;
      }
    }
  }
  const keys = new Set(chosen.map((c) => c.date));
  return dates.map((g) => ({ ...g, target: keys.has(g.date) }));
}

export function withTargets(dates: GameDate[], n: number): GameDate[] {
  return pickWeakDates(dates, n);
}

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}
