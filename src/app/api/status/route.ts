import { runMode } from "@/lib/agent/run";

export function GET() {
  return Response.json(runMode());
}
