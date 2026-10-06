import { featuredPlans } from "@/lib/featured";

export async function GET() {
  return Response.json(await featuredPlans());
}
