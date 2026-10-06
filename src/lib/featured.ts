import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PRESETS } from "./presets";
import { kvGet } from "./store";
import type { AgentEvent, SeasonPlan } from "./types";

export interface Featured {
  slug: string;
  city: string;
  id: string;
  at: string;
  team: string;
}

/**
 * Recorded live runs for the demo markets (data/featured/<slug>.json: plan with its control result,
 * plus the run's event log). They ship inside the deployment (see outputFileTracingIncludes), so the
 * featured plans, their share links and their replays keep working even if Redis is full, flushed,
 * expired or unreachable. They are not committed: they hold Qloo API data. Without them the app falls
 * back to the latest live preset run recorded in the store.
 */
interface Recorded {
  slug: string;
  plan: SeasonPlan;
  events: AgentEvent[];
}

const DIR = path.join(process.cwd(), "data", "featured");
const recordings = new Map<string, Promise<Recorded | null>>();

function recorded(slug: string): Promise<Recorded | null> {
  let pending = recordings.get(slug);
  if (!pending) {
    pending = readFile(path.join(DIR, `${slug}.json`), "utf8")
      .then((raw) => JSON.parse(raw) as Recorded)
      .catch(() => null);
    recordings.set(slug, pending);
  }
  return pending;
}

const allRecorded = async () => (await Promise.all(PRESETS.map((p) => recorded(p.slug)))).filter((r): r is Recorded => Boolean(r));

/** One finished live plan per demo market, so visitors can open a plan or a replay instantly. */
export async function featuredPlans(): Promise<Featured[]> {
  const rows = await Promise.all(
    PRESETS.map(async (p): Promise<Featured | null> => {
      const city = p.venue.city.split(",")[0];
      // A curated recording wins over the latest live run, so every judge sees the same reviewed plans.
      const rec = await recorded(p.slug);
      if (rec) return { slug: p.slug, city, id: rec.plan.id, at: rec.plan.createdAt, team: rec.plan.team.teamName };
      const hit = await kvGet<{ id: string; at: string; team: string }>(`featured:${p.slug}`);
      return hit ? { slug: p.slug, city, ...hit } : null;
    }),
  );
  return rows.filter((r): r is Featured => Boolean(r));
}

/** A plan from the store, or a recorded featured plan when the store doesn't have it. */
export async function loadPlan(id: string): Promise<SeasonPlan | null> {
  return (await kvGet<SeasonPlan>(`plan:${id}`)) ?? (await allRecorded()).find((r) => r.plan.id === id)?.plan ?? null;
}

/** A run's event log from the store, or a recorded featured run's. */
export async function loadRun(id: string): Promise<AgentEvent[] | null> {
  return (await kvGet<AgentEvent[]>(`run:${id}`)) ?? (await allRecorded()).find((r) => r.plan.id === id)?.events ?? null;
}
