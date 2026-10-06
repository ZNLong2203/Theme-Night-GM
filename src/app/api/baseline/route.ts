import { runBaseline } from "@/lib/agent/baseline";
import { publicError } from "@/lib/errors";
import { DAY, kvGet, kvSet } from "@/lib/store";
import type { SeasonPlan, TeamConfig } from "@/lib/types";
import { admit, readJson } from "@/lib/rate-limit";
import { TeamSchema } from "@/lib/validation";

export const maxDuration = 120;

export async function POST(request: Request) {
  const read = await readJson(request, 64_000);
  if ("response" in read) return read.response;
  const parsed = TeamSchema.safeParse(read.body);
  const targets = parsed.success ? parsed.data.dates.filter((d) => d.target) : [];
  if (!parsed.success || !targets.length || targets.length > 8) {
    return Response.json({ error: ["Send the same team config used for the plan (1–8 target dates)."] }, { status: 400 });
  }
  // Control runs share the agent's slots: they hit the same Qloo key and Gemini quota.
  const admission = admit(request, {
    scope: "baseline",
    perClient: Number(process.env.RUNS_PER_10_MIN ?? 6),
    maxConcurrent: Number(process.env.MAX_CONCURRENT_RUNS ?? 4),
    busy: "The GM is busy with other teams right now. Try the control again in a minute.",
    limited: "You've hit the demo limit for control runs. Try again in a few minutes.",
  });
  if ("response" in admission) return admission.response;
  try {
    const result = await runBaseline(parsed.data as TeamConfig, request.signal);
    // Attach the control result to the stored plan so shared links show the comparison too. First write
    // wins: a later run (from anyone holding the link) can't replace the comparison readers already saw.
    const planId = new URL(request.url).searchParams.get("planId");
    if (planId && /^[0-9a-f-]{36}$/.test(planId)) {
      const plan = await kvGet<SeasonPlan>(`plan:${planId}`);
      if (plan && !plan.baseline && plan.team.venue.city === parsed.data.venue.city) await kvSet(`plan:${planId}`, { ...plan, baseline: result }, 90 * DAY);
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: [publicError(error, "The control run failed. Try again in a minute.")] }, { status: 502 });
  } finally {
    admission.release();
  }
}
