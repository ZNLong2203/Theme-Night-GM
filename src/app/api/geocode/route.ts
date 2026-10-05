// Resolve a city or venue name to coordinates via OpenStreetMap Nominatim (low volume, cached).
const cache = new Map<string, unknown>();

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2 || q.length > 120) return Response.json({ error: "Query required" }, { status: 400 });
  const key = q.toLowerCase();
  if (cache.has(key)) return Response.json(cache.get(key));

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "ThemeNightGM/1.0 (hackathon demo; github.com/ZNLong2203)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response?.ok) return Response.json({ error: "Geocoding unavailable" }, { status: 502 });

  const rows = (await response.json()) as { display_name: string; lat: string; lon: string; type: string }[];
  const results = rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon), type: r.type }));
  const body = { results, attribution: "© OpenStreetMap contributors" };
  cache.set(key, body);
  return Response.json(body);
}
