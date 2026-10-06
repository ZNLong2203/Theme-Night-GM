import { runAgent } from "@/lib/agent/run";
import type { AgentEvent, TeamConfig } from "@/lib/types";
import { admit, readJson } from "@/lib/rate-limit";
import { TeamSchema } from "@/lib/validation";

const RUNS_PER_CLIENT = Number(process.env.RUNS_PER_10_MIN ?? 6);
const MAX_CONCURRENT_RUNS = Number(process.env.MAX_CONCURRENT_RUNS ?? 4);
/** A full 120-date schedule is ~20 KB. */
const MAX_BODY_BYTES = 64_000;

export const maxDuration = 300;

export async function POST(request: Request) {
  const read = await readJson(request, MAX_BODY_BYTES);
  if ("response" in read) return read.response;
  const parsed = TeamSchema.safeParse(read.body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const team = parsed.data as TeamConfig;
  if (team.dates.filter((d) => d.target).length > 8) {
    return Response.json({ error: ["Plan at most 8 theme nights per run."] }, { status: 400 });
  }

  const admission = admit(request, {
    scope: "agent",
    perClient: RUNS_PER_CLIENT,
    maxConcurrent: MAX_CONCURRENT_RUNS,
    busy: "The GM is busy with other teams right now. Try again in a minute.",
    limited: "You've hit the demo limit for agent runs. Try again in a few minutes.",
  });
  if ("response" in admission) return admission.response;
  const { release } = admission;

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
      // Keep proxies from closing an idle connection while the model thinks.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 10_000);
      try {
        await runAgent(team, send, request.signal);
      } finally {
        clearInterval(heartbeat);
        release();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
