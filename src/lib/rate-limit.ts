import "server-only";

/**
 * Small in-memory guard for the public demo: each run spends Qloo quota and Gemini tokens, so we cap
 * runs per client and concurrent runs per instance. Per-instance memory is enough to stop accidental
 * hammering; it is not a distributed limiter.
 */
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();
let active = 0;

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

export function checkRate(key: string, limit: number): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return { ok: true };
}

/** Reserve one of `max` concurrent run slots; returns a release function, or null if full. */
export function acquireSlot(max: number): (() => void) | null {
  if (active >= max) return null;
  active += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      active -= 1;
    }
  };
}

export const tooMany = (message: string, retryAfter = 60) =>
  Response.json({ error: [message] }, { status: 429, headers: { "Retry-After": String(retryAfter) } });

/**
 * Reserve a concurrency slot, then charge the client's rate quota. In that order, a "busy" answer
 * doesn't use up a visitor's quota. Returns the slot's release function or the 429 to send.
 */
export function admit(
  request: Request,
  opts: { scope: string; perClient: number; maxConcurrent: number; busy: string; limited: string },
): { release: () => void } | { response: Response } {
  const release = acquireSlot(opts.maxConcurrent);
  if (!release) return { response: tooMany(opts.busy) };
  const rate = checkRate(`${opts.scope}:${clientKey(request)}`, opts.perClient);
  if (!rate.ok) {
    release();
    return { response: tooMany(opts.limited, rate.retryAfter) };
  }
  return { release };
}

/** Parse a JSON body, refusing anything over `maxBytes` (route handlers have no size limit of their own). */
export async function readJson(request: Request, maxBytes: number): Promise<{ body: unknown } | { response: Response }> {
  const tooLarge = () => ({ response: Response.json({ error: ["Request body too large."] }, { status: 413 }) });
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return tooLarge();
  const text = await request.text().catch(() => "");
  if (text.length > maxBytes) return tooLarge();
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: null };
  }
}
