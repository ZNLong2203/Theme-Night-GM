import { loadPlan } from "@/lib/featured";

const ID = /^[0-9a-f-]{36}$/;

export async function GET(_request: Request, ctx: RouteContext<"/api/plans/[id]">) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "Invalid plan id" }, { status: 400 });
  const plan = await loadPlan(id);
  return plan ? Response.json(plan) : Response.json({ error: "Plan not found or expired" }, { status: 404 });
}
