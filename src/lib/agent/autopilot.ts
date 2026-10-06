import "server-only";
import { scoreIn } from "@/lib/qloo/workflows";
import { SEGMENTS } from "@/lib/schedule";
import { isAlcoholBrand, sensitiveTopic } from "@/lib/sensitivity";
import type { EntityCard, EntityKind, SegmentId } from "@/lib/types";
import type { PlanSubmissionT } from "./assemble";
import { runTool, type RunContext } from "./tools";

type Brand = { id: string; name: string; sponsor_category?: string; industries?: string[] };
const isAlcohol = (b: Brand) => isAlcoholBrand({ name: b.name, category: b.sponsor_category, industries: b.industries });
type Experience = { playlist_artists?: { id: string }[]; nearby_places?: { id: string; name: string }[]; podcasts?: { id: string; name: string }[] };

/**
 * Deterministic planner that drives the same tools as the LLM agent. It runs when no Gemini key is
 * configured and as the safety net when the model misses its deadline. It reuses everything the
 * run has already measured — scans, scores, profiles and the night kits the model built — so a
 * late model still gets its research turned into a plan instead of a restart.
 */
export async function runAutopilot(run: RunContext, opts: { reason?: string } = {}) {
  const { taste, targets, emit } = run;
  let seq = 0;
  const call = (name: string, args: unknown) => runTool(name, args, `auto_${++seq}`, run);
  const think = (text: string) => emit({ type: "thought", text });
  const segments = [...new Set(targets.map((t) => t.segment))] as SegmentId[];
  const safe = (c: EntityCard) => !sensitiveTopic(c) && c.kind !== "brand" && c.kind !== "place";

  if (opts.reason) think(opts.reason);

  if (!taste.pools.size) {
    think(`Reading the room in ${taste.city}: scanning five culture domains for local affinity.`);
    await call("scan_market_taste", { kinds: ["movie", "tv_show", "artist", "videogame", "book"] });
  }

  // Anchors the model already researched come first, then the strongest unscored scan results.
  const researched = [...run.kits.keys()].map((id) => taste.cards.get(id)).filter((c): c is EntityCard => Boolean(c && safe(c)));
  const byKind = new Map<EntityKind, EntityCard[]>();
  for (const id of [...taste.pools.values()].flat()) {
    const card = taste.cards.get(id);
    if (card && safe(card)) byKind.set(card.kind, [...(byKind.get(card.kind) ?? []), card]);
  }
  const fromScan = [...byKind.values()].flatMap((cards) =>
    [...cards]
      // Recognizable AND local: national popularity guards against obscure picks.
      .sort((a, b) => (b.localPct ?? 0) + (b.popularity ?? 0) + 0.02 * (b.lift ?? 0) - ((a.localPct ?? 0) + (a.popularity ?? 0) + 0.02 * (a.lift ?? 0)))
      .slice(0, 2),
  );
  const candidates = [...new Map([...researched, ...fromScan].map((c) => [c.id, c])).values()].slice(0, 14);

  const unscored = candidates.filter((c) => !taste.segmentFit.has(c.id));
  if (unscored.length) {
    think(`Scoring ${unscored.length} candidate fandoms for ${segments.map((s) => SEGMENTS[s].label).join(", ")}.`);
    await call("score_audience_fit", { entity_ids: unscored.map((c) => c.id), segments });
  }

  const best = (card: EntityCard) => Math.max(...segments.map((segment) => scoreIn(taste, card, segment).total));
  const finalists = [...candidates]
    .sort((a, b) => Number(run.kits.has(b.id)) - Number(run.kits.has(a.id)) || best(b) - best(a))
    .slice(0, Math.max(6, targets.length));
  const unprofiled = finalists.filter((c) => !taste.profiles.has(c.id)).slice(0, 6);
  if (unprofiled.length) {
    think(`Profiling ${unprofiled.length} finalist(s): who the fans are, where they live, and whether interest is rising.`);
    await call("profile_fandoms", { entity_ids: unprofiled.map((c) => c.id) });
  }

  // Greedy assignment: each date gets the unused fandom with the best Taste Fit Score for its segment.
  const used = new Set<string>();
  const assignments = [...targets]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((target) => {
      const ranked = finalists
        .filter((c) => !used.has(c.id))
        .map((c) => ({ card: c, score: scoreIn(taste, c, target.segment) }))
        .sort((a, b) => b.score.total - a.score.total);
      const choice = ranked[0];
      if (choice) used.add(choice.card.id);
      return { target, choice };
    })
    .filter((a) => a.choice);

  const missingKits = assignments.filter(({ choice }) => !run.kits.get(choice!.card.id)?.sponsors || !run.kits.get(choice!.card.id)?.experience);
  if (missingKits.length) {
    think(`Pulling sponsor prospects, playlists and nearby partners for ${missingKits.length} night(s).`);
    await Promise.all(
      missingKits.flatMap(({ choice }) => {
        const id = choice!.card.id;
        const kit = run.kits.get(id);
        return [
          kit?.sponsors ? null : call("find_sponsors", { anchor_entity_ids: [id] }),
          kit?.experience ? null : call("build_night_experience", { anchor_entity_ids: [id] }),
        ].filter(Boolean);
      }),
    );
  }

  const city = run.team.venue.city.split(",")[0];
  const usedBrands = new Set<string>();
  const submission: PlanSubmissionT = {
    market_summary: marketSummary(run),
    nights: assignments.map(({ target, choice }) => {
      const anchor = choice!.card;
      const score = choice!.score;
      const kit = run.kits.get(anchor.id) ?? {};
      const familyFriendly = target.segment === "families" || target.segment === "gen_z";
      const all = ((Array.isArray(kit.sponsors) ? kit.sponsors : []) as Brand[]).filter((b) => !(familyFriendly && isAlcohol(b)));
      // Spread sponsor asks across the season instead of pitching the same brand every night.
      const brands = [...all.filter((b) => !usedBrands.has(b.id)), ...all.filter((b) => usedBrands.has(b.id))].slice(0, 2);
      brands.forEach((b) => usedBrands.add(b.id));
      const exp = (kit.experience ?? {}) as Experience;
      const profile = taste.profiles.get(anchor.id);
      const seg = SEGMENTS[target.segment];
      const title = nightTitle(anchor, target.segment, run.team.ipPolicy);
      const trend = profile?.trend?.window
        ? `${profile.trend.direction} (${profile.trend.changePct > 0 ? "+" : ""}${profile.trend.changePct}% in Qloo's latest trending window)`
        : "not tracked in Qloo trending";
      return {
        date: target.date,
        anchor_entity_id: anchor.id,
        supporting_entity_ids: [],
        title,
        tagline: `A ${seg.label.toLowerCase()} night built on what ${city} actually loves.`,
        why: `${anchor.name} ranks #${anchor.localRank ?? "?"} by local affinity in ${city} vs #${anchor.nationalRank ?? "?"} by national popularity in the same Qloo result set. Audience fit for ${seg.label}: ${score.segmentFit}; interest is ${trend}; near-venue index ${score.nearVenue}.`,
        sponsor_picks: brands.map((b) => ({
          brand_id: b.id,
          angle: `Qloo ranks ${b.name} among the ${b.sponsor_category ?? "brands"} that ${anchor.name} fans in ${city} over-index on — a natural presenting partner.`,
        })),
        giveaway: GIVEAWAY[anchor.kind] ?? "Limited-edition theme-night bobblehead",
        activations: [
          anchor.kind === "artist" ? "Pre-game listening party on the concourse" : "Pre-game costume contest on the concourse",
          "Between-innings trivia for the fandom",
          `${seg.label} ticket bundle with a themed concession item`,
        ],
        playlist_artist_ids: (exp.playlist_artists ?? []).slice(0, 6).map((a) => a.id),
        local_partner_picks: (exp.nearby_places ?? []).slice(0, 2).map((p) => ({
          place_id: p.id,
          idea: `Pre-game meetup at ${p.name} with a ticket bundle`,
        })),
        media_partner: exp.podcasts?.[0] ? { podcast_id: exp.podcasts[0].id, idea: `Ad read + ticket giveaway on ${exp.podcasts[0].name}` } : undefined,
        promo: {
          headline: `${title}: ${target.weekday} ${target.date.slice(5).replace("-", "/")}`,
          social: `${title} is coming to the ballpark. ${seg.emoji} Grab your crew and catch a game built for fans like you.`,
          email_subject: `You're invited: ${title}`,
        },
      };
    }),
  };

  think("Submitting the season plan for validation.");
  await call("submit_season_plan", submission);
}

const GIVEAWAY: Partial<Record<EntityKind, string>> = {
  movie: "Poster-style bobblehead in a limited run of 2,000",
  tv_show: "Retro trading-card set featuring players in theme costumes",
  artist: "LED wristbands synced to the in-game playlist",
  videogame: "Pixel-art player cards with a scannable in-park scavenger hunt",
  book: "Reading-challenge passport and themed bookmark",
};

const KIND_NIGHT: Partial<Record<EntityKind, string>> = {
  movie: "Movie Buffs",
  tv_show: "Binge-Watchers",
  artist: "Music",
  videogame: "Gamers",
  book: "Book Club",
};

/** Safe, license-aware names; never built from raw Qloo keyword tags (they can read badly out of context). */
function nightTitle(anchor: EntityCard, segment: SegmentId, policy: "licensed_ok" | "ip_light") {
  if (policy === "licensed_ok" || anchor.kind === "artist" || !anchor.owners?.length) return `${anchor.name} Night`;
  return `${SEGMENTS[segment].label} ${KIND_NIGHT[anchor.kind] ?? "Fan"} Night`;
}

function marketSummary(run: RunContext) {
  const top = [...run.taste.cards.values()]
    .filter((c) => (c.lift ?? 0) > 0 && !sensitiveTopic(c))
    .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))
    .slice(0, 3);
  if (!top.length) return `Qloo's location signal for ${run.taste.city} shaped every pick below.`;
  return `${run.taste.resolvedLocality ?? run.taste.city} over-indexes on ${top
    .map((c) => `${c.name} (#${c.localRank} locally vs #${c.nationalRank} by national popularity)`)
    .join(", ")}. The nights below pair those local loves with the audience each date needs.`;
}
