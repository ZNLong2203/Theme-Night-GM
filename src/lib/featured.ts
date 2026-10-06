import "server-only";
import { PRESETS } from "./presets";
import { kvGet } from "./store";

export interface Featured {
  slug: string;
  city: string;
  id: string;
  at: string;
  team: string;
}

/** The latest live plan for each demo market, so visitors can open a finished plan instantly. */
export async function featuredPlans(): Promise<Featured[]> {
  const rows = await Promise.all(
    PRESETS.map(async (p) => {
      const hit = await kvGet<{ id: string; at: string; team: string }>(`featured:${p.slug}`);
      return hit ? { slug: p.slug, city: p.venue.city.split(",")[0], ...hit } : null;
    }),
  );
  return rows.filter((r): r is Featured => Boolean(r));
}
