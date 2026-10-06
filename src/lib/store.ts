import "server-only";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { createClient } from "redis";

/**
 * Tiny key-value store with three backends, picked from the environment:
 *   - Upstash over its REST API: KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + _TOKEN)
 *   - any Redis over TCP: REDIS_URL (what the Vercel Marketplace "Redis" integration sets)
 *   - otherwise an in-memory map, so the app always works and shared links last as long as the instance.
 * Remote values are gzipped: plans and run logs are number-heavy JSON that shrinks 5–10×, which keeps a
 * whole demo season inside a 30 MB free tier.
 */
const REST_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_URL = process.env.REDIS_URL;
const TIMEOUT_MS = 5_000;

export const storeKind = (): "redis" | "memory" => ((REST_URL && REST_TOKEN) || REDIS_URL ? "redis" : "memory");

const newClient = () =>
  createClient({
    url: REDIS_URL,
    socket: { connectTimeout: TIMEOUT_MS, reconnectStrategy: (retries) => (retries > 3 ? false : 200 * retries) },
  });
type RedisClient = ReturnType<typeof newClient>;

// Pages and route handlers are bundled separately, so module-level state would not be shared between
// them; hang the fallback store and the TCP connection off globalThis so one server process has one of each.
const globalStore = globalThis as typeof globalThis & {
  __tngmStore?: Map<string, { value: string; expires: number }>;
  __tngmRedis?: Promise<RedisClient>;
};
const memory = (globalStore.__tngmStore ??= new Map());

const zip = promisify(gzip);
const unzip = promisify(gunzip);
const encode = async (value: unknown) => `gz:${(await zip(JSON.stringify(value))).toString("base64")}`;
const decode = async <T>(raw: string): Promise<T> =>
  JSON.parse(raw.startsWith("gz:") ? (await unzip(Buffer.from(raw.slice(3), "base64"))).toString() : raw) as T;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS))]);
}

async function rest(command: (string | number)[]): Promise<unknown> {
  const response = await fetch(REST_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Redis ${command[0]} failed: ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(`Redis ${command[0]} failed: ${body.error}`);
  return body.result;
}

/** One connection per warm instance; a failed or closed connection is dropped so the next call reconnects. */
function tcp(): Promise<RedisClient> {
  let pending = globalStore.__tngmRedis;
  if (!pending) {
    pending = newClient()
      .on("error", (error: Error) => console.error("[redis]", error.message))
      .connect()
      .catch((error) => {
        globalStore.__tngmRedis = undefined;
        throw error;
      });
    globalStore.__tngmRedis = pending;
  }
  return pending;
}

async function tcpCommand<T>(run: (client: RedisClient) => Promise<T>, label: string): Promise<T> {
  const client = await withTimeout(tcp(), "Redis connect");
  try {
    return await withTimeout(run(client), label);
  } catch (error) {
    if (!client.isOpen) globalStore.__tngmRedis = undefined;
    throw error;
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    if (REST_URL && REST_TOKEN) {
      const raw = (await rest(["GET", key])) as string | null;
      return raw ? await decode<T>(raw) : null;
    }
    if (REDIS_URL) {
      const raw = await tcpCommand((client) => client.get(key), "Redis GET");
      return typeof raw === "string" ? await decode<T>(raw) : null;
    }
    const hit = memory.get(key);
    if (!hit || hit.expires < Date.now()) return null;
    return JSON.parse(hit.value) as T;
  } catch {
    return null; // a cache/store outage must never break a run
  }
}

export async function kvSet(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  try {
    if (REST_URL && REST_TOKEN) {
      await rest(["SET", key, await encode(value), "EX", ttlSeconds]);
      return true;
    }
    if (REDIS_URL) {
      const raw = await encode(value);
      await tcpCommand((client) => client.set(key, raw, { expiration: { type: "EX", value: ttlSeconds } }), "Redis SET");
      return true;
    }
    memory.set(key, { value: JSON.stringify(value), expires: Date.now() + ttlSeconds * 1000 });
    if (memory.size > 500) memory.delete(memory.keys().next().value as string);
    return true;
  } catch (error) {
    console.error("[store]", (error as Error).message);
    return false;
  }
}

export const DAY = 86_400;
