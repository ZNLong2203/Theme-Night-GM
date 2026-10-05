import { runBaseline } from "@/lib/agent/baseline";
import type { TeamConfig } from "@/lib/types";
import { TeamSchema } from "@/lib/validation";

export const maxDuration = 120;

export async function POST(request: Request) {
  const parsed = TeamSchema.safeParse(await request.json().catch(() => null));
  const targets = parsed.success ? parsed.data.dates.filter((d) => d.target) : [];
  if (!parsed.success || !targets.length || targets.length > 8) {
    return Response.json({ error: "Send the same team config used for the plan (1–8 target dates)." }, { status: 400 });
  }
  try {
    return Response.json(await runBaseline(parsed.data as TeamConfig));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
