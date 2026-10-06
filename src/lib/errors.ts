import { QlooError } from "@/lib/qloo/client";

/**
 * What an anonymous visitor may see about a failure. Upstream errors can carry quota details,
 * project names or raw response bodies, so those stay in the server log.
 */
export function publicError(error: unknown, fallback: string): string {
  console.error("[run]", error);
  if (error instanceof QlooError) return error.status === 499 ? "Run stopped." : `Qloo request failed (${error.status}).`;
  return fallback;
}
