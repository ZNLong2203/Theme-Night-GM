import { runAgent } from "@/lib/agent/run";
import type { AgentEvent, TeamConfig } from "@/lib/types";
import { TeamSchema } from "@/lib/validation";

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = TeamSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const team = parsed.data as TeamConfig;
  if (team.dates.filter((d) => d.target).length > 8) {
    return Response.json({ error: ["Plan at most 8 theme nights per run."] }, { status: 400 });
  }

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
