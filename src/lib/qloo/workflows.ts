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
import { QlooError, QlooRecorder, qlooGet } from "./client";

export const KIND_URN: Record<EntityKind, string> = {
  movie: "urn:entity:movie",
  tv_show: "urn:entity:tv_show",
  artist: "urn:entity:artist",
  videogame: "urn:entity:videogame",
  podcast: "urn:entity:podcast",
  book: "urn:entity:book",
  brand: "urn:entity:brand",
  place: "urn:entity:place",
  person: "urn:entity:person",
};

const URN_KIND = Object.fromEntries(Object.entries(KIND_URN).map(([k, v]) => [v, k])) as Record<string, EntityKind>;
URN_KIND["urn:entity:video_game"] = "videogame";

/** Per-run memory shared by every workflow: entity cards seen so far and the scores computed for them. */
export class TasteContext {
  readonly cards = new Map<string, EntityCard>();
  readonly profiles = new Map<string, EntityProfile>();
  readonly localAffinity = new Map<string, number>();
  readonly segmentFit = new Map<string, Partial<Record<SegmentId, number>>>();
  readonly fanOverlap = new Map<string, number>();
  readonly evidence = new Map<string, string[]>();
  private familiesAudience?: string | null;

  constructor(
    readonly recorder: QlooRecorder,
    readonly city: string,
    readonly venue: Venue,
  ) {}

  remember(cards: EntityCard[]) {
    for (const card of cards) {
      const prev = this.cards.get(card.id);
      this.cards.set(card.id, { ...prev, ...card, affinity: prev?.affinity ?? card.affinity });
    }
  }

  cite(id: string, ...requestIds: string[]) {
    this.evidence.set(id, [...new Set([...(this.evidence.get(id) ?? []), ...requestIds])]);
  }

  async familiesAudienceId(): Promise<string | null> {
    if (this.familiesAudience !== undefined) return this.familiesAudience;
    try {
      const { body } = await qlooGet<RawAudiences>(
        "/v2/audiences",
        { "filter.query": "parents", "filter.parents.types": "urn:audience:life_stage", take: 10 },
        this.recorder,
        "Find the Qloo life-stage audience for families with kids",
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
  properties?: Record<string, unknown> & {
    image?: { url?: string };
    release_year?: number;
    production_companies?: string[];
    publisher?: string;
    developer?: string;
    industries?: string[];
    short_description?: string;
    description?: string;
    address?: string;
    lat?: number;
    lon?: number;
    latitude?: number;
    longitude?: number;
    geocode?: { lat?: number; lon?: number; city?: string };
  };
  tags?: { id?: string; name?: string; type?: string }[];
  query?: { affinity?: number | null; distance?: number };
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
}
interface RawSearch {
  results?: RawEntity[] | { entities?: RawEntity[] };
}
interface RawAudiences {
  results?: { audiences?: { id?: string; name?: string }[]; entities?: { id?: string; name?: string }[] };
}

const round = (n: number, d = 3) => Number(n.toFixed(d));

export function toCard(raw: RawEntity, fallbackKind?: EntityKind): EntityCard {
  const p = raw.properties ?? {};
  const urn = raw.subtype ?? raw.types?.[0] ?? (raw.type?.startsWith("urn:entity:") ? raw.type : undefined);
  const kind: EntityKind = (urn ? URN_KIND[urn] : undefined) ?? fallbackKind ?? "brand";
  const owners = [
    ...(Array.isArray(p.production_companies) ? p.production_companies : []),
    ...(typeof p.publisher === "string" ? p.publisher.split(/,\s*/) : []),
    ...(typeof p.developer === "string" ? [p.developer] : []),
  ].filter(Boolean);
  const lat = p.lat ?? p.latitude ?? p.geocode?.lat;
  const lon = p.lon ?? p.longitude ?? p.geocode?.lon;
  const affinity = raw.query?.affinity ?? raw.affinity;
  return {
    id: raw.entity_id ?? raw.id ?? raw.name ?? "unknown",
    name: raw.name ?? "Unknown",
    kind,
    image: p.image?.url,
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
  };
}

/** /v2/insights for an entity type; retries the alternate video-game spelling the docs disagree on. */
async function insightsEntities(
  ctx: TasteContext,
  kind: EntityKind,
  params: Record<string, string | number | boolean | undefined>,
  purpose: string,
) {
  try {
    const res = await qlooGet<RawInsights>("/v2/insights", { "filter.type": KIND_URN[kind], ...params }, ctx.recorder, purpose);
    return { cards: (res.body.results?.entities ?? []).map((e) => toCard(e, kind)), requestId: res.requestId };
  } catch (error) {
    if (kind === "videogame" && error instanceof QlooError && [400, 403].includes(error.status)) {
      const res = await qlooGet<RawInsights>(
        "/v2/insights",
        { "filter.type": "urn:entity:video_game", ...params },
        ctx.recorder,
        purpose,
      );
      return { cards: (res.body.results?.entities ?? []).map((e) => toCard(e, kind)), requestId: res.requestId };
    }
    throw error;
  }
}

// ---------- 1. What does this market over-index on? ----------

export async function scanMarket(ctx: TasteContext, kinds: EntityKind[], take = 10, minPopularity = 0.7): Promise<MarketScan> {
  const domains = await Promise.all(
    kinds.map(async (kind) => {
      const { cards, requestId } = await insightsEntities(
        ctx,
        kind,
        {
          "signal.location.query": ctx.city,
          "filter.popularity.min": minPopularity,
          "bias.trends": "medium",
          take: 25,
        },
        `What ${kind.replace("_", " ")}s does ${ctx.city} have the strongest affinity for?`,
      );
      // Local Lift: rank by local affinity vs rank by national popularity within the same result set.
      const byPopularity = [...cards].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
      const enriched = cards.map((card, localIndex) => {
        const nationalIndex = byPopularity.findIndex((c) => c.id === card.id);
        return { ...card, localRank: localIndex + 1, nationalRank: nationalIndex + 1, lift: nationalIndex - localIndex };
      });
      for (const card of enriched) {
        if (card.affinity !== undefined) ctx.localAffinity.set(card.id, card.affinity);
        ctx.cite(card.id, requestId);
      }
      ctx.remember(enriched);
      return { kind, entities: enriched.slice(0, take), evidence: requestId };
    }),
  );
  return { city: ctx.city, domains };
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

export function summarizeTrend(points: { date: string; percentile: number }[]): TrendSeries {
  if (points.length < 3) return { points, direction: "unknown", changePct: 0 };
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const third = Math.max(1, Math.floor(sorted.length / 3));
  const avg = (xs: typeof sorted) => xs.reduce((s, p) => s + p.percentile, 0) / xs.length;
  const early = avg(sorted.slice(0, third));
  const late = avg(sorted.slice(-third));
  const changePct = early > 0 ? ((late - early) / early) * 100 : 0;
  const direction = changePct > 6 ? "rising" : changePct < -6 ? "cooling" : "steady";
  return { points: sorted, direction, changePct: round(changePct, 1) };
}

export async function profileEntities(ctx: TasteContext, ids: string[], catchmentKm = 16): Promise<EntityProfile[]> {
  const unique = [...new Set(ids)].slice(0, 6);
  await ensureCards(ctx, unique);

  const demoPromise = qlooGet<RawInsights>(
    "/v2/insights",
    { "filter.type": "urn:demographics", "signal.interests.entities": unique.join(",") },
    ctx.recorder,
    "Aggregate age and gender affinity of each fandom",
  ).catch(() => undefined);

  const end = new Date();
  const start = new Date(end.getTime() - 16 * 7 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const perEntity = await Promise.all(
    unique.map(async (id) => {
      const card = ctx.cards.get(id);
      const kind = card?.kind ?? "movie";
      const [trend, heat, tags] = await Promise.all([
        qlooGet<RawInsights>(
          "/v2/trending",
          {
            "filter.type": KIND_URN[kind],
            "signal.interests.entities": id,
            "filter.start_date": iso(start),
            "filter.end_date": iso(end),
          },
          ctx.recorder,
          `Is interest in ${card?.name ?? id} rising or cooling?`,
        ).catch(() => undefined),
        qlooGet<RawInsights>(
          "/v2/insights",
          {
            "filter.type": "urn:heatmap",
            "signal.interests.entities": id,
            "filter.location": `POINT(${ctx.venue.lon} ${ctx.venue.lat})`,
            "filter.location.radius": 40000,
            take: 200,
          },
          ctx.recorder,
          `Where around ${ctx.venue.name} do ${card?.name ?? id} fans concentrate?`,
        ).catch(() => undefined),
        qlooGet<RawInsights>(
          "/v2/insights",
          { "filter.type": "urn:tag", "signal.interests.entities": id, take: 8 },
          ctx.recorder,
          `Taste tags that describe the ${card?.name ?? id} audience`,
        ).catch(() => undefined),
      ]);
      return { id, card, trend, heat, tags };
    }),
  );
  const demo = await demoPromise;

  return unique.map((id) => {
    const parts = perEntity.find((p) => p.id === id)!;
    const evidence: string[] = [];
    let demographics: Demographics | undefined;
    const demoRow = demo?.body.results?.demographics?.find((d) => d.entity_id === id);
    if (demo && demoRow?.query) {
      evidence.push(demo.requestId);
      demographics = {
        age: Object.fromEntries(AGE_BUCKETS.map((b) => [b, round(demoRow.query?.age?.[b] ?? 0)])),
        gender: { male: round(demoRow.query.gender?.male ?? 0), female: round(demoRow.query.gender?.female ?? 0) },
      };
    }

    let trend: TrendSeries | undefined;
    if (parts.trend) {
      evidence.push(parts.trend.requestId);
      trend = summarizeTrend(
        (parts.trend.body.results?.trending ?? [])
          .filter((p) => p.date && typeof p.population_percentile === "number")
          .map((p) => ({ date: p.date as string, percentile: p.population_percentile as number })),
      );
    }

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
      const ratio = mean(points) > 0 ? mean(near) / mean(points) : 0;
      heat = { points, nearVenueIndex: round(Math.max(0, Math.min(1, ratio / 2))), catchmentKm };
    }

    let tasteTags: string[] | undefined;
    if (parts.tags) {
      evidence.push(parts.tags.requestId);
      tasteTags = (parts.tags.body.results?.tags ?? []).map((t) => t.name ?? "").filter(Boolean);
    }

    evidence.forEach((r) => ctx.cite(id, r));
    const profile: EntityProfile = {
      entity: parts.card ?? { id, name: id, kind: "movie" },
      demographics,
      trend,
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
  const list = Array.isArray(body.results) ? body.results : (body.results?.entities ?? []);
  const cards = list.map((e) => toCard(e));
  ctx.remember(cards);
  cards.forEach((c) => ctx.cite(c.id, requestId));
}

// ---------- 3. Which audience segment does each fandom fit? ----------

const SEGMENT_SIGNAL: Record<Exclude<SegmentId, "families">, string> = {
  gen_z: "24_and_younger",
  young_pros: "25_to_29,30_to_34",
  boomers: "55_and_older",
};

export async function scoreSegmentFit(ctx: TasteContext, ids: string[], segments: SegmentId[]) {
  await ensureCards(ctx, ids);
  const byKind = new Map<EntityKind, string[]>();
  for (const id of new Set(ids)) {
    const kind = ctx.cards.get(id)?.kind;
    if (!kind) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
  }
  const familiesAudience = segments.includes("families") ? await ctx.familiesAudienceId() : null;

  await Promise.all(
    [...byKind.entries()].flatMap(([kind, kindIds]) =>
      [...new Set(segments)].map(async (segment) => {
        const signal: Record<string, string> =
          segment === "families"
            ? familiesAudience
              ? { "signal.demographics.audiences": familiesAudience }
              : { "signal.demographics.age": "35_to_44" }
            : { "signal.demographics.age": SEGMENT_SIGNAL[segment] };
        const { cards, requestId } = await insightsEntities(
          ctx,
          kind,
          {
            ...signal,
            "signal.location.query": ctx.city,
            "filter.results.entities": kindIds.join(","),
            take: kindIds.length,
          },
          `Score ${kindIds.length} ${kind.replace("_", " ")} fandom(s) for the ${segment.replace("_", " ")} segment in ${ctx.city}`,
        ).catch(() => ({ cards: [] as EntityCard[], requestId: "" }));
        for (const card of cards) {
          if (card.affinity === undefined) continue;
          ctx.segmentFit.set(card.id, { ...ctx.segmentFit.get(card.id), [segment]: card.affinity });
          if (requestId) ctx.cite(card.id, requestId);
        }
      }),
    ),
  );

  return ids.map((id) => ({ entity: ctx.cards.get(id)!, fit: ctx.segmentFit.get(id) ?? {} })).filter((r) => r.entity);
}

// ---------- 4. Does this theme bring NEW fans, or the ones we already have? ----------

const FANBASE_PROXIES: Record<string, string[]> = {
  baseball: ["MLB The Show", "Major League Baseball"],
  basketball: ["NBA 2K", "National Basketball Association"],
  hockey: ["NHL", "National Hockey League"],
  soccer: ["EA Sports FC", "Major League Soccer"],
  football: ["Madden NFL", "National Football League"],
};

export async function fanbaseOverlap(ctx: TasteContext, sport: string, ids: string[]) {
  const proxies: EntityCard[] = [];
  for (const query of FANBASE_PROXIES[sport] ?? []) {
    const found = await searchEntities(ctx, query, ["videogame", "brand", "tv_show"], 1).catch(() => []);
    if (found[0]) proxies.push(found[0]);
    if (proxies.length) break;
  }
  if (!proxies.length) return { proxy: null as EntityCard | null, overlap: new Map<string, number>() };

  const byKind = new Map<EntityKind, string[]>();
  for (const id of new Set(ids)) {
    const kind = ctx.cards.get(id)?.kind;
    if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
  }
  await Promise.all(
    [...byKind.entries()].map(async ([kind, kindIds]) => {
      const { cards, requestId } = await insightsEntities(
        ctx,
        kind,
        {
          "signal.interests.entities": proxies.map((p) => p.id).join(","),
          "filter.results.entities": kindIds.join(","),
          take: kindIds.length,
        },
        `How much do existing ${sport} fans (proxy: ${proxies[0].name}) already like these fandoms?`,
      ).catch(() => ({ cards: [] as EntityCard[], requestId: "" }));
      for (const card of cards) {
        if (card.affinity === undefined) continue;
        ctx.fanOverlap.set(card.id, card.affinity);
        if (requestId) ctx.cite(card.id, requestId);
      }
    }),
  );
  return { proxy: proxies[0], overlap: ctx.fanOverlap };
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

// ---------- 5. Sponsors, playlist, local partners, media partners ----------

export async function findSponsors(ctx: TasteContext, anchorIds: string[], categories: string[] = []) {
  const { cards, requestId } = await insightsEntities(
    ctx,
    "brand",
    {
      "signal.interests.entities": anchorIds.join(","),
      "signal.location.query": ctx.city,
      "signal.location.weight": "low",
      "feature.explainability": true,
      take: 30,
    },
    "Brands whose audiences share this fandom's taste (sponsor prospects)",
  );
  ctx.remember(cards);
  cards.forEach((c) => ctx.cite(c.id, requestId));
  const wanted = categories.map((c) => c.toLowerCase());
  const matches = (c: EntityCard) =>
    !wanted.length || (c.industries ?? []).some((i) => wanted.some((w) => i.toLowerCase().includes(w) || w.includes(i.toLowerCase())));
  const preferred = cards.filter(matches);
  const rest = cards.filter((c) => !matches(c));
  return { brands: [...preferred, ...rest].slice(0, 10), requestId };
}

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
        take: 12,
      },
      `Places near ${ctx.venue.name} this fandom over-indexes on (local partners)`,
    ).catch(() => ({ cards: [] as EntityCard[], requestId: "" })),
    insightsEntities(
      ctx,
      "podcast",
      { "signal.interests.entities": signal, take: 8 },
      "Podcasts this fandom listens to (media partners)",
    ).catch(() => ({ cards: [] as EntityCard[], requestId: "" })),
  ]);
  for (const group of [artists, places, podcasts]) {
    ctx.remember(group.cards);
    if (group.requestId) group.cards.forEach((c) => ctx.cite(c.id, group.requestId));
  }
  anchorIds.forEach((id) => [artists, places, podcasts].forEach((g) => g.requestId && ctx.cite(id, g.requestId)));
  return { artists: artists.cards, places: places.cards, podcasts: podcasts.cards };
}

// ---------- 6. Resolve names to Qloo entities ----------

export async function searchEntities(ctx: TasteContext, query: string, kinds: EntityKind[] = [], take = 5) {
  const { body, requestId } = await qlooGet<RawSearch>(
    "/search",
    { query, types: kinds.map((k) => KIND_URN[k]).join(","), take },
    ctx.recorder,
    `Resolve "${query}" to a Qloo entity`,
  );
  const list = Array.isArray(body.results) ? body.results : (body.results?.entities ?? []);
  const cards = list.map((e) => toCard(e));
  ctx.remember(cards);
  cards.forEach((c) => ctx.cite(c.id, requestId));
  return cards;
}

/** Score arbitrary named themes against the city — used to fact-check an LLM-only plan. */
export async function localAffinityFor(ctx: TasteContext, ids: string[]) {
  const byKind = new Map<EntityKind, string[]>();
  for (const id of ids) {
    const kind = ctx.cards.get(id)?.kind;
    if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
  }
  await Promise.all(
    [...byKind.entries()].map(async ([kind, kindIds]) => {
      const { cards, requestId } = await insightsEntities(
        ctx,
        kind,
        { "signal.location.query": ctx.city, "filter.results.entities": kindIds.join(","), take: kindIds.length },
        `Local affinity of ${kindIds.length} ${kind.replace("_", " ")}(s) in ${ctx.city}`,
      ).catch(() => ({ cards: [] as EntityCard[], requestId: "" }));
      for (const card of cards) {
        if (card.affinity !== undefined) ctx.localAffinity.set(card.id, card.affinity);
        if (requestId) ctx.cite(card.id, requestId);
      }
    }),
  );
  return ids.map((id) => ({ id, affinity: ctx.localAffinity.get(id) }));
}
