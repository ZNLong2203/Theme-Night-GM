import "server-only";

/**
 * Tiny key-value store. Uses Upstash Redis over its REST API when configured (free tier is plenty:
 * a run costs ~250 commands), otherwise an in-memory map — so the app always works, and shared links
 * simply last only as long as the server instance when no Redis is attached.
 *
 * Env (either naming works; the Vercel Marketplace integration sets the KV_* pair):
 *   KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 */
const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeKind = (): "redis" | "memory" => (URL_ && TOKEN ? "redis" : "memory");

// Pages and route handlers are bundled separately, so a module-level Map would not be shared between
// them; hang the fallback store off globalThis so one server process has one store.
const globalStore = globalThis as typeof globalThis & { __tngmStore?: Map<string, { value: string; expires: number }> };
const memory = (globalStore.__tngmStore ??= new Map());

async function redis(command: (string | number)[]): Promise<unknown> {
  const response = await fetch(URL_!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Redis ${command[0]} failed: ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(`Redis ${command[0]} failed: ${body.error}`);
  return body.result;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    if (storeKind() === "redis") {
      const raw = (await redis(["GET", key])) as string | null;
      return raw ? (JSON.parse(raw) as T) : null;
    }
    const hit = memory.get(key);
    if (!hit || hit.expires < Date.now()) return null;
    return JSON.parse(hit.value) as T;
  } catch {
    return null; // a cache/store outage must never break a run
  }
}

export async function kvSet(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const raw = JSON.stringify(value);
  try {
    if (storeKind() === "redis") {
      await redis(["SET", key, raw, "EX", ttlSeconds]);
      return true;
    }
    memory.set(key, { value: raw, expires: Date.now() + ttlSeconds * 1000 });
    if (memory.size > 500) memory.delete(memory.keys().next().value as string);
    return true;
  } catch {
    return false;
  }
}

export const DAY = 86_400;
