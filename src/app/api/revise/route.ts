import { z } from "zod";
import { runRevision } from "@/lib/agent/revise";
import { checkRate, clientKey, tooMany } from "@/lib/rate-limit";
import { kvGet } from "@/lib/store";
import type { AgentEvent, SeasonPlan } from "@/lib/types";
import { TeamSchema } from "@/lib/validation";

export const maxDuration = 300;

const MAX_BODY_BYTES = 2_000_000;

const RevisionRequest = z.object({
  message: z.string().trim().min(3).max(500),
  plan: z
    .object({
      id: z.string().uuid(),
      team: TeamSchema,
      nights: z.array(z.object({ date: z.string(), anchor: z.object({ id: z.string(), name: z.string() }) }).passthrough()).min(1).max(8),
      profiles: z.array(z.any()).max(20),
      requests: z.array(z.object({ id: z.string() }).passthrough()).max(2000),
      marketSummary: z.string().max(2000),
    })
    .passthrough(),
});

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: ["Plan too large to revise."] }, { status: 413 });
  }
  const parsed = RevisionRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const rate = checkRate(`revise:${clientKey(request)}`, Number(process.env.REVISIONS_PER_10_MIN ?? 12));
  if (!rate.ok) return tooMany("You've hit the demo limit for revisions. Try again in a few minutes.", rate.retryAfter);

  // Trust the stored plan over the client's copy; only a stored plan may be overwritten by a revision.
  const stored = await kvGet<SeasonPlan>(`plan:${parsed.data.plan.id}`);
  const plan = stored ?? (parsed.data.plan as unknown as SeasonPlan);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // client went away
        }
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 10_000);
      try {
        await runRevision(plan, parsed.data.message, send, request.signal, { persist: Boolean(stored) });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
