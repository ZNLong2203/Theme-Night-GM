import { runMode } from "@/lib/agent/run";
import { storeHealthy } from "@/lib/store";

export function GET() {
  // storeHealthy is false while Redis is failing and the app is running on memory.
  return Response.json({ ...runMode(), storeHealthy: storeHealthy() });
}
