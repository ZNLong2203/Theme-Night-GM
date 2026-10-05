import "server-only";
import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import {
  buildExperience,
  crossoverTags,
  fanbaseOverlap,
  findSponsors,
  profileEntities,
  scanMarket,
  scoreSegmentFit,
  searchEntities,
  type TasteContext,
} from "@/lib/qloo/workflows";
import { toolCallScope } from "@/lib/qloo/client";
import { computeScore } from "@/lib/scoring";
import type { AgentEvent, EntityCard, EntityKind, GameDate, RunMode, SegmentId, TeamConfig, ToolUIData } from "@/lib/types";
import { assemblePlan, PlanSubmission, type PlanSubmissionT } from "./assemble";

export interface RunContext {
  taste: TasteContext;
  team: TeamConfig;
  targets: GameDate[];
  mode: RunMode;
  emit: (event: AgentEvent) => void;
  submitted?: boolean;
  fanbaseChecked?: boolean;
}

export interface ToolOutcome {
  output: unknown;
  summary: string;
  ui?: ToolUIData;
}

interface ToolDef<A> {
  declaration: FunctionDeclaration;
  schema: z.ZodType<A>;
  label: (args: A) => string;
  execute: (args: A, run: RunContext) => Promise<ToolOutcome>;
}

const SCAN_KINDS = ["movie", "tv_show", "artist", "videogame", "podcast", "book"] as const;
const SEGMENT_IDS = ["families", "gen_z", "young_pros", "boomers"] as const;

const compact = (c: EntityCard) => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  ...(c.affinity !== undefined ? { affinity: c.affinity } : {}),
  ...(c.popularity !== undefined ? { popularity: c.popularity } : {}),
  ...(c.lift !== undefined ? { local_lift: c.lift, local_rank: c.localRank, national_rank: c.nationalRank } : {}),
  ...(c.year ? { year: c.year } : {}),
  ...(c.industries?.length ? { industries: c.industries } : {}),
  ...(c.tags?.length ? { tags: c.tags.slice(0, 4) } : {}),
});

/** Accept an ID or (as a fallback the model sometimes needs) an exact entity name. */
export function resolveId(run: RunContext, ref: string): string | undefined {
  if (run.taste.cards.has(ref)) return ref;
  const lower = ref.trim().toLowerCase();
  for (const card of run.taste.cards.values()) if (card.name.toLowerCase() === lower) return card.id;
  return undefined;
}

const ids = (run: RunContext, refs: string[]) => refs.map((r) => resolveId(run, r) ?? r);

// ---------------------------------------------------------------------------

const scanMarketTool: ToolDef<{ kinds: (typeof SCAN_KINDS)[number][]; min_popularity?: number }> = {
  declaration: {
    name: "scan_market_taste",
    description:
      "Read the room: for the team's city, ask Qloo which fandoms (movies, TV, artists, video games, podcasts, books) the local audience has the strongest affinity for. Returns each entity's local affinity plus local_lift = how many places higher it ranks locally than by national popularity (positive = the city over-indexes). Call this first.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        kinds: { type: "array", items: { type: "string", enum: [...SCAN_KINDS] }, description: "Domains to scan. Use at least 4." },
        min_popularity: {
          type: "number",
          description: "0-1 national popularity floor so themes are recognizable. Default 0.7; lower it for niche markets.",
        },
      },
      required: ["kinds"],
    },
  },
  schema: z.object({ kinds: z.array(z.enum(SCAN_KINDS)).min(1), min_popularity: z.number().min(0).max(1).optional() }),
  label: (a) => `Scanning ${a.kinds.length} culture domains for local affinity`,
  async execute(args, run) {
    const scan = await scanMarket(run.taste, args.kinds as EntityKind[], 10, args.min_popularity ?? 0.7);
    const total = scan.domains.reduce((n, d) => n + d.entities.length, 0);
    const topLift = scan.domains
      .flatMap((d) => d.entities)
      .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))
      .slice(0, 3)
      .map((e) => e.name);
    return {
      output: {
        city: scan.city,
        domains: scan.domains.map((d) => ({ kind: d.kind, evidence: d.evidence, entities: d.entities.map(compact) })),
      },
      summary: `${total} fandoms scored for ${scan.city}. Biggest local over-index: ${topLift.join(", ") || "n/a"}.`,
      ui: { kind: "market_scan", scan },
    };
  },
};

const profileTool: ToolDef<{ entity_ids: string[] }> = {
  declaration: {
    name: "profile_fandoms",
    description:
      "Deep-dive up to 6 candidate fandoms: aggregate age/gender affinity (urn:demographics), 16-week trend (/v2/trending), heatmap of where fans concentrate around the venue (urn:heatmap → near_venue_index 0-1, 0.5 = metro average), and taste tags (urn:tag).",
    parametersJsonSchema: {
      type: "object",
      properties: { entity_ids: { type: "array", items: { type: "string" }, description: "Qloo entity IDs (max 6)." } },
      required: ["entity_ids"],
    },
  },
  schema: z.object({ entity_ids: z.array(z.string()).min(1) }),
  label: (a) => `Profiling ${a.entity_ids.length} fandoms (demographics · trend · heatmap)`,
  async execute(args, run) {
    const profiles = await profileEntities(run.taste, ids(run, args.entity_ids).slice(0, 6));
    return {
      output: profiles.map((p) => {
        const age = p.demographics?.age ?? {};
        const topAges = Object.entries(age)
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .slice(0, 2)
          .map(([k, v]) => `${k} (${(v ?? 0) > 0 ? "+" : ""}${v})`);
        return {
          id: p.entity.id,
          name: p.entity.name,
          strongest_age_affinity: topAges,
          gender_skew: p.demographics?.gender,
          trend: p.trend ? `${p.trend.direction} (${p.trend.changePct > 0 ? "+" : ""}${p.trend.changePct}% over 16 weeks)` : "n/a",
          near_venue_index: p.heat?.nearVenueIndex ?? null,
          taste_tags: p.tasteTags?.slice(0, 6),
          evidence: p.evidence,
        };
      }),
      summary: profiles
        .map((p) => `${p.entity.name}: ${p.trend?.direction ?? "?"} · venue index ${p.heat?.nearVenueIndex ?? "?"}`)
        .join(" | "),
      ui: { kind: "profiles", profiles },
    };
  },
};

const fitTool: ToolDef<{ entity_ids: string[]; segments: SegmentId[] }> = {
  declaration: {
    name: "score_audience_fit",
    description:
      "Score a shortlist of fandoms for each audience segment the schedule needs (families, gen_z, young_pros, boomers) using Qloo demographic/audience signals plus the city location signal. Also measures overlap with the sport's existing fan base, then returns a provisional Taste Fit Score (0-100) for every fandom x segment. Use this to decide which fandom goes on which date.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        entity_ids: { type: "array", items: { type: "string" }, description: "Up to 14 candidate entity IDs." },
        segments: { type: "array", items: { type: "string", enum: [...SEGMENT_IDS] } },
      },
      required: ["entity_ids", "segments"],
    },
  },
  schema: z.object({ entity_ids: z.array(z.string()).min(1), segments: z.array(z.enum(SEGMENT_IDS)).min(1) }),
  label: (a) => `Scoring ${a.entity_ids.length} fandoms × ${a.segments.length} audience segments`,
  async execute(args, run) {
    const resolved = ids(run, args.entity_ids).slice(0, 14);
    const rows = await scoreSegmentFit(run.taste, resolved, args.segments);
    let proxyName: string | undefined;
    if (!run.fanbaseChecked) {
      const { proxy } = await fanbaseOverlap(run.taste, run.team.sport, resolved);
      proxyName = proxy?.name;
      run.fanbaseChecked = true;
    } else {
      const missing = resolved.filter((id) => !run.taste.fanOverlap.has(id));
      if (missing.length) await fanbaseOverlap(run.taste, run.team.sport, missing);
    }
    const output = rows.map(({ entity, fit }) => ({
      id: entity.id,
      name: entity.name,
      segment_affinity: fit,
      existing_fan_overlap: run.taste.fanOverlap.get(entity.id) ?? null,
      taste_fit_score: Object.fromEntries(
        args.segments.map((segment) => [
          segment,
          computeScore({
            entity,
            segment,
            localAffinity: run.taste.localAffinity.get(entity.id),
            profile: run.taste.profiles.get(entity.id),
            segmentFit: fit,
            fanOverlap: run.taste.fanOverlap.get(entity.id),
          }).total,
        ]),
      ),
    }));
    return {
      output: { fanbase_proxy: proxyName, rows: output },
      summary: `Scored ${rows.length} fandoms for ${args.segments.join(", ")}${proxyName ? ` · fan-base proxy: ${proxyName}` : ""}.`,
      ui: { kind: "fit_matrix", rows },
    };
  },
};

const sponsorTool: ToolDef<{ anchor_entity_ids: string[]; categories?: string[] }> = {
  declaration: {
    name: "find_sponsors",
    description:
      "Find brands whose Qloo audience shares this theme's taste — the sponsor prospects for that night. Optionally prefer industries (e.g. Beverages, Restaurants, Automotive). Returns brands with affinity and industries.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        anchor_entity_ids: { type: "array", items: { type: "string" }, description: "The night's anchor fandom ID (+ up to 2 supporting IDs)." },
        categories: { type: "array", items: { type: "string" } },
      },
      required: ["anchor_entity_ids"],
    },
  },
  schema: z.object({ anchor_entity_ids: z.array(z.string()).min(1), categories: z.array(z.string()).optional() }),
  label: (a) => `Finding sponsor brands that share the taste of ${a.anchor_entity_ids.length} fandom(s)`,
  async execute(args, run) {
    const anchors = ids(run, args.anchor_entity_ids).slice(0, 3);
    const { brands } = await findSponsors(run.taste, anchors, args.categories ?? run.team.sponsorCategories);
    const anchorName = run.taste.cards.get(anchors[0])?.name ?? anchors[0];
    return {
      output: brands.map(compact),
      summary: `${brands.length} sponsor prospects for ${anchorName}: ${brands.slice(0, 4).map((b) => b.name).join(", ")}.`,
      ui: { kind: "sponsors", anchor: anchorName, brands },
    };
  },
};

const experienceTool: ToolDef<{ anchor_entity_ids: string[] }> = {
  declaration: {
    name: "build_night_experience",
    description:
      "For a theme night, get (1) artists this fandom loves locally — the in-game DJ playlist, (2) places within ~6 km of the venue the fandom over-indexes on — local partners for pre-game parties or concession collabs, (3) podcasts the fandom listens to — media partners.",
    parametersJsonSchema: {
      type: "object",
      properties: { anchor_entity_ids: { type: "array", items: { type: "string" } } },
      required: ["anchor_entity_ids"],
    },
  },
  schema: z.object({ anchor_entity_ids: z.array(z.string()).min(1) }),
  label: () => "Building the night: playlist, nearby partners, media partners",
  async execute(args, run) {
    const anchors = ids(run, args.anchor_entity_ids).slice(0, 3);
    const exp = await buildExperience(run.taste, anchors);
    const anchorName = run.taste.cards.get(anchors[0])?.name ?? anchors[0];
    return {
      output: {
        playlist_artists: exp.artists.slice(0, 10).map(compact),
        nearby_places: exp.places.slice(0, 8).map((p) => ({ ...compact(p), address: p.address })),
        podcasts: exp.podcasts.slice(0, 6).map(compact),
      },
      summary: `${exp.artists.length} artists · ${exp.places.length} nearby places · ${exp.podcasts.length} podcasts for ${anchorName}.`,
      ui: { kind: "experience", anchor: anchorName, ...exp },
    };
  },
};

const compareTool: ToolDef<{ a_entity_ids: string[]; b_entity_ids: string[] }> = {
  declaration: {
    name: "compare_fanbases",
    description:
      "Compare two groups of entities with Qloo's audience comparison (/v2/analysis/compare) to find the taste tags that bridge them — e.g. a theme fandom vs the sport's fan base — useful for activations and copy that feel native to both.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        a_entity_ids: { type: "array", items: { type: "string" } },
        b_entity_ids: { type: "array", items: { type: "string" } },
      },
      required: ["a_entity_ids", "b_entity_ids"],
    },
  },
  schema: z.object({ a_entity_ids: z.array(z.string()).min(1), b_entity_ids: z.array(z.string()).min(1) }),
  label: () => "Comparing two fan bases for crossover hooks",
  async execute(args, run) {
    const a = ids(run, args.a_entity_ids);
    const b = ids(run, args.b_entity_ids);
    const { tags, requestId } = await crossoverTags(run.taste, a, b);
    const name = (list: string[]) => list.map((id) => run.taste.cards.get(id)?.name ?? id).join(" + ");
    return {
      output: { tags: tags.slice(0, 12), evidence: requestId },
      summary: `${tags.length} bridging tags between ${name(a)} and ${name(b)}.`,
      ui: { kind: "crossover", a: name(a), b: name(b), tags },
    };
  },
};

const searchTool: ToolDef<{ query: string; kinds?: string[] }> = {
  declaration: {
    name: "search_entities",
    description: "Resolve a name (a fandom, brand, artist...) to Qloo entities and IDs. Use when you want to test an idea that wasn't in the scan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        kinds: { type: "array", items: { type: "string", enum: [...SCAN_KINDS, "brand", "place"] } },
      },
      required: ["query"],
    },
  },
  schema: z.object({ query: z.string().min(1), kinds: z.array(z.string()).optional() }),
  label: (a) => `Looking up "${a.query}" in Qloo`,
  async execute(args, run) {
    const results = await searchEntities(run.taste, args.query, (args.kinds ?? []) as EntityKind[], 5);
    return {
      output: results.map(compact),
      summary: results.length ? `Found ${results.map((r) => r.name).join(", ")}.` : `No Qloo entity for "${args.query}".`,
      ui: { kind: "search", results },
    };
  },
};

const submitTool: ToolDef<PlanSubmissionT> = {
  declaration: {
    name: "submit_season_plan",
    description:
      "Submit the finished theme-night plan: exactly one night per target date. Every entity reference must be a Qloo ID returned by an earlier tool call. The server validates IDs and computes the Taste Fit Score; if it returns errors, fix them and submit again.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        market_summary: { type: "string", description: "2-3 sentences: what this market over-indexes on, with numbers." },
        nights: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD, must be one of the target dates." },
              anchor_entity_id: { type: "string" },
              supporting_entity_ids: { type: "array", items: { type: "string" } },
              title: { type: "string", description: "Catchy theme-night name (no trademarked titles if IP policy is ip_light)." },
              tagline: { type: "string" },
              why: { type: "string", description: "2-3 sentences citing the Qloo numbers (affinity, lift, trend, venue index, segment fit)." },
              sponsor_picks: {
                type: "array",
                items: {
                  type: "object",
                  properties: { brand_id: { type: "string" }, angle: { type: "string" } },
                  required: ["brand_id", "angle"],
                },
              },
              giveaway: { type: "string" },
              activations: { type: "array", items: { type: "string" } },
              playlist_artist_ids: { type: "array", items: { type: "string" } },
              local_partner_picks: {
                type: "array",
                items: {
                  type: "object",
                  properties: { place_id: { type: "string" }, idea: { type: "string" } },
                  required: ["place_id", "idea"],
                },
              },
              media_partner: {
                type: "object",
                properties: { podcast_id: { type: "string" }, idea: { type: "string" } },
                required: ["podcast_id", "idea"],
              },
              promo: {
                type: "object",
                properties: {
                  headline: { type: "string" },
                  social: { type: "string", description: "One social post, under 280 characters." },
                  email_subject: { type: "string" },
                },
                required: ["headline", "social", "email_subject"],
              },
            },
            required: ["date", "anchor_entity_id", "title", "tagline", "why", "sponsor_picks", "giveaway", "activations", "promo"],
          },
        },
      },
      required: ["market_summary", "nights"],
    },
  },
  schema: PlanSubmission,
  label: (a) => `Submitting ${a.nights.length} theme nights for validation`,
  async execute(args, run) {
    const { plan, errors, warnings } = assemblePlan(run, args);
    if (!plan) {
      return { output: { accepted: false, errors }, summary: `Plan rejected: ${errors.join("; ")}` };
    }
    run.submitted = true;
    run.emit({ type: "plan", plan });
    return {
      output: { accepted: true, warnings, scores: plan.nights.map((n) => ({ date: n.date, title: n.title, score: n.score.total })) },
      summary: `Plan accepted: ${plan.nights.length} nights, avg Taste Fit ${Math.round(plan.nights.reduce((s, n) => s + n.score.total, 0) / plan.nights.length)}.`,
    };
  },
};

export const TOOLS: Record<string, ToolDef<never>> = Object.fromEntries(
  [scanMarketTool, profileTool, fitTool, sponsorTool, experienceTool, compareTool, searchTool, submitTool].map((t) => [
    t.declaration.name,
    t as unknown as ToolDef<never>,
  ]),
);

export const FUNCTION_DECLARATIONS = Object.values(TOOLS).map((t) => t.declaration);

/** Validate arguments, execute, and stream tool_call / tool_result events. */
export async function runTool(name: string, rawArgs: unknown, callId: string, run: RunContext): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) return { error: `Unknown tool ${name}` };
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    run.emit({ type: "tool_call", callId, name, label: `${name} (invalid arguments)`, args: (rawArgs ?? {}) as Record<string, unknown> });
    run.emit({ type: "tool_result", callId, name, ok: false, summary: `Invalid arguments: ${message}` });
    return { error: `Invalid arguments: ${message}` };
  }
  run.emit({ type: "tool_call", callId, name, label: tool.label(parsed.data as never), args: parsed.data as Record<string, unknown> });
  try {
    const outcome = await toolCallScope.run(callId, () => tool.execute(parsed.data as never, run));
    run.emit({ type: "tool_result", callId, name, ok: true, summary: outcome.summary, ui: outcome.ui });
    return outcome.output;
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    run.emit({ type: "tool_result", callId, name, ok: false, summary: message });
    return { error: message };
  }
}
