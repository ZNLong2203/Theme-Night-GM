import { generateSchedule, SPORTS, withTargets } from "./schedule";
import type { Sport, TeamConfig } from "./types";

export interface Preset {
  slug: string;
  teamName: string;
  sport: Sport;
  league: string;
  venue: TeamConfig["venue"];
  blurb: string;
  sponsorCategories: string[];
  ipPolicy: TeamConfig["ipPolicy"];
}

// Team names are fictional; cities and venue coordinates are real so Qloo's location signals are meaningful.
export const PRESETS: Preset[] = [
  {
    slug: "durham-baseball",
    teamName: "Bull City Ballclub",
    sport: "baseball",
    league: "Triple-A (MiLB)",
    venue: { name: "Downtown ballpark, Durham", city: "Durham, North Carolina", lat: 35.9916, lon: -78.9045 },
    blurb: "72 home dates, 10,000 seats, and a lot of empty ones on April Tuesdays.",
    sponsorCategories: ["Beverages", "Restaurants", "Telecommunications"],
    ipPolicy: "ip_light",
  },
  {
    slug: "la-baseball",
    teamName: "Chavez Ravine Nine",
    sport: "baseball",
    league: "MLB",
    venue: { name: "Chavez Ravine ballpark", city: "Los Angeles, California", lat: 34.0739, lon: -118.24 },
    blurb: "A sellout machine that still has soft Tuesdays in April and September.",
    sponsorCategories: ["Beverages", "Automotive", "Telecommunications"],
    ipPolicy: "licensed_ok",
  },
  {
    slug: "portland-soccer",
    teamName: "Rose City Rovers",
    sport: "soccer",
    league: "USL Championship",
    venue: { name: "Goose Hollow stadium, Portland", city: "Portland, Oregon", lat: 45.5215, lon: -122.6917 },
    blurb: "Loud supporters' section, quiet midweek matches.",
    sponsorCategories: ["Beverages", "Apparel", "Outdoor Gear"],
    ipPolicy: "ip_light",
  },
  {
    slug: "nashville-hockey",
    teamName: "Music City Mudcats",
    sport: "hockey",
    league: "AHL",
    venue: { name: "Lower Broadway arena, Nashville", city: "Nashville, Tennessee", lat: 36.1592, lon: -86.7785 },
    blurb: "Winter weeknights competing with every honky-tonk on Broadway.",
    sponsorCategories: ["Beer", "Automotive", "Restaurants"],
    ipPolicy: "licensed_ok",
  },
];

export function teamFromPreset(preset: Preset, nights = 6): TeamConfig {
  return {
    teamName: preset.teamName,
    sport: preset.sport,
    league: preset.league || SPORTS[preset.sport].league,
    venue: preset.venue,
    dates: withTargets(generateSchedule(preset.sport), nights),
    ipPolicy: preset.ipPolicy,
    sponsorCategories: preset.sponsorCategories,
  };
}
