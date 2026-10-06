import "server-only";
import type {
  Demographics,
  EntityCard,
  EntityKind,
  EntityProfile,
  HeatSummary,
  MarketScan,
  SegmentId,
  TrendSeries,
  Venue,
} from "@/lib/types";
import { computeScore } from "@/lib/scoring";
import { QlooRecorder, qlooGet } from "./client";

export const KIND_URN: Record<EntityKind, string> = {
  movie: "urn:entity:movie",
  tv_show: "urn:entity:tv_show",
  artist: "urn:entity:artist",
  // Verified against the hackathon host: "videogame" works, "video_game" returns 400.
  videogame: "urn:entity:videogame",
  podcast: "urn:entity:podcast",
  book: "urn:entity:book",
  brand: "urn:entity:brand",
  place: "urn:entity:place",
  person: "urn:entity:person",
};

const URN_KIND = Object.fromEntries(Object.entries(KIND_URN).map(([k, v]) => [v, k])) as Record<string, EntityKind>;
URN_KIND["urn:entity:video_game"] = "videogame";

/** Qloo caps `take` at 50 on /v2/insights (heatmaps included). */
const MAX_TAKE = 50;
/** Candidates are ranked against the city's top results for their domain, so every score comes from one query. */
const POOL_SIZE = 25;

/** Per-run memory shared by every workflow: entity cards seen so far and the scores computed for them. */
export class TasteContext {
  readonly cards = new Map<string, EntityCard>();
  readonly profiles = new Map<string, EntityProfile>();
  /** Rank percentile (0..1) inside the domain pool with the city as location signal. */
  readonly localPct = new Map<string, number>();
  /** Blend of pool rank under the segment's signal and urn:demographics alignment (0..1). */
  readonly segmentFit = new Map<string, Partial<Record<SegmentId, number>>>();
  readonly demographics = new Map<string, Demographics>();
  readonly demographicsRequest = new Map<string, string>();
  /** Rank percentile under the sport fan-base proxy signal (1 = existing fans like it most). */
  readonly fanOverlap = new Map<string, number>();
  readonly evidence = new Map<string, string[]>();
  /** The city's top results per domain (scan order), used as the ranking pool. */
  readonly pools = new Map<EntityKind, string[]>();
  /** How Qloo resolved the market name, e.g. "Durham County, North Carolina, United States". */
  resolvedLocality?: string;
  fanbaseProxy?: EntityCard | null;
  private familiesAudience?: string | null;
  private poolScans = new Map<EntityKind, Promise<void>>();

  constructor(
    readonly recorder: QlooRecorder,
    readonly city: string,
    readonly venue: Venue,
    readonly sport?: string,
  ) {}

  remember(cards: EntityCard[]) {
    for (const card of cards) {
      const prev = this.cards.get(card.id);
      // Keep the first affinity we saw (the city scan) — later queries are normalized differently.
      this.cards.set(card.id, { ...prev, ...card, affinity: prev?.affinity ?? card.affinity, localRank: prev?.localRank ?? card.localRank });
    }
  }

  cite(id: string, ...requestIds: string[]) {
    const ids = requestIds.filter(Boolean);
    if (ids.length) this.evidence.set(id, [...new Set([...(this.evidence.get(id) ?? []), ...ids])]);
  }

  async familiesAudienceId(): Promise<string | null> {
    if (this.familiesAudience !== undefined) return this.familiesAudience;
    try {
      const { body } = await qlooGet<RawAudiences>(
        "/v2/audiences",
        { "filter.query": "parents", "filter.parents.types": "urn:audience:life_stage", take: 10 },
        this.recorder,
        "Resolve the Qloo life-stage audience for families with kids",
      );
      const list = body.results?.audiences ?? body.results?.entities ?? [];
      const match =
        list.find((a) => /young|child|kid/i.test(a.name ?? "") && /parent/i.test(a.name ?? "")) ??
        list.find((a) => /parent/i.test(a.name ?? ""));
      this.familiesAudience = match?.id ?? null;
    } catch {
      this.familiesAudience = null;
    }
    return this.familiesAudience;
  }

  /** Build the ranking pool for a domain if the market scan didn't cover it (e.g. the LLM-only control). */
  ensurePool(kind: EntityKind) {
    if (this.pools.has(kind)) return Promise.resolve();
    let pending = this.poolScans.get(kind);
    if (!pending) {
      pending = scanMarket(this, [kind]).then(() => undefined);
      this.poolScans.set(kind, pending);
    }
    return pending;
  }
}

/** Taste Fit Score for an entity on a given segment, from everything this run has measured. */
export function scoreIn(ctx: TasteContext, entity: EntityCard, segment: SegmentId) {
  return computeScore({
    entity,
    segment,
    localAffinity: ctx.localPct.get(entity.id),
    profile: ctx.profiles.get(entity.id),
    segmentFit: ctx.segmentFit.get(entity.id),
    fanOverlap: ctx.fanOverlap.get(entity.id),
  });
}

// ---------- raw response shapes (parsed defensively) ----------

interface RawEntity {
  name?: string;
  entity_id?: string;
  id?: string;
  subtype?: string;
  type?: string;
  types?: string[];
  popularity?: number;
  affinity?: number;
  location?: { lat?: number; lon?: number };
  properties?: Record<string, unknown> & {
    image?: { url?: string };
    release_year?: number;
    production_companies?: string[];
    publisher?: string;
    developer?: string;
    industries?: string[];
    short_description?: string;
    address?: string;
    lat?: number;
    lon?: number;
    latitude?: number;
    longitude?: number;
    geocode?: { lat?: number; lon?: number; city?: string };
  };
  tags?: { id?: string; name?: string; type?: string }[];
  query?: {
    affinity?: number | null;
    distance?: number;
    explainability?: Record<string, { entity_id?: string; score?: number }[]>;
  };
  disambiguation?: string;
}
interface RawInsights {
  results?: {
    entities?: RawEntity[];
    tags?: { tag_id?: string; id?: string; name?: string; query?: { affinity?: number; score?: number } }[];
    demographics?: { entity_id: string; query?: { age?: Record<string, number>; gender?: Record<string, number> } }[];
    heatmap?: { location?: { latitude?: number; longitude?: number }; query?: { affinity?: number; popularity?: number } }[];
    trending?: { date?: string; population_percentile?: number }[];
  };
  query?: { localities?: { signal?: { name?: string; disambiguation?: string } } };
}
interface RawSearch {
  results?: RawEntity[] | { entities?: RawEntity[] };
}
interface RawTags {
  results?: { tags?: { id?: string; name?: string }[] };
}
interface RawAudiences {
  results?: { audiences?: { id?: string; name?: string }[]; entities?: { id?: string; name?: string }[] };
}

const round = (n: number, d = 3) => Number(n.toFixed(d));
const pctAt = (index: number, n: number) => (n > 1 ? round(1 - index / (n - 1)) : 0.5);

export function toCard(raw: RawEntity, fallbackKind?: EntityKind): EntityCard {
  const p = raw.properties ?? {};
  const urn = raw.subtype ?? raw.types?.[0] ?? (raw.type?.startsWith("urn:entity:") ? raw.type : undefined);
  const kind: EntityKind = (urn ? URN_KIND[urn] : undefined) ?? fallbackKind ?? "brand";
  const owners = [
    ...(Array.isArray(p.production_companies) ? p.production_companies : []),
    ...(typeof p.publisher === "string" ? p.publisher.split(/,\s*/) : []),
    ...(typeof p.developer === "string" ? [p.developer] : []),
  ].filter(Boolean);
  // Places carry coordinates at the top level ("location"); older shapes nest them in properties.
  const lat = raw.location?.lat ?? p.lat ?? p.latitude ?? p.geocode?.lat;
  const lon = raw.location?.lon ?? p.lon ?? p.longitude ?? p.geocode?.lon;
  const affinity = raw.query?.affinity ?? raw.affinity;
  const explain = raw.query?.explainability?.["signal.interests.entities"]?.[0]?.score;
  return {
    id: raw.entity_id ?? raw.id ?? raw.name ?? "unknown",
    name: raw.name ?? "Unknown",
    kind,
    // Some brand images come back as internal s3:// URLs browsers can't load.
    image: typeof p.image?.url === "string" && /^https?:\/\//.test(p.image.url) ? p.image.url : undefined,
    popularity: typeof raw.popularity === "number" ? round(raw.popularity) : undefined,
    affinity: typeof affinity === "number" ? round(affinity) : undefined,
    year: typeof p.release_year === "number" ? p.release_year : undefined,
    subtitle: raw.disambiguation ?? (typeof p.short_description === "string" ? p.short_description : undefined),
    tags: raw.tags?.map((t) => t.name ?? "").filter(Boolean).slice(0, 6),
    industries: Array.isArray(p.industries) ? p.industries.slice(0, 4) : undefined,
    address: typeof p.address === "string" ? p.address : undefined,
    lat: typeof lat === "number" ? lat : undefined,
    lon: typeof lon === "number" ? lon : undefined,
    owners: owners.length ? owners : undefined,
    explain: typeof explain === "number" ? round(explain) : undefined,
  };
}

function entitiesOf(body: RawSearch | RawInsights): RawEntity[] {
  const r = (body as RawSearch).results;
  return Array.isArray(r) ? r : ((r as RawInsights["results"])?.entities ?? []);
}

async function insightsEntities(
  ctx: TasteContext,
  kind: EntityKind,
  params: Record<string, string | number | boolean | undefined>,
  purpose: string,
) {
  const res = await qlooGet<RawInsights>("/v2/insights", { "filter.type": KIND_URN[kind], ...params }, ctx.recorder, purpose);
  const locality = res.body.query?.localities?.signal;
  if (locality && !ctx.resolvedLocality) ctx.resolvedLocality = locality.disambiguation ?? locality.name;
  return { cards: entitiesOf(res.body).map((e) => toCard(e, kind)), requestId: res.requestId };
}

/** Verified live: books and video games reject bias.trends and /v2/trending ("does not yet support trending requests"). */
const SUPPORTS_TREND_BIAS = new Set<EntityKind>(["movie", "tv_show", "artist", "podcast"]);
export const supportsTrending = (kind: EntityKind) => SUPPORTS_TREND_BIAS.has(kind);

// ---------- 1. What does this market over-index on? ----------

export async function scanMarket(ctx: TasteContext, kinds: EntityKind[], take = 10, minPopularity = 0.8): Promise<MarketScan> {
  const unavailable: { kind: EntityKind; reason: string }[] = [];
  const results = await Promise.all(
    kinds.map(async (kind) => {
      const scan = await insightsEntities(
        ctx,
        kind,
        {
          "signal.location.query": ctx.city,
          "filter.popularity.min": minPopularity,
          "bias.trends": SUPPORTS_TREND_BIAS.has(kind) ? "medium" : undefined,
          take: POOL_SIZE,
        },
        `What ${kind.replace("_", " ")}s does ${ctx.city} have the strongest affinity for?`,
      ).catch((error: Error) => {
        // One domain failing (no data for a region, unsupported param) shouldn't sink the whole scan.
        unavailable.push({ kind, reason: error.message.slice(0, 160) });
        return null;
      });
      if (!scan) return null;
      const { cards, requestId } = scan;
      // Qloo normalizes affinity per query, so we compare ranks inside this one result set:
      // Local Lift = rank by national popularity − rank by local affinity.
      const byPopularity = [...cards].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
      const enriched = cards.map((card, localIndex) => {
        const nationalIndex = byPopularity.findIndex((c) => c.id === card.id);
        return {
          ...card,
          localRank: localIndex + 1,
          nationalRank: nationalIndex + 1,
          lift: nationalIndex - localIndex,
          localPct: pctAt(localIndex, cards.length),
        };
      });
      ctx.pools.set(kind, enriched.map((c) => c.id));
      for (const card of enriched) {
        if (!ctx.localPct.has(card.id)) ctx.localPct.set(card.id, card.localPct);
        ctx.cite(card.id, requestId);
      }
      ctx.remember(enriched);
      return { kind, entities: enriched.slice(0, take), evidence: requestId };
    }),
  );
  const domains = results.filter((d): d is NonNullable<typeof d> => Boolean(d));
  return { city: ctx.city, resolvedAs: ctx.resolvedLocality, domains, unavailable };
}

// ---------- 2. Who are the fans, where are they, are they growing? ----------

const AGE_BUCKETS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"] as const;

export function km(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export function summarizeTrend(points: { date: string; percentile: number }[], window?: TrendSeries["window"]): TrendSeries {
  if (points.length < 3) return { points, direction: "unknown", changePct: 0, window };
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const third = Math.max(1, Math.floor(sorted.length / 3));
  const avg = (xs: typeof sorted) => xs.reduce((s, p) => s + p.percentile, 0) / xs.length;
  const early = avg(sorted.slice(0, third));
  const late = avg(sorted.slice(-third));
  const changePct = early > 0 ? ((late - early) / early) * 100 : 0;
  const direction = changePct > 6 ? "rising" : changePct < -6 ? "cooling" : "steady";
  return { points: sorted, direction, changePct: round(Math.max(-100, Math.min(300, changePct)), 1), window };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const TREND_WEEKS = 16;
/**
 * The hackathon dataset's trending series stop in late September 2025 (verified live: windows ending
 * in 2026 return []), so we use the latest window with data. QLOO_TRENDING_END overrides it if the
 * dataset is refreshed.
 */
const TREND_END = process.env.QLOO_TRENDING_END ?? "2025-09-28";

async function trendFor(ctx: TasteContext, card: EntityCard) {
  if (!supportsTrending(card.kind)) return undefined;
  for (const end of [TREND_END]) {
    const endDate = new Date(`${end}T00:00:00Z`);
    const start = iso(new Date(endDate.getTime() - TREND_WEEKS * 7 * 86400000));
    const res = await qlooGet<RawInsights>(
      "/v2/trending",
      { "filter.type": KIND_URN[card.kind], "signal.interests.entities": card.id, "filter.start_date": start, "filter.end_date": end },
      ctx.recorder,
      `Is interest in ${card.name} rising or cooling? (${start} → ${end})`,
    ).catch(() => undefined);
    const points = (res?.body.results?.trending ?? [])
      .filter((p) => p.date && typeof p.population_percentile === "number")
      .map((p) => ({ date: p.date as string, percentile: p.population_percentile as number }));
    if (res) return { series: summarizeTrend(points, { start, end }), requestId: res.requestId };
  }
  return undefined;
}

async function fetchDemographics(ctx: TasteContext, ids: string[]) {
  const missing = [...new Set(ids)].filter((id) => !ctx.demographics.has(id));
  for (let i = 0; i < missing.length; i += 20) {
    const chunk = missing.slice(i, i + 20);
    const res = await qlooGet<RawInsights>(
      "/v2/insights",
      { "filter.type": "urn:demographics", "signal.interests.entities": chunk.join(",") },
      ctx.recorder,
      `Aggregate age and gender affinity of ${chunk.length} fandom(s)`,
    ).catch(() => undefined);
    for (const row of res?.body.results?.demographics ?? []) {
      if (!row.query) continue;
      ctx.demographics.set(row.entity_id, {
        age: Object.fromEntries(AGE_BUCKETS.map((b) => [b, round(row.query?.age?.[b] ?? 0)])),
        gender: { male: round(row.query.gender?.male ?? 0), female: round(row.query.gender?.female ?? 0) },
      });
      ctx.demographicsRequest.set(row.entity_id, res!.requestId);
      ctx.cite(row.entity_id, res!.requestId);
    }
  }
}

export async function profileEntities(ctx: TasteContext, ids: string[], catchmentKm = 16, limit = 8): Promise<EntityProfile[]> {
  const unique = [...new Set(ids)].slice(0, limit);
  await ensureCards(ctx, unique);
  const demoPromise = fetchDemographics(ctx, unique);

  const perEntity = await Promise.all(
    unique.map(async (id) => {
      const card = ctx.cards.get(id) ?? { id, name: id, kind: "movie" as EntityKind };
      const [trend, heat, tags] = await Promise.all([
        trendFor(ctx, card),
        qlooGet<RawInsights>(
          "/v2/insights",
          {
            "filter.type": "urn:heatmap",
            "signal.interests.entities": id,
            "filter.location": `POINT(${ctx.venue.lon} ${ctx.venue.lat})`,
            "filter.location.radius": 40000,
            take: MAX_TAKE,
          },
          ctx.recorder,
          `Where within 40 km of ${ctx.venue.name} do ${card.name} fans concentrate?`,
        ).catch(() => undefined),
        qlooGet<RawInsights>(
          "/v2/insights",
          { "filter.type": "urn:tag", "signal.interests.entities": id, take: 8 },
          ctx.recorder,
          `Taste tags that describe the ${card.name} audience`,
        ).catch(() => undefined),
      ]);
      return { id, card, trend, heat, tags };
    }),
  );
  await demoPromise;

  return unique.map((id) => {
    const parts = perEntity.find((p) => p.id === id)!;
    const demographics = ctx.demographics.get(id);
    const evidence: string[] = [ctx.demographicsRequest.get(id)].filter((r): r is string => Boolean(r));

    if (parts.trend) evidence.push(parts.trend.requestId);

    let heat: HeatSummary | undefined;
    if (parts.heat) {
      evidence.push(parts.heat.requestId);
      const points = (parts.heat.body.results?.heatmap ?? [])
        .filter((c) => typeof c.location?.latitude === "number" && typeof c.location?.longitude === "number")
        .map((c) => ({
          lat: c.location!.latitude as number,
          lon: c.location!.longitude as number,
          affinity: round(c.query?.affinity ?? 0),
          popularity: c.query?.popularity,
        }));
      const near = points.filter((p) => km(p.lat, p.lon, ctx.venue.lat, ctx.venue.lon) <= catchmentKm);
      const mean = (xs: typeof points) => (xs.length ? xs.reduce((s, p) => s + p.affinity, 0) / xs.length : 0);
      // 0.5 = the catchment looks like the metro average; 1 = twice as strong near the venue.
      const ratio = mean(points) > 0 ? mean(near) / mean(points) : 0;
      heat = { points, nearVenueIndex: points.length ? round(Math.max(0, Math.min(1, ratio / 2))) : 0.5, catchmentKm };
    }

    let tasteTags: string[] | undefined;
    if (parts.tags) {
      evidence.push(parts.tags.requestId);
      tasteTags = (parts.tags.body.results?.tags ?? []).map((t) => t.name ?? "").filter(Boolean);
    }

    evidence.forEach((r) => ctx.cite(id, r));
    const profile: EntityProfile = {
      entity: parts.card,
      demographics,
      trend: parts.trend?.series,
      heat,
      tasteTags,
      segmentFit: ctx.segmentFit.get(id),
      evidence,
    };
    ctx.profiles.set(id, profile);
    return profile;
  });
}

async function ensureCards(ctx: TasteContext, ids: string[]) {
  const missing = ids.filter((id) => !ctx.cards.has(id));
  if (!missing.length) return;
  const { body, requestId } = await qlooGet<RawSearch>(
    "/entities",
    { entity_ids: missing.join(",") },
    ctx.recorder,
    "Look up entity details by Qloo ID",
  );
  const cards = entitiesOf(body).map((e) => toCard(e));
  ctx.remember(cards);
  cards.forEach((c) => ctx.cite(c.id, requestId));
}

// ---------- 3. Which audience does each fandom fit, and does it bring new fans? ----------

const SEGMENT_AGE: Record<Exclude<SegmentId, "families">, string> = {
  gen_z: "24_and_younger",
  young_pros: "25_to_29,30_to_34",
  boomers: "55_and_older",
};

/** urn:demographics values are relative to average (−1…+1), so they ARE comparable across entities. */
function demographicAlignment(d: Demographics | undefined, segment: SegmentId): number | undefined {
  if (!d) return undefined;
  const a = d.age;
  const v =
    segment === "gen_z"
      ? (a["24_and_younger"] ?? 0)
      : segment === "young_pros"
        ? ((a["25_to_29"] ?? 0) + (a["30_to_34"] ?? 0)) / 2
        : segment === "boomers"
          ? (a["55_and_older"] ?? 0)
          : ((a["30_to_34"] ?? 0) + (a["35_to_44"] ?? 0)) / 2; // parents of young kids skew 30–44
  return round(Math.max(0, Math.min(1, (v + 1) / 2)));
}

/**
 * Rank `ids` inside their domain pool (the city's top results + the candidates) under one signal.
 * One query per domain keeps every compared score inside the same normalization.
 */
async function rankInPool(
  ctx: TasteContext,
  kind: EntityKind,
  ids: string[],
  signal: Record<string, string>,
  purpose: string,
): Promise<Map<string, number>> {
  // Candidates + the city's top 15 for the domain: enough context for a meaningful percentile while
  // keeping each request fast (large filter.results.entities lists took ~4 s live).
  const pool = [...new Set([...ids, ...(ctx.pools.get(kind) ?? []).slice(0, 15)])].slice(0, 30);
  const { cards, requestId } = await insightsEntities(
    ctx,
    kind,
    { ...signal, "filter.results.entities": pool.join(","), take: Math.min(MAX_TAKE, pool.length) },
    purpose,
  ).catch(() => ({ cards: [] as EntityCard[], requestId: "" }));
  const ranks = new Map<string, number>();
  cards.forEach((card, index) => {
    ranks.set(card.id, pctAt(index, cards.length));
    if (ids.includes(card.id)) ctx.cite(card.id, requestId);
  });
  return ranks;
}

const FANBASE_PROXIES: Record<string, string[]> = {
  baseball: ["Major League Baseball", "Minor League Baseball", "MLB The Show"],
  basketball: ["National Basketball Association", "NBA 2K"],
  hockey: ["National Hockey League", "NHL"],
  soccer: ["Major League Soccer", "EA Sports FC"],
  football: ["National Football League", "Madden NFL"],
};

async function resolveFanbaseProxy(ctx: TasteContext): Promise<EntityCard | null> {
  if (ctx.fanbaseProxy !== undefined) return ctx.fanbaseProxy;
  ctx.fanbaseProxy = null;
  for (const query of FANBASE_PROXIES[ctx.sport ?? ""] ?? []) {
    const found = await searchEntities(ctx, query, ["brand", "videogame", "tv_show"], 3).catch(() => []);
    const exact = found.find((c) => c.name.toLowerCase() === query.toLowerCase()) ?? found[0];
    if (exact) {
      ctx.fanbaseProxy = exact;
      break;
    }
  }
  return ctx.fanbaseProxy;
}

/**
 * Score candidates for every segment the schedule needs, plus local rank and fan-base overlap.
 * Per domain: 1 local query + 1 per segment + 1 fan-base query, each ranking the same pool.
 */
export async function scoreCandidates(ctx: TasteContext, ids: string[], segments: SegmentId[]) {
  await ensureCards(ctx, ids);
  const byKind = new Map<EntityKind, string[]>();
  for (const id of new Set(ids)) {
    const kind = ctx.cards.get(id)?.kind;
    if (kind && kind !== "brand" && kind !== "place") byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
  }
  await Promise.all([...byKind.keys()].map((kind) => ctx.ensurePool(kind)));
  const [familiesAudience, proxy] = await Promise.all([
    segments.includes("families") ? ctx.familiesAudienceId() : Promise.resolve(null),
    resolveFanbaseProxy(ctx),
    fetchDemographics(ctx, [...byKind.values()].flat()),
  ]);

  await Promise.all(
    [...byKind.entries()].flatMap(([kind, kindIds]) => {
      const label = kind.replace("_", " ");
      const unranked = kindIds.filter((id) => !ctx.localPct.has(id));
      const jobs: Promise<void>[] = [
        // Scanned candidates already have a local rank from the market scan (same pool, same signal).
        ...(unranked.length
          ? [
              rankInPool(ctx, kind, unranked, { "signal.location.query": ctx.city }, `Local rank of ${unranked.length} ${label} fandom(s) in ${ctx.city}`).then(
                (r) => r.forEach((pct, id) => unranked.includes(id) && ctx.localPct.set(id, pct)),
              ),
            ]
          : []),
        ...[...new Set(segments)].map((segment) => {
          const signal: Record<string, string> =
            segment === "families"
              ? familiesAudience
                ? { "signal.demographics.audiences": familiesAudience }
                : { "signal.demographics.age": "30_to_34,35_to_44" }
              : { "signal.demographics.age": SEGMENT_AGE[segment] };
          return rankInPool(
            ctx,
            kind,
            kindIds,
            { ...signal, "signal.location.query": ctx.city },
            `Rank ${label} fandoms for the ${segment.replace("_", " ")} segment in ${ctx.city}`,
          ).then((ranks) => {
            for (const id of kindIds) {
              const rank = ranks.get(id);
              const demo = demographicAlignment(ctx.demographics.get(id), segment);
              const fit = rank === undefined ? demo : demo === undefined ? rank : round(0.5 * rank + 0.5 * demo);
              if (fit !== undefined) ctx.segmentFit.set(id, { ...ctx.segmentFit.get(id), [segment]: fit });
            }
          });
        }),
      ];
      if (proxy) {
        jobs.push(
          rankInPool(
            ctx,
            kind,
            kindIds,
            { "signal.interests.entities": proxy.id },
            `How much do existing fans (proxy: ${proxy.name}) already like these ${label} fandoms?`,
          ).then((r) => r.forEach((pct, id) => kindIds.includes(id) && ctx.fanOverlap.set(id, pct))),
        );
      }
      return jobs;
    }),
  );

  return {
    proxy,
    rows: ids
      .map((id) => ({ entity: ctx.cards.get(id)!, fit: ctx.segmentFit.get(id) ?? {} }))
      .filter((r) => r.entity),
  };
}

export async function crossoverTags(ctx: TasteContext, aIds: string[], bIds: string[]) {
  const { body, requestId } = await qlooGet<RawInsights>(
    "/v2/analysis/compare",
    { "a.signal.interests.entities": aIds.join(","), "b.signal.interests.entities": bIds.join(","), take: 12 },
    ctx.recorder,
    "Compare two fan bases to find shared taste hooks",
  );
  aIds.forEach((id) => ctx.cite(id, requestId));
  return {
    tags: (body.results?.tags ?? []).map((t) => ({ name: t.name ?? "", score: round(t.query?.score ?? 0) })).filter((t) => t.name),
    requestId,
  };
}

// ---------- 4. Sponsors, playlist, local partners, media partners ----------

/** Plain-language sponsor categories → the phrase we search Qloo's tag index with. */
const CATEGORY_QUERY: Record<string, string> = {
  Beverages: "soft drinks",
  Beer: "beer",
  "Energy Drinks": "energy drinks",
  Restaurants: "restaurant",
  "Quick Service Restaurants": "fast food",
  Automotive: "automotive",
  Telecommunications: "telecommunications",
  Insurance: "insurance",
  Apparel: "apparel",
  "Outdoor Gear": "outdoor gear",
  Toys: "toys",
  Retail: "retail",
};
const TAG_PRIORITY = ["urn:tag:product_category:qloo:", "urn:tag:industry:qloo:", "urn:tag:product_service:qloo:", "urn:tag:genre:brand:"];
/** Leagues, teams and sports media are partners or competitors, not sponsor prospects. */
const NOT_SPONSORS = "urn:tag:genre:brand:sports_organization,urn:tag:genre:brand:entertainment:media:sports";
const categoryTags = new Map<string, Promise<string | null>>();

function categoryTag(ctx: TasteContext, category: string): Promise<string | null> {
  const key = category.toLowerCase();
  let pending = categoryTags.get(key);
  if (!pending) {
    pending = qlooGet<RawTags>(
      "/v2/tags",
      {
        "filter.query": CATEGORY_QUERY[category] ?? category,
        "filter.parents.types": "urn:entity:brand",
        "feature.semantic_search": true,
        take: 8,
      },
      ctx.recorder,
      `Resolve sponsor category "${category}" to a Qloo brand tag`,
    )
      .then(({ body }) => {
        const tags = (body.results?.tags ?? []).map((t) => t.id ?? "").filter(Boolean);
        for (const prefix of TAG_PRIORITY) {
          const hit = tags.find((t) => t.startsWith(prefix));
          if (hit) return hit;
        }
        return tags[0] ?? null;
      })
      .catch(() => {
        categoryTags.delete(key);
        return null;
      });
    categoryTags.set(key, pending);
  }
  return pending;
}

export async function findSponsors(ctx: TasteContext, anchorIds: string[], categories: string[] = []) {
  const signal = {
    "signal.interests.entities": anchorIds.join(","),
    "signal.location.query": ctx.city,
    "signal.location.weight": "low",
    "feature.explainability": true,
    "filter.exclude.tags": NOT_SPONSORS,
  };
  const resolved = (await Promise.all(categories.slice(0, 4).map(async (c) => ({ category: c, tag: await categoryTag(ctx, c) })))).filter(
    (r): r is { category: string; tag: string } => Boolean(r.tag),
  );
  const groups = resolved.length
    ? await Promise.all(
        resolved.map(async ({ category, tag }) => {
          const { cards, requestId } = await insightsEntities(
            ctx,
            "brand",
            { ...signal, "filter.tags": tag, take: 6 },
            `${category} brands whose audiences share this fandom's taste (sponsor prospects)`,
          ).catch(() => ({ cards: [] as EntityCard[], requestId: "" }));
          return { cards: cards.map((c) => ({ ...c, category })), requestId };
        }),
      )
    : [
        await insightsEntities(ctx, "brand", { ...signal, take: 12 }, "Brands whose audiences share this fandom's taste (sponsor prospects)").catch(() => ({
          cards: [] as EntityCard[],
          requestId: "",
        })),
      ];

  // Round-robin across categories so every category the sales team needs gets a prospect.
  const merged: EntityCard[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    for (const g of groups) {
      const card = g.cards[i];
      if (card && !seen.has(card.id)) {
        seen.add(card.id);
        merged.push(card);
      }
    }
  }
  ctx.remember(merged);
  for (const g of groups) g.cards.forEach((c) => ctx.cite(c.id, g.requestId));
  anchorIds.forEach((id) => groups.forEach((g) => ctx.cite(id, g.requestId)));
  return { brands: merged.slice(0, 10) };
}

/** Bars, restaurants, breweries and cafés make workable pre-game and concession partners. */
const PARTNER_PLACE_TAGS = "urn:tag:genre:place:restaurant,urn:tag:genre:place:restaurant:bar,urn:tag:genre:place:brewery,urn:tag:genre:place:restaurant:cafe";

export async function buildExperience(ctx: TasteContext, anchorIds: string[]) {
  const signal = anchorIds.join(",");
  const [artists, places, podcasts] = await Promise.all([
    insightsEntities(
      ctx,
      "artist",
      { "signal.interests.entities": signal, "signal.location.query": ctx.city, take: 12 },
      "Artists this fandom loves locally (in-game playlist)",
    ).catch(() => ({ cards: [] as EntityCard[], requestId: "" })),
    insightsEntities(
      ctx,
      "place",
      {
        "signal.interests.entities": signal,
        "filter.location": `POINT(${ctx.venue.lon} ${ctx.venue.lat})`,
        "filter.location.radius": 6000,
        "filter.tags": PARTNER_PLACE_TAGS,
        "operator.filter.tags": "union",
        take: 12,
      },
      `Bars and restaurants within 6 km of ${ctx.venue.name} this fandom over-indexes on (local partners)`,
    ).catch(() => ({ cards: [] as EntityCard[], requestId: "" })),
    insightsEntities(ctx, "podcast", { "signal.interests.entities": signal, take: 8 }, "Podcasts this fandom listens to (media partners)").catch(
      () => ({ cards: [] as EntityCard[], requestId: "" }),
    ),
  ]);
  for (const group of [artists, places, podcasts]) {
    ctx.remember(group.cards);
    group.cards.forEach((c) => ctx.cite(c.id, group.requestId));
  }
  anchorIds.forEach((id) => [artists, places, podcasts].forEach((g) => ctx.cite(id, g.requestId)));
  return { artists: artists.cards, places: places.cards, podcasts: podcasts.cards };
}

// ---------- 5. Resolve names to Qloo entities ----------

export async function searchEntities(ctx: TasteContext, query: string, kinds: EntityKind[] = [], take = 5) {
  const { body, requestId } = await qlooGet<RawSearch>(
    "/search",
    { query, types: kinds.map((k) => KIND_URN[k]).join(","), take },
    ctx.recorder,
    `Resolve "${query}" to a Qloo entity`,
  );
  const cards = entitiesOf(body).map((e) => toCard(e));
  ctx.remember(cards);
  cards.forEach((c) => ctx.cite(c.id, requestId));
  return cards;
}
