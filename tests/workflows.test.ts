import { beforeAll, describe, expect, it } from "vitest";
import { QlooRecorder, qlooGet } from "@/lib/qloo/client";
import { findSponsors, km, nearVenueIndex, scanMarket, scoreCandidates, summarizeTrend, supportsTrending, TasteContext, toCard } from "@/lib/qloo/workflows";

const VENUE = { name: "Downtown ballpark, Durham", city: "Durham, North Carolina", lat: 35.9916, lon: -78.9045 };

/** Weekly points, one per value, starting in June 2025. */
const series = (values: number[]) =>
  values.map((percentile, i) => ({ date: new Date(Date.UTC(2025, 5, 1 + 7 * i)).toISOString().slice(0, 10), percentile }));

describe("summarizeTrend", () => {
  const window = { start: "2025-06-08", end: "2025-09-28" };

  it("returns unknown with no change when there are fewer than three points", () => {
    const points = series([40, 60]);
    expect(summarizeTrend(points, window)).toEqual({ points, direction: "unknown", changePct: 0, window });
    expect(summarizeTrend([]).window).toBeUndefined();
  });

  it("compares the last third of the window with the first third", () => {
    expect(summarizeTrend(series([50, 50, 55, 55, 60, 60]))).toMatchObject({ direction: "rising", changePct: 20 });
    expect(summarizeTrend(series([50, 50, 45, 45, 40, 40]))).toMatchObject({ direction: "cooling", changePct: -20 });
    expect(summarizeTrend(series([50, 50, 51, 51, 52, 52]))).toMatchObject({ direction: "steady", changePct: 4 });
  });

  it("needs more than a 6% move to call a direction", () => {
    expect(summarizeTrend(series([100, 100, 103, 103, 106.1, 106.1]))).toMatchObject({ direction: "rising", changePct: 6.1 });
    expect(summarizeTrend(series([100, 100, 103, 103, 105.9, 105.9])).direction).toBe("steady");
    expect(summarizeTrend(series([100, 100, 97, 97, 94, 94])).direction).toBe("steady");
    expect(summarizeTrend(series([100, 100, 97, 97, 93.9, 93.9]))).toMatchObject({ direction: "cooling", changePct: -6.1 });
  });

  it("sorts points by date before measuring", () => {
    const trend = summarizeTrend(series([50, 50, 55, 55, 60, 60]).reverse());
    expect(trend.points.map((p) => p.date)).toEqual(series([0, 0, 0, 0, 0, 0]).map((p) => p.date));
    expect(trend.direction).toBe("rising");
  });

  it("caps the change at +300% and treats a zero baseline as no change", () => {
    expect(summarizeTrend(series([10, 10, 30, 30, 50, 50])).changePct).toBe(300);
    expect(summarizeTrend(series([0, 0, 5, 5, 10, 10]))).toMatchObject({ direction: "steady", changePct: 0 });
  });

  it("passes the trending window through", () => {
    expect(summarizeTrend(series([50, 50, 55, 55, 60, 60]), window).window).toEqual(window);
  });
});

describe("km", () => {
  it("is zero for the same point and symmetric", () => {
    expect(km(VENUE.lat, VENUE.lon, VENUE.lat, VENUE.lon)).toBe(0);
    expect(km(35.9916, -78.9045, 35.7796, -78.6382)).toBeCloseTo(km(35.7796, -78.6382, 35.9916, -78.9045), 9);
  });

  it("matches known great-circle distances", () => {
    expect(km(0, 0, 1, 0)).toBeCloseTo(111.195, 2); // one degree of latitude
    const durhamToRaleigh = km(35.9916, -78.9045, 35.7796, -78.6382);
    expect(durhamToRaleigh).toBeGreaterThan(30);
    expect(durhamToRaleigh).toBeLessThan(40);
    const laToNyc = km(34.0522, -118.2437, 40.7128, -74.006);
    expect(laToNyc).toBeGreaterThan(3900);
    expect(laToNyc).toBeLessThan(4000);
  });
});

describe("supportsTrending", () => {
  it("excludes books and video games, which Qloo rejects for trending", () => {
    expect(["movie", "tv_show", "artist", "podcast"].every((k) => supportsTrending(k as never))).toBe(true);
    expect(supportsTrending("book")).toBe(false);
    expect(supportsTrending("videogame")).toBe(false);
  });
});

describe("toCard", () => {
  it("normalizes a raw Qloo entity", () => {
    const card = toCard({
      name: "Halo Infinite",
      entity_id: "E1",
      subtype: "urn:entity:video_game",
      popularity: 0.912345,
      query: { affinity: 0.87654, explainability: { "signal.interests.entities": [{ entity_id: "X", score: 0.45678 }] } },
      properties: { publisher: "Xbox Game Studios, Microsoft", release_year: 2021, image: { url: "s3://bucket/halo.png" } },
      tags: [{ name: "Shooter" }, { name: "" }, { name: "Sci-Fi" }],
    });
    expect(card).toMatchObject({
      id: "E1",
      name: "Halo Infinite",
      kind: "videogame",
      popularity: 0.912,
      affinity: 0.877,
      year: 2021,
      owners: ["Xbox Game Studios", "Microsoft"],
      tags: ["Shooter", "Sci-Fi"],
      explain: 0.457,
    });
    expect(card.image).toBeUndefined(); // internal s3:// URLs can't load in a browser
  });

  it("reads place coordinates and falls back to the requested kind", () => {
    const card = toCard(
      { name: "Fullsteam Brewery", id: "P1", location: { lat: 36.0, lon: -78.9 }, properties: { address: "726 Rigsbee Ave", image: { url: "https://img/x.jpg" } } },
      "place",
    );
    expect(card).toMatchObject({ id: "P1", kind: "place", lat: 36.0, lon: -78.9, address: "726 Rigsbee Ave", image: "https://img/x.jpg" });
  });

  it("survives an empty payload", () => {
    expect(toCard({})).toMatchObject({ id: "unknown", name: "Unknown", kind: "brand" });
  });
});

describe("scanMarket (simulated Qloo)", () => {
  beforeAll(() => {
    delete process.env.QLOO_API_KEY;
  });

  it("ranks each domain by local affinity and records lift against national popularity", async () => {
    const recorder = new QlooRecorder();
    const ctx = new TasteContext(recorder, VENUE.city, VENUE, "baseball");
    const scan = await scanMarket(ctx, ["movie", "book"], 5);

    expect(scan.city).toBe(VENUE.city);
    expect(scan.unavailable).toEqual([]);
    expect(scan.domains.map((d) => d.kind)).toEqual(["movie", "book"]);

    for (const domain of scan.domains) {
      const pool = ctx.pools.get(domain.kind)!;
      expect(domain.entities.length).toBeGreaterThan(0);
      expect(domain.entities.length).toBeLessThanOrEqual(5);
      expect(pool.length).toBeGreaterThanOrEqual(domain.entities.length);
      expect(pool.length).toBeLessThanOrEqual(25);
      domain.entities.forEach((e, i) => {
        expect(e.localRank).toBe(i + 1);
        expect(e.lift).toBe(e.nationalRank! - e.localRank!);
        expect(e.nationalRank).toBeGreaterThanOrEqual(1);
        expect(e.nationalRank).toBeLessThanOrEqual(pool.length);
        expect(pool[i]).toBe(e.id);
        expect(ctx.localPct.get(e.id)).toBe(e.localPct);
        expect(ctx.evidence.get(e.id)).toContain(domain.evidence);
      });
      expect(domain.entities[0].localPct).toBe(1);
      const pcts = domain.entities.map((e) => e.localPct!);
      expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
    }

    // One /v2/insights query per domain; books can't take bias.trends.
    expect(recorder.logs).toHaveLength(2);
    const byType = Object.fromEntries(recorder.logs.map((l) => [l.params["filter.type"], l]));
    expect(byType["urn:entity:movie"].params).toMatchObject({ "bias.trends": "medium", take: "25", "signal.location.query": VENUE.city });
    expect(byType["urn:entity:book"].params["bias.trends"]).toBeUndefined();
    expect(recorder.logs.every((l) => l.simulated && l.endpoint === "/v2/insights")).toBe(true);
  });
});

describe("nearVenueIndex", () => {
  // A 10 x 10 grid around the venue, ~2.2 km apart; cells within 16 km are the inner block.
  const grid = (affinity: (lat: number, lon: number) => number) =>
    Array.from({ length: 100 }, (_, i) => {
      const lat = VENUE.lat + (Math.floor(i / 10) - 4.5) * 0.04;
      const lon = VENUE.lon + ((i % 10) - 4.5) * 0.05;
      return { lat, lon, affinity: affinity(lat, lon) };
    });
  const near = (lat: number, lon: number) => km(lat, lon, VENUE.lat, VENUE.lon) <= 16;

  it("peaks when every hotspot sits in the catchment and is 0 when none does", () => {
    // The ceiling is 1 / (1 + catchment share of cells): 44 of these 100 cells are in the catchment.
    expect(nearVenueIndex(grid((lat, lon) => (near(lat, lon) ? 0.9 : 0.1)), VENUE, 16)).toBeCloseTo(1 / 1.44, 2);
    expect(nearVenueIndex(grid((lat, lon) => (near(lat, lon) ? 0.1 : 0.9)), VENUE, 16)).toBe(0);
  });

  it("is about 0.5 when hotspots are spread evenly", () => {
    const even = nearVenueIndex(grid((lat, lon) => ((Math.round(lat * 100) + Math.round(lon * 100)) % 5) / 5), VENUE, 16)!;
    expect(even).toBeGreaterThan(0.3);
    expect(even).toBeLessThan(0.7);
  });

  it("returns undefined when there are too few cells to measure", () => {
    expect(nearVenueIndex([{ lat: VENUE.lat, lon: VENUE.lon, affinity: 1 }], VENUE, 16)).toBeUndefined();
  });
});

describe("run limits (simulated Qloo)", () => {
  beforeAll(() => {
    delete process.env.QLOO_API_KEY;
  });

  it("stops at the request budget but still serves cached responses", async () => {
    const recorder = new QlooRecorder(undefined, 0, { budget: 1 });
    await qlooGet("/search", { query: "budget-a" }, recorder, "first");
    await expect(qlooGet("/search", { query: "budget-b" }, recorder, "second")).rejects.toThrow(/budget of 1/);
    await expect(qlooGet("/search", { query: "budget-a" }, recorder, "cached")).resolves.toBeDefined();
  });

  it("refuses new requests once the run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const recorder = new QlooRecorder(undefined, 0, { signal: controller.signal });
    await expect(qlooGet("/search", { query: "stopped" }, recorder, "x")).rejects.toThrow(/stopped/i);
    expect(recorder.logs).toEqual([]);
  });

  it("gives parallel scoring calls the same fan-base proxy", async () => {
    const ctx = new TasteContext(new QlooRecorder(), VENUE.city, VENUE, "baseball");
    const scan = await scanMarket(ctx, ["movie", "artist"]);
    const [movies, artists] = scan.domains.map((d) => d.entities.slice(0, 2).map((e) => e.id));
    const [a, b] = await Promise.all([scoreCandidates(ctx, movies, ["families"]), scoreCandidates(ctx, artists, ["families"])]);
    expect(a.proxy?.name).toBeDefined();
    expect(b.proxy).toEqual(a.proxy);
    for (const id of [...movies, ...artists]) expect(ctx.fanOverlap.has(id), id).toBe(true);
  });

  it("resolves every sponsor category to a Qloo tag and reports the ones it can't", async () => {
    const ctx = new TasteContext(new QlooRecorder(), VENUE.city, VENUE, "baseball");
    const scan = await scanMarket(ctx, ["movie"]);
    const categories = ["Beverages", "Restaurants", "Automotive", "Insurance", "Toys", "Underwater Basket Weaving"];
    const { brands, unresolved } = await findSponsors(ctx, [scan.domains[0].entities[0].id], categories);
    expect(unresolved).toEqual(["Underwater Basket Weaving"]);
    expect(new Set(brands.map((b) => b.category))).toEqual(new Set(categories.slice(0, 5)));
  });
});
