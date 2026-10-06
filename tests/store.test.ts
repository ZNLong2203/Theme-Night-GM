import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createStore, type Backend } from "@/lib/store";

/** A tiny Redis stand-in: GET/SET/SCAN/UNLINK, with an optional memory cap that answers OOM like Redis. */
function fakeRedis(opts: { maxKeys?: number; fail?: boolean; hang?: boolean } = {}) {
  const data = new Map<string, string>();
  const calls: string[] = [];
  const backend: Backend = {
    async command(args) {
      const [cmd, ...rest] = args.map(String);
      calls.push(`${cmd} ${rest[0] ?? ""}`.trim());
      if (opts.hang) return new Promise(() => {});
      if (opts.fail) throw new Error("connect ECONNREFUSED");
      if (cmd === "GET") return data.get(rest[0]) ?? null;
      if (cmd === "SET") {
        if (opts.maxKeys !== undefined && !data.has(rest[0]) && data.size >= opts.maxKeys) {
          throw new Error("OOM command not allowed when used memory > 'maxmemory'.");
        }
        data.set(rest[0], rest[1]);
        return "OK";
      }
      if (cmd === "SCAN") {
        const pattern = new RegExp(`^${rest[2].replace("*", ".*")}$`);
        return ["0", [...data.keys()].filter((k) => pattern.test(k))];
      }
      if (cmd === "UNLINK") {
        rest.forEach((k) => data.delete(k));
        return rest.length;
      }
      throw new Error(`unexpected ${cmd}`);
    },
  };
  return { backend, data, calls };
}

const plan = { id: "p1", nights: [{ title: "Sandlot Night", score: 74 }] };

describe("createStore", () => {
  it("round-trips values compressed", async () => {
    const redis = fakeRedis();
    const store = createStore(redis.backend);
    expect(await store.kvSet("plan:p1", plan, 60)).toBe(true);
    expect(redis.data.get("plan:p1")).toMatch(/^br:/);
    expect(await store.kvGet("plan:p1")).toEqual(plan);
    expect(await store.kvGet("plan:missing")).toBeNull();
  });

  it("still reads values written gzipped or as plain JSON", async () => {
    const redis = fakeRedis();
    redis.data.set("old:gz", `gz:${gzipSync(JSON.stringify(plan)).toString("base64")}`);
    redis.data.set("old:json", JSON.stringify(plan));
    const store = createStore(redis.backend);
    expect(await store.kvGet("old:gz")).toEqual(plan);
    expect(await store.kvGet("old:json")).toEqual(plan);
  });

  it("frees the Qloo cache first when Redis is full, and never purges plans", async () => {
    const redis = fakeRedis({ maxKeys: 3 });
    redis.data.set("qloo:v1:a", "x");
    redis.data.set("qloo:v1:b", "x");
    redis.data.set("plan:old", "x");
    const store = createStore(redis.backend);

    expect(await store.kvSet("plan:p1", plan, 60)).toBe(true);
    expect([...redis.data.keys()].sort()).toEqual(["plan:old", "plan:p1"]);
    expect(redis.calls).toContain("SCAN 0");
  });

  it("frees old run logs next if the cache wasn't enough", async () => {
    const redis = fakeRedis({ maxKeys: 2 });
    redis.data.set("run:old", "x");
    redis.data.set("plan:old", "x");
    const store = createStore(redis.backend);

    expect(await store.kvSet("plan:p1", plan, 60)).toBe(true);
    expect([...redis.data.keys()].sort()).toEqual(["plan:old", "plan:p1"]);
  });

  it("keeps a plan in memory when Redis is full of plans, so its link still works here", async () => {
    const redis = fakeRedis({ maxKeys: 1 });
    redis.data.set("plan:old", "x");
    const store = createStore(redis.backend);
    expect(await store.kvSet("plan:p1", plan, 60)).toBe(true);
    expect(redis.data.has("plan:p1")).toBe(false);
    expect(await store.kvGet("plan:p1")).toEqual(plan);
  });

  it("drops a cache write on a full Redis instead of retrying it", async () => {
    const redis = fakeRedis({ maxKeys: 1 });
    redis.data.set("plan:old", "x");
    const store = createStore(redis.backend);
    expect(await store.kvSet("qloo:v1:c", { big: true }, 60)).toBe(false);
    expect(redis.data.has("qloo:v1:c")).toBe(false);
  });

  it("trips a breaker on failure: memory serves, and Redis isn't retried until it cools down", async () => {
    const redis = fakeRedis({ fail: true });
    const store = createStore(redis.backend, { breakerMs: 60_000 });
    expect(await store.kvSet("plan:p1", plan, 60)).toBe(true);
    expect(store.healthy()).toBe(false);
    const before = redis.calls.length;
    expect(await store.kvGet("plan:p1")).toEqual(plan);
    expect(await store.kvGet("plan:p2")).toBeNull();
    expect(redis.calls.length).toBe(before);
  });

  it("gives up on a hanging Redis within the timeout", async () => {
    const store = createStore(fakeRedis({ hang: true }).backend);
    const started = Date.now();
    expect(await store.kvGet("plan:p1")).toBeNull();
    expect(Date.now() - started).toBeLessThan(3_500);
    expect(store.healthy()).toBe(false);
  });

  it("works with no Redis at all", async () => {
    const store = createStore(null);
    expect(await store.kvSet("plan:p1", plan, 60)).toBe(true);
    expect(await store.kvGet("plan:p1")).toEqual(plan);
    expect(await store.kvSet("qloo:v1:a", {}, 60)).toBe(false);
    expect(store.healthy()).toBe(true);
  });
});
