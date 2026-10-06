import "server-only";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants, gunzip } from "node:zlib";
import { createClient } from "redis";

/**
 * Tiny key-value store with three backends, picked from the environment:
 *   - Upstash over its REST API: KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + _TOKEN)
 *   - any Redis over TCP: REDIS_URL (what the Vercel Marketplace "Redis" integration sets)
 *   - otherwise an in-memory map, so the app always works and shared links last as long as the instance.
 *
 * The store must never be the reason a request fails or slows down:
 *   - a failing or slow Redis trips a breaker, and for the next 30 s every call skips it at once;
 *   - a full Redis (OOM) first drops the disposable Qloo response cache, then old run logs, and retries;
 *   - whatever Redis can't take is kept in this instance's memory instead.
 * Values are brotli-compressed (a 647 KB run log is stored as ~85 KB) so a 30 MB free tier goes far.
 */
const REST_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_URL = process.env.REDIS_URL;
const TIMEOUT_MS = 2_500;
const BREAKER_MS = 30_000;
const MEMORY_MAX_ENTRIES = 200;
/** Freed in this order when Redis is full; plans and featured pointers are never purged. */
export const PURGE_ORDER = ["qloo:*", "run:*"];

export const storeKind = (): "redis" | "memory" => ((REST_URL && REST_TOKEN) || REDIS_URL ? "redis" : "memory");

/** A Redis connection reduced to "send this command". */
export interface Backend {
  command(args: (string | number)[]): Promise<unknown>;
  /** Drop a broken connection so the next command reconnects. */
  reset?(): void;
}

const zip = promisify(brotliCompress);
const unzipBr = promisify(brotliDecompress);
const unzipGz = promisify(gunzip);
const encode = async (value: unknown) =>
  `br:${(await zip(JSON.stringify(value), { params: { [constants.BROTLI_PARAM_QUALITY]: 7 } })).toString("base64")}`;
async function decode<T>(raw: string): Promise<T> {
  // Older values were gzipped ("gz:") or plain JSON; both still read back.
  const body = raw.startsWith("br:")
    ? (await unzipBr(Buffer.from(raw.slice(3), "base64"))).toString()
    : raw.startsWith("gz:")
      ? (await unzipGz(Buffer.from(raw.slice(3), "base64"))).toString()
      : raw;
  return JSON.parse(body) as T;
}

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const isOutOfMemory = (error: unknown) => /\bOOM\b|maxmemory/i.test((error as Error)?.message ?? "");

/** The store logic, independent of the backend so tests can drive it with a fake Redis. */
export function createStore(backend: Backend | null, options: { breakerMs?: number } = {}) {
  const breakerMs = options.breakerMs ?? BREAKER_MS;
  const memory = new Map<string, { value: string; expires: number }>();
  let downUntil = 0;
  let purging: Promise<void> | null = null;

  const available = () => backend !== null && Date.now() >= downUntil;
  function trip(error: unknown) {
    downUntil = Date.now() + breakerMs;
    backend?.reset?.();
    console.error("[store] Redis unavailable, using memory for 30 s:", (error as Error)?.message);
  }

  function remember(key: string, value: unknown, ttlSeconds: number) {
    memory.delete(key);
    memory.set(key, { value: JSON.stringify(value), expires: Date.now() + ttlSeconds * 1000 });
    while (memory.size > MEMORY_MAX_ENTRIES) memory.delete(memory.keys().next().value as string);
  }
  function recall<T>(key: string): T | null {
    const hit = memory.get(key);
    if (!hit || hit.expires < Date.now()) return null;
    return JSON.parse(hit.value) as T;
  }

  /** Delete every key matching `pattern` (SCAN + UNLINK, never KEYS). */
  async function purge(pattern: string) {
    let cursor = "0";
    let removed = 0;
    do {
      const [next, keys] = (await withTimeout(backend!.command(["SCAN", cursor, "MATCH", pattern, "COUNT", 500]), "Redis SCAN")) as [string, string[]];
      cursor = String(next);
      if (keys.length) removed += Number(await withTimeout(backend!.command(["UNLINK", ...keys]), "Redis UNLINK"));
    } while (cursor !== "0");
    console.warn(`[store] Redis was full: removed ${removed} ${pattern} keys`);
  }

  async function set(key: string, raw: string, ttlSeconds: number) {
    await withTimeout(backend!.command(["SET", key, raw, "EX", ttlSeconds]), "Redis SET");
  }

  async function kvGet<T>(key: string): Promise<T | null> {
    if (available()) {
      try {
        const raw = await withTimeout(backend!.command(["GET", key]), "Redis GET");
        if (typeof raw === "string") return await decode<T>(raw);
      } catch (error) {
        trip(error);
      }
    }
    return recall<T>(key);
  }

  /** True when the value was stored somewhere (Redis, or this instance's memory as a fallback). */
  async function kvSet(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    const disposable = key.startsWith("qloo:");
    if (available()) {
      const raw = await encode(value);
      try {
        await set(key, raw, ttlSeconds);
        return true;
      } catch (error) {
        if (!isOutOfMemory(error)) trip(error);
        else {
          // Full: free space tier by tier (one purge at a time per instance), retrying after each.
          // A failing cache write still triggers the first purge, but is never retried itself.
          for (const pattern of disposable ? PURGE_ORDER.slice(0, 1) : PURGE_ORDER) {
            try {
              purging ??= purge(pattern).finally(() => (purging = null));
              await purging;
              if (disposable) return false;
              await set(key, raw, ttlSeconds);
              return true;
            } catch (retryError) {
              if (!isOutOfMemory(retryError)) {
                trip(retryError);
                break;
              }
            }
          }
        }
      }
    }
    if (disposable) return false; // the Qloo client keeps its own in-memory cache
    remember(key, value, ttlSeconds);
    return true;
  }

  return { kvGet, kvSet, healthy: () => backend === null || Date.now() >= downUntil };
}

function restBackend(): Backend {
  return {
    async command(args) {
      const response = await fetch(REST_URL!, {
        method: "POST",
        headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => ({}))) as { result?: unknown; error?: string };
      if (!response.ok || body.error) throw new Error(`Redis ${args[0]} failed: ${body.error ?? response.status}`);
      return body.result;
    },
  };
}

// Route handlers and pages are bundled separately; one TCP connection per server process lives on globalThis.
const globalStore = globalThis as typeof globalThis & { __tngmRedis?: Promise<ReturnType<typeof newClient>> };

const newClient = () =>
  createClient({
    url: REDIS_URL,
    socket: { connectTimeout: TIMEOUT_MS, reconnectStrategy: false },
    disableOfflineQueue: true,
  });

function tcpBackend(): Backend {
  const forget = () => {
    const pending = globalStore.__tngmRedis;
    globalStore.__tngmRedis = undefined;
    pending?.then((client) => client.isOpen && client.destroy()).catch(() => undefined);
  };
  const connect = () => {
    let pending = globalStore.__tngmRedis;
    if (!pending) {
      pending = newClient()
        .on("error", (error: Error) => console.error("[redis]", error.message))
        // A dropped socket (idle timeout, frozen instance) just means "connect again next time".
        .on("end", () => {
          if (globalStore.__tngmRedis === pending) globalStore.__tngmRedis = undefined;
        })
        .connect()
        .catch((error) => {
          globalStore.__tngmRedis = undefined;
          throw error;
        });
      globalStore.__tngmRedis = pending;
    }
    return pending;
  };
  return {
    async command(args) {
      let client = await connect();
      if (!client.isReady) {
        forget();
        client = await connect();
      }
      return client.sendCommand(args.map(String));
    },
    reset: forget,
  };
}

// One store per server process (pages and route handlers are bundled separately).
const globalStores = globalThis as typeof globalThis & { __tngmKv?: ReturnType<typeof createStore> };
const store = (globalStores.__tngmKv ??= createStore(REST_URL && REST_TOKEN ? restBackend() : REDIS_URL ? tcpBackend() : null));

export const kvGet = store.kvGet;
export const kvSet = store.kvSet;
/** False while the breaker is open (Redis failing); the app keeps working on memory. */
export const storeHealthy = store.healthy;

export const DAY = 86_400;
