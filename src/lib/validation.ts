import { z } from "zod";
import { weekdayOf } from "./schedule";

const SEGMENT = z.enum(["families", "gen_z", "young_pros", "boomers"]);
/** A real calendar date (2027-02-30 is rejected), not just the YYYY-MM-DD shape. */
const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "Not a real calendar date");

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
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).pipe(ISO_DATE),
        // Goes into the prompts, so it's bounded here and re-derived from the date below.
        weekday: z.string().max(12),
        time: z.enum(["day", "night"]),
        opponent: z.string().max(60).optional(),
        target: z.boolean(),
        segment: SEGMENT,
      }),
    )
    .max(120)
    .transform((dates) => dates.map((d) => ({ ...d, weekday: weekdayOf(d.date) }))),
  ipPolicy: z.enum(["licensed_ok", "ip_light"]),
  sponsorCategories: z.array(z.string().max(40)).max(6),
  notes: z.string().max(600).optional(),
});
