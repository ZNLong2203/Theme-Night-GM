// Deterministic stand-in for the Qloo API, used only when QLOO_API_KEY is not set.
// Responses follow the documented envelope shapes so the rest of the app is identical in both modes.
import { CITY_REGIONS, MOCK_CATALOG, MOCK_PLACE_PARTS, type MockItem } from "./mock-data";

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniform 0..1 from a string seed. */
const rand = (seed: string) => (hash(seed) % 100000) / 100000;

export function mockId(name: string): string {
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const a = hex(hash(`a:${name}`));
  const b = hex(hash(`b:${name}`));
  const c = hex(hash(`c:${name}`));
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c}${a.slice(0, 4)}`.toUpperCase();
}

const KIND_URN: Record<MockItem["kind"], string> = {
  movie: "urn:entity:movie",
  tv_show: "urn:entity:tv_show",
  artist: "urn:entity:artist",
  videogame: "urn:entity:videogame",
  podcast: "urn:entity:podcast",
  book: "urn:entity:book",
  brand: "urn:entity:brand",
};

const byId = new Map(MOCK_CATALOG.map((item) => [mockId(item.name), item]));

function regionsFor(location?: string): string[] {
  if (!location) return [];
  return CITY_REGIONS.filter((r) => r.match.test(location)).flatMap((r) => r.regions);
}

function parsePoint(value?: string): { lat: number; lon: number } | undefined {
  if (!value) return undefined;
  const wkt = value.match(/POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
  if (wkt) return { lon: Number(wkt[1]), lat: Number(wkt[2]) };
  const pair = value.match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
  if (pair) return { lat: Number(pair[1]), lon: Number(pair[2]) };
  return undefined;
}

const AGE_SKEW: Record<string, number> = {
  "24_and_younger": 1,
  "25_to_29": 0.6,
  "30_to_34": 0.25,
  "35_to_44": -0.1,
  "45_to_54": -0.5,
  "55_and_older": -1,
};

function entityJson(item: MockItem, affinity: number | null) {
  return {
    name: item.name,
    entity_id: mockId(item.name),
    type: "urn:entity",
    subtype: KIND_URN[item.kind],
    popularity: item.pop,
    properties: {
      ...(item.year ? { release_year: item.year } : {}),
      ...(item.kind === "movie" || item.kind === "tv_show" ? { production_companies: item.owners } : {}),
      ...(item.kind === "videogame" ? { publisher: item.owners?.join(", ") } : {}),
      ...(item.industries ? { industries: item.industries } : {}),
      short_description: `${item.tags.join(" · ")}`,
    },
    tags: item.tags.map((t) => ({
      id: `urn:tag:keyword:qloo:${t.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: t,
      type: "urn:tag:keyword:qloo",
    })),
    query: affinity === null ? {} : { affinity: Number(affinity.toFixed(4)) },
  };
}

function scoreItem(item: MockItem, q: Record<string, string>): number {
  const location = q["signal.location.query"] ?? q["filter.location.query"];
  const regions = regionsFor(location);
  const seed = `${location ?? ""}|${q["signal.interests.entities"] ?? ""}|${q["signal.demographics.age"] ?? ""}|${q["signal.demographics.audiences"] ?? ""}`;
  let score = 0.45 + 0.25 * rand(`${seed}|${item.name}`) + 0.15 * item.pop;
  if (item.regions?.some((r) => regions.includes(r))) score += 0.28;
  const ages = q["signal.demographics.age"]?.split(",") ?? [];
  if (ages.length) {
    const skew = ages.reduce((s, a) => s + (AGE_SKEW[a] ?? 0), 0) / ages.length;
    score += 0.22 * skew * item.age;
  }
  if (q["signal.demographics.audiences"]?.includes("parent")) score += item.family ? 0.25 : -0.12;
  const signalIds = q["signal.interests.entities"]?.split(",") ?? [];
  for (const id of signalIds) {
    const source = byId.get(id);
    if (!source) continue;
    const shared = source.tags.filter((t) => item.tags.includes(t)).length;
    score += 0.08 * shared + 0.18 * (1 - Math.abs(source.age - item.age) / 2);
    if (source.regions && item.regions?.some((r) => source.regions?.includes(r))) score += 0.05;
  }
  score += 0.06 * item.trend;
  return Math.max(0.01, Math.min(0.999, score / 1.25));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const industryTag = (industry: string) => `urn:tag:industry:qloo:${slug(industry)}`;
/** Category phrases the app searches with that don't share a word with the mock industry names. */
const TAG_ALIASES: Record<string, string> = { "fast food": "Quick Service Restaurants", "soft drinks": "Soft Drinks" };

/** /v2/tags: resolve a phrase to the industry tags the mock brands carry. */
function tagSearch(q: Record<string, string>) {
  const term = (q["filter.query"] ?? "").toLowerCase().trim();
  const industries = [...new Set(MOCK_CATALOG.flatMap((i) => i.industries ?? []))];
  const alias = TAG_ALIASES[term];
  const stem = term.replace(/s$/, "");
  const hits = industries.filter((name) => name === alias || (stem.length > 2 && name.toLowerCase().includes(stem)));
  return {
    success: true,
    results: { tags: hits.slice(0, Number(q.take ?? 8)).map((name) => ({ id: industryTag(name), name, type: "urn:tag:industry:qloo" })) },
  };
}

function insightsEntities(type: string, q: Record<string, string>) {
  const take = Number(q.take ?? 20);
  const location = q["signal.location.query"];
  // Like the live API, echo how the location signal was resolved.
  const query = location ? { localities: { signal: { name: location, disambiguation: `${location} (simulated)` } } } : undefined;
  if (type === "urn:entity:place") return { success: true, results: { entities: mockPlaces(q, take) }, query };
  const kind = (Object.keys(KIND_URN) as MockItem["kind"][]).find((k) => KIND_URN[k] === type);
  let pool = MOCK_CATALOG.filter((i) => i.kind === kind);
  const minPop = Number(q["filter.popularity.min"] ?? 0);
  if (minPop > 0) pool = pool.filter((i) => i.pop >= minPop);
  const tags = q["filter.tags"]?.split(",");
  if (tags) pool = pool.filter((i) => (i.industries ?? []).some((name) => tags.includes(industryTag(name))));
  const excludeTags = q["filter.exclude.tags"]?.split(",") ?? [];
  pool = pool.filter((i) => !(i.industries ?? []).some((name) => excludeTags.includes(industryTag(name))));
  const shortlist = q["filter.results.entities"]?.split(",");
  if (shortlist) pool = pool.filter((i) => shortlist.includes(mockId(i.name)));
  const exclude = q["filter.exclude.entities"]?.split(",") ?? [];
  pool = pool.filter((i) => !exclude.includes(mockId(i.name)));
  const signalIds = q["signal.interests.entities"]?.split(",") ?? [];
  pool = pool.filter((i) => !signalIds.includes(mockId(i.name)));
  const hasSignal = Object.keys(q).some((k) => k.startsWith("signal."));
  const scored = pool
    .map((item) => ({ item, affinity: hasSignal ? scoreItem(item, q) : null }))
    .sort((a, b) => (b.affinity ?? b.item.pop) - (a.affinity ?? a.item.pop))
    .slice(0, take);
  return { success: true, results: { entities: scored.map(({ item, affinity }) => entityJson(item, affinity)) }, query };
}

function mockPlaces(q: Record<string, string>, take: number) {
  const center = parsePoint(q["filter.location"]) ?? { lat: 35.9916, lon: -78.9045 };
  const seed = `${q["filter.location"]}|${q["signal.interests.entities"]}`;
  const { prefixes, types } = MOCK_PLACE_PARTS;
  return Array.from({ length: Math.min(take, 12) }, (_, i) => {
    const prefix = prefixes[hash(`${seed}|p${i}`) % prefixes.length];
    const type = types[hash(`${seed}|t${i}`) % types.length];
    const name = `${prefix} ${type.noun}`;
    const angle = rand(`${seed}|a${i}`) * Math.PI * 2;
    const km = 0.3 + rand(`${seed}|d${i}`) * 3.5;
    const lat = center.lat + (km / 111) * Math.sin(angle);
    const lon = center.lon + (km / (111 * Math.cos((center.lat * Math.PI) / 180))) * Math.cos(angle);
    return {
      name,
      entity_id: mockId(`${name}|${center.lat.toFixed(2)}`),
      type: "urn:entity",
      subtype: "urn:entity:place",
      popularity: 0.5 + 0.4 * rand(`${seed}|pop${i}`),
      properties: {
        address: `${100 + (hash(name) % 800)} Main St`,
        geocode: { city: "Simulated City" },
        latitude: lat,
        longitude: lon,
        business_rating: Number((3.8 + rand(`${seed}|r${i}`) * 1.1).toFixed(1)),
        price_level: 1 + (hash(`${seed}|$${i}`) % 3),
      },
      tags: [{ id: `urn:tag:genre:place:${type.tag.toLowerCase().replace(/\s+/g, "_")}`, name: type.tag, type: "urn:tag:genre:place" }],
      query: { affinity: Number((0.92 - i * 0.04).toFixed(3)), distance: Math.round(km * 1000) },
    };
  });
}

function heatmap(q: Record<string, string>) {
  const center = parsePoint(q["filter.location"]) ?? { lat: 35.9916, lon: -78.9045 };
  const entity = q["signal.interests.entities"] ?? q["signal.interests.tags"] ?? "x";
  const blobs = Array.from({ length: 4 }, (_, i) => ({
    dLat: (rand(`${entity}|by${i}`) - 0.5) * 0.4,
    dLon: (rand(`${entity}|bx${i}`) - 0.5) * 0.45,
    w: 0.4 + rand(`${entity}|bw${i}`) * 0.6,
    s: 0.03 + rand(`${entity}|bs${i}`) * 0.05,
  }));
  const cells: { location: { latitude: number; longitude: number; geohash: string }; query: { affinity: number; affinity_rank: number; popularity: number } }[] = [];
  const step = 0.018;
  for (let y = -13; y <= 13; y++) {
    for (let x = -14; x <= 14; x++) {
      const lat = center.lat + y * step;
      const lon = center.lon + x * step * 1.2;
      const value = blobs.reduce(
        (sum, b) => sum + b.w * Math.exp(-(((lat - center.lat - b.dLat) ** 2 + (lon - center.lon - b.dLon) ** 2) / (2 * b.s ** 2))),
        0,
      );
      if (value < 0.08) continue;
      cells.push({
        location: { latitude: Number(lat.toFixed(5)), longitude: Number(lon.toFixed(5)), geohash: `sim${x}_${y}` },
        query: { affinity: Math.min(1, value), affinity_rank: 0, popularity: Math.min(1, 0.3 + rand(`${x},${y}`) * 0.6) },
      });
    }
  }
  cells.sort((a, b) => b.query.affinity - a.query.affinity);
  cells.forEach((c, i) => (c.query.affinity_rank = Number((1 - i / cells.length).toFixed(4))));
  // The live heatmap ignores `take` and returns every cell (LA: 2,741), so the mock does too.
  return { success: true, results: { heatmap: cells } };
}

function demographics(q: Record<string, string>) {
  const ids = q["signal.interests.entities"]?.split(",") ?? [];
  return {
    success: true,
    results: {
      demographics: ids.map((id) => {
        const item = byId.get(id);
        const age = item?.age ?? 0;
        const gender = item?.gender ?? 0;
        const noise = (k: string) => (rand(`${id}|${k}`) - 0.5) * 0.12;
        const bucket = (skew: number, k: string) => Number(Math.max(-1, Math.min(1, age * skew * 0.6 + noise(k))).toFixed(3));
        return {
          entity_id: id,
          query: {
            age: {
              "24_and_younger": bucket(1, "a1"),
              "25_to_29": bucket(0.6, "a2"),
              "30_to_34": bucket(0.2, "a3") + (item?.family ? 0.12 : 0),
              "35_to_44": bucket(-0.2, "a4") + (item?.family ? 0.2 : 0),
              "45_to_54": bucket(-0.6, "a5"),
              "55_and_older": bucket(-1, "a6"),
            },
            gender: { male: Number((-gender * 0.5).toFixed(3)), female: Number((gender * 0.5).toFixed(3)) },
          },
        };
      }),
    },
  };
}

function tasteTags(q: Record<string, string>) {
  const ids = q["signal.interests.entities"]?.split(",") ?? [];
  const items = ids.map((id) => byId.get(id)).filter(Boolean) as MockItem[];
  const neighbours = MOCK_CATALOG.filter((i) => items.some((s) => s.tags.some((t) => i.tags.includes(t)) && s !== i));
  const names = [...new Set([...items.flatMap((i) => i.tags), ...neighbours.flatMap((i) => i.tags)])];
  return {
    success: true,
    results: {
      tags: names.slice(0, Number(q.take ?? 10)).map((name, i) => ({
        tag_id: `urn:tag:keyword:qloo:${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        name,
        types: ["urn:entity:movie"],
        subtype: "urn:tag:keyword:qloo",
        query: { affinity: Number((0.98 - i * 0.05).toFixed(3)) },
      })),
    },
  };
}

function trending(q: Record<string, string>) {
  const id = q["signal.interests.entities"] ?? "";
  const item = byId.get(id);
  const end = new Date(q["filter.end_date"] ?? Date.now());
  const points = [];
  let level = 40 + rand(`${id}|lvl`) * 40;
  for (let w = 15; w >= 0; w--) {
    const date = new Date(end.getTime() - w * 7 * 86400000).toISOString().slice(0, 10);
    level = Math.max(1, Math.min(99.9, level + (item?.trend ?? 0) * 2.2 + (rand(`${id}|w${w}`) - 0.5) * 4));
    points.push({ date, population_percentile: Number(level.toFixed(2)), population_rank: Math.round((100 - level) * 40), velocity_fold_change: 1 });
  }
  return { success: true, results: { trending: points.reverse() } };
}

function compare(q: Record<string, string>) {
  const a = (q["a.signal.interests.entities"] ?? "").split(",").map((id) => byId.get(id)).filter(Boolean) as MockItem[];
  const b = (q["b.signal.interests.entities"] ?? "").split(",").map((id) => byId.get(id)).filter(Boolean) as MockItem[];
  const tags = [...new Set([...a, ...b].flatMap((i) => i.tags))];
  return {
    duration: 1,
    results: {
      tags: tags.slice(0, Number(q.take ?? 10)).map((name) => ({
        tag_id: `urn:tag:keyword:qloo:${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        name,
        subtype: "urn:tag:keyword:qloo",
        popularity: 0.8,
        query: { score: Number((rand(`${name}|cmp`) * 0.9 + 0.05).toFixed(3)) },
      })),
    },
  };
}

function search(q: Record<string, string>) {
  const term = (q.query ?? "").toLowerCase();
  const types = q.types?.split(",") ?? [];
  const results = MOCK_CATALOG.filter((i) => (!types.length || types.includes(KIND_URN[i.kind])) && i.name.toLowerCase().includes(term))
    .slice(0, Number(q.take ?? 5))
    .map((item) => ({ ...entityJson(item, null), types: [KIND_URN[item.kind]] }));
  return { success: true, results };
}

function audiences(q: Record<string, string>) {
  const term = (q["filter.query"] ?? "").toLowerCase();
  const all = [
    { id: "urn:audience:life_stage:parents_with_young_children", name: "Parents With Young Children", type: "urn:audience:life_stage" },
    { id: "urn:audience:life_stage:parents", name: "Parents", type: "urn:audience:life_stage" },
    { id: "urn:audience:hobbies_and_interests:sports_fans", name: "Sports Fans", type: "urn:audience:hobbies_and_interests" },
  ];
  return { success: true, results: { audiences: all.filter((a) => a.name.toLowerCase().includes(term.split(" ")[0] ?? "")) } };
}

export async function mockQloo(path: string, q: Record<string, string>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 60 + (hash(JSON.stringify(q)) % 140)));
  switch (path) {
    case "/v2/insights": {
      const type = q["filter.type"];
      if (type === "urn:heatmap") return heatmap(q);
      if (type === "urn:demographics") return demographics(q);
      if (type === "urn:tag") return tasteTags(q);
      return insightsEntities(type, q);
    }
    case "/v2/trending":
      return trending(q);
    case "/v2/analysis/compare":
      return compare(q);
    case "/search":
      return search(q);
    case "/v2/audiences":
      return audiences(q);
    case "/v2/tags":
      return tagSearch(q);
    case "/entities": {
      const ids = (q.entity_ids ?? "").split(",");
      return { success: true, results: ids.map((id) => byId.get(id)).filter(Boolean).map((i) => entityJson(i as MockItem, null)) };
    }
    default:
      return { success: true, results: [] };
  }
}
