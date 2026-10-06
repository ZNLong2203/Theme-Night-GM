import { checkRate, clientKey, tooMany } from "@/lib/rate-limit";

// Resolve a city or venue name to coordinates via OpenStreetMap Nominatim. Its usage policy allows at
// most 1 request per second and no bulk use, so lookups are rate-limited per client, spaced 1 s apart
// per instance, cached (bounded), and only served to this site's own pages.
const CACHE_MAX = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_QUEUE_WAIT_MS = 5_000;
const cache = new Map<string, { at: number; body: unknown }>();
let nextStart = 0;

/** Wait for this instance's next 1-per-second Nominatim slot; false if the queue is too long. */
async function nominatimTurn() {
  const start = Math.max(Date.now(), nextStart);
  if (start - Date.now() > MAX_QUEUE_WAIT_MS) return false;
  nextStart = start + 1_000;
  if (start > Date.now()) await new Promise((r) => setTimeout(r, start - Date.now()));
  return true;
}

export async function GET(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return Response.json({ error: "Forbidden" }, { status: 403 });
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2 || q.length > 120) return Response.json({ error: "Query required" }, { status: 400 });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    cache.delete(key); // refresh its LRU position
    cache.set(key, hit);
    return Response.json(hit.body);
  }

  const rate = checkRate(`geocode:${clientKey(request)}`, 30);
  if (!rate.ok) return tooMany("Too many location lookups. Try again in a few minutes.", rate.retryAfter);
  if (!(await nominatimTurn())) return tooMany("Location lookup is busy. Try again in a few seconds.", 5);

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "ThemeNightGM/1.0 (hackathon demo; github.com/ZNLong2203)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response?.ok) return Response.json({ error: "Geocoding unavailable" }, { status: 502 });

  const rows = (await response.json().catch(() => null)) as { display_name: string; lat: string; lon: string; type: string }[] | null;
  if (!Array.isArray(rows)) return Response.json({ error: "Geocoding unavailable" }, { status: 502 });
  const results = rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon), type: r.type }));
  const body = { results, attribution: "© OpenStreetMap contributors" };
  cache.set(key, { at: Date.now(), body });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return Response.json(body);
}
