import { runBaseline } from "@/lib/agent/baseline";
import type { TeamConfig } from "@/lib/types";
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
    return Response.json(await runBaseline(parsed.data as TeamConfig));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
