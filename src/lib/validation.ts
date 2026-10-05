import { z } from "zod";

const SEGMENT = z.enum(["families", "gen_z", "young_pros", "boomers"]);

export const TeamSchema = z.object({
  teamName: z.string().min(1).max(80),
  sport: z.enum(["baseball", "basketball", "hockey", "soccer", "football"]),
  league: z.string().max(80),
  venue: z.object({
    name: z.string().max(120),
    city: z.string().min(2).max(120),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  dates: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        weekday: z.string(),
        time: z.enum(["day", "night"]),
        opponent: z.string().max(60).optional(),
        target: z.boolean(),
        segment: SEGMENT,
      }),
    )
    .max(120),
  ipPolicy: z.enum(["licensed_ok", "ip_light"]),
  sponsorCategories: z.array(z.string().max(40)).max(8),
  notes: z.string().max(600).optional(),
});
