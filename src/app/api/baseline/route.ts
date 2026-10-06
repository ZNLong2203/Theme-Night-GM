import { runBaseline } from "@/lib/agent/baseline";
import { DAY, kvGet, kvSet } from "@/lib/store";
import type { SeasonPlan, TeamConfig } from "@/lib/types";
import { checkRate, clientKey, tooMany } from "@/lib/rate-limit";
import { TeamSchema } from "@/lib/validation";

export const maxDuration = 120;

export async function POST(request: Request) {
  const parsed = TeamSchema.safeParse(await request.json().catch(() => null));
  const targets = parsed.success ? parsed.data.dates.filter((d) => d.target) : [];
  if (!parsed.success || !targets.length || targets.length > 8) {
    return Response.json({ error: "Send the same team config used for the plan (1–8 target dates)." }, { status: 400 });
  }
  const rate = checkRate(`baseline:${clientKey(request)}`, Number(process.env.RUNS_PER_10_MIN ?? 6));
  if (!rate.ok) return tooMany("You've hit the demo limit for control runs. Try again in a few minutes.", rate.retryAfter);
  try {
    const result = await runBaseline(parsed.data as TeamConfig);
    // Attach the control result to the stored plan so shared links show the comparison too.
    const planId = new URL(request.url).searchParams.get("planId");
    if (planId && /^[0-9a-f-]{36}$/.test(planId)) {
      const plan = await kvGet<SeasonPlan>(`plan:${planId}`);
      if (plan && plan.team.venue.city === parsed.data.venue.city) await kvSet(`plan:${planId}`, { ...plan, baseline: result }, 90 * DAY);
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
