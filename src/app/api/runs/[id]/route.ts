import { kvGet } from "@/lib/store";
import type { AgentEvent } from "@/lib/types";

const ID = /^[0-9a-f-]{36}$/;

/** The recorded event stream of a finished run, for replay in the studio. */
export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "Invalid run id" }, { status: 400 });
  const events = await kvGet<AgentEvent[]>(`run:${id}`);
  return events ? Response.json(events) : Response.json({ error: "Run not found or expired" }, { status: 404 });
}
