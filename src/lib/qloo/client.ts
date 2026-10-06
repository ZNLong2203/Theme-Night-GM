import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { kvGet, kvSet, storeKind } from "@/lib/store";
import type { QlooRequestLog } from "@/lib/types";
import { mockQloo } from "./mock";

/** Shared cache across instances (Redis) for live responses; the kit asks us to cache only what we need. */
const SHARED_CACHE_TTL_S = 24 * 60 * 60;
const sharedKey = (key: string) => `qloo:v1:${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;

const BASE_URL = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
// Live calls take 1–6 s each, so we overlap up to 10 while starting at most ~5 per second
// (the rate other hackathon teams report as safe).
const MAX_CONCURRENT = 10;
const MIN_INTERVAL_MS = 200;
/** /v2/insights rejects take > 50 with a 400 (verified live); clamp centrally so no workflow trips it. */
const MAX_TAKE = 50;

export const qlooIsLive = () => Boolean(process.env.QLOO_API_KEY);

export class QlooError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined>;

/** The agent tool call currently executing, so each Qloo request can be attributed to it. */
export const toolCallScope = new AsyncLocalStorage<string>();

/** Collects every request made during one agent run so the UI can show receipts. */
export class QlooRecorder {
  private seq = 0;
  readonly logs: QlooRequestLog[] = [];
  constructor(private readonly onLog?: (log: QlooRequestLog) => void) {}

  nextId() {
    this.seq += 1;
    return `Q${this.seq}`;
  }

  push(log: QlooRequestLog) {
    log.callId ??= toolCallScope.getStore();
    this.logs.push(log);
    this.onLog?.(log);
  }
}

// ---- module-level cache + limiter (shared across requests on a warm instance) ----

const cache = new Map<string, { at: number; body: unknown }>();
let active = 0;
let lastStart = 0;
const waiters: (() => void)[] = [];

async function acquire() {
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  const wait = lastStart + MIN_INTERVAL_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + MIN_INTERVAL_MS);
  if (wait > 0) await sleep(wait);
}

function release() {
  active -= 1;
  waiters.shift()?.();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalize(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    let value = params[key];
    if (value === undefined || value === "") continue;
    if (key === "take") value = Math.max(1, Math.min(MAX_TAKE, Number(value) || 1));
    out[key] = String(value);
  }
  return out;
}

export function countResults(body: unknown): number {
  const b = body as { results?: unknown };
  const r = b?.results;
  if (Array.isArray(r)) return r.length;
  if (r && typeof r === "object") {
    for (const value of Object.values(r as Record<string, unknown>)) {
      if (Array.isArray(value)) return value.length;
    }
  }
  return 0;
}

/**
 * GET a Qloo endpoint. Every call is logged to the recorder with a stable id so the agent can
 * cite it as evidence and the UI can show exactly which request backed which claim.
 */
export async function qlooGet<T = unknown>(
  path: string,
  params: Params,
  recorder: QlooRecorder,
  purpose: string,
): Promise<{ body: T; requestId: string }> {
  const query = normalize(params);
  const key = `${path}?${new URLSearchParams(query).toString()}`;
  const requestId = recorder.nextId();
  const started = Date.now();
  const live = qlooIsLive();

  let hit = cache.get(key);
  if (!(hit && Date.now() - hit.at < CACHE_TTL_MS) && live && storeKind() === "redis") {
    const shared = await kvGet<unknown>(sharedKey(key));
    if (shared !== null) {
      hit = { at: Date.now(), body: shared };
      cache.set(key, hit);
    }
  }
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    recorder.push({
      id: requestId,
      endpoint: path,
      params: query,
      status: 200,
      ms: 0,
      resultCount: countResults(hit.body),
      cached: true,
      simulated: !live,
      purpose,
    });
    return { body: hit.body as T, requestId };
  }

  let body: unknown;
  let status = 200;
  try {
    body = live ? await fetchWithRetry(key) : await mockQloo(path, query);
  } catch (error) {
    status = error instanceof QlooError ? error.status : 500;
    recorder.push({
      id: requestId,
      endpoint: path,
      params: query,
      status,
      ms: Date.now() - started,
      resultCount: 0,
      cached: false,
      simulated: !live,
      purpose,
    });
    throw error;
  }

  cache.set(key, { at: Date.now(), body });
  if (live && storeKind() === "redis") void kvSet(sharedKey(key), body, SHARED_CACHE_TTL_S);
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  recorder.push({
    id: requestId,
    endpoint: path,
    params: query,
    status,
    ms: Date.now() - started,
    resultCount: countResults(body),
    cached: false,
    simulated: !live,
    purpose,
  });
  return { body: body as T, requestId };
}

async function fetchWithRetry(pathAndQuery: string): Promise<unknown> {
  let attempt = 0;
  for (;;) {
    await acquire();
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${pathAndQuery}`, {
        headers: { "X-Api-Key": process.env.QLOO_API_KEY ?? "", Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      release();
      if (attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw new QlooError(`Qloo request failed: ${(error as Error).message}`, 504, true);
    }
    release();

    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      attempt += 1;
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      continue;
    }
    const text = await response.text().catch(() => "");
    throw new QlooError(
      `Qloo ${response.status} on ${pathAndQuery.split("?")[0]}: ${text.slice(0, 200)}`,
      response.status,
      retryable,
    );
  }
}
