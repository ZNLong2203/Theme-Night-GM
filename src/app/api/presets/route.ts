import { PRESETS, teamFromPreset } from "@/lib/presets";

export function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug");
  const preset = PRESETS.find((p) => p.slug === slug);
  if (!preset) return Response.json({ presets: PRESETS.map((p) => p.slug) });
  return Response.json(teamFromPreset(preset));
}
