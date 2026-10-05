import "server-only";
import { SEGMENTS } from "@/lib/schedule";
import { computeScore } from "@/lib/scoring";
import type { EntityCard, EntityKind, SegmentId } from "@/lib/types";
import type { PlanSubmissionT } from "./assemble";
import { runTool, type RunContext } from "./tools";

/**
 * Deterministic planner that drives the same tools as the LLM agent. It runs when no Gemini key is
 * configured (local development) and as a safety net if the model fails to submit a valid plan.
 */
export async function runAutopilot(run: RunContext, opts: { reason?: string } = {}) {
  const { taste, targets, emit } = run;
  let seq = 0;
  const call = (name: string, args: unknown) => runTool(name, args, `auto_${++seq}`, run);
  const think = (text: string) => emit({ type: "thought", text });

  if (opts.reason) think(opts.reason);

  const scanned = [...taste.cards.values()].filter((c) => c.localRank !== undefined);
  if (!scanned.length) {
    think(`Reading the room in ${taste.city}: scanning six culture domains for local affinity.`);
    await call("scan_market_taste", { kinds: ["movie", "tv_show", "artist", "videogame", "podcast", "book"] });
  }

  const pool = [...taste.cards.values()].filter((c) => c.localRank !== undefined);
  const byKind = new Map<EntityKind, EntityCard[]>();
  for (const card of pool) byKind.set(card.kind, [...(byKind.get(card.kind) ?? []), card]);
  const candidates = [...byKind.values()].flatMap((cards) =>
    [...cards].sort((a, b) => (b.affinity ?? 0) + 0.015 * (b.lift ?? 0) - ((a.affinity ?? 0) + 0.015 * (a.lift ?? 0))).slice(0, 2),
  );
  const segments = [...new Set(targets.map((t) => t.segment))] as SegmentId[];

  think(`Shortlisted ${candidates.length} fandoms with the strongest local affinity and lift. Scoring them for ${segments.map((s) => SEGMENTS[s].label).join(", ")}.`);
  await call("score_audience_fit", { entity_ids: candidates.map((c) => c.id), segments });

  const best = (card: EntityCard) =>
    Math.max(
      ...segments.map(
        (segment) =>
          computeScore({
            entity: card,
            segment,
            localAffinity: taste.localAffinity.get(card.id),
            segmentFit: taste.segmentFit.get(card.id),
            fanOverlap: taste.fanOverlap.get(card.id),
          }).total,
      ),
    );
  const finalists = [...candidates].sort((a, b) => best(b) - best(a)).slice(0, Math.max(6, targets.length));
  think(`Profiling the top ${Math.min(6, finalists.length)}: who the fans are, whether they live near the venue, and whether interest is rising.`);
  await call("profile_fandoms", { entity_ids: finalists.slice(0, 6).map((c) => c.id) });

  // Greedy assignment: each date gets the unused fandom with the best Taste Fit Score for its segment.
  const used = new Set<string>();
  const assignments = [...targets]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((target) => {
      const ranked = finalists
        .filter((c) => !used.has(c.id))
        .map((c) => ({
          card: c,
          score: computeScore({
            entity: c,
            segment: target.segment,
            localAffinity: taste.localAffinity.get(c.id),
            profile: taste.profiles.get(c.id),
            segmentFit: taste.segmentFit.get(c.id),
            fanOverlap: taste.fanOverlap.get(c.id),
          }),
        }))
        .sort((a, b) => b.score.total - a.score.total);
      const choice = ranked[0];
      if (choice) used.add(choice.card.id);
      return { target, choice };
    })
    .filter((a) => a.choice);

  think(`Assigned ${assignments.length} anchors. Pulling sponsor prospects, playlists and nearby partners for each night.`);
  const kits = [];
  for (let i = 0; i < assignments.length; i += 2) {
    const batch = assignments.slice(i, i + 2);
    kits.push(
      ...(await Promise.all(
        batch.map(async ({ target, choice }) => {
          const anchor = choice!.card;
          const [sponsors, experience] = await Promise.all([
            call("find_sponsors", { anchor_entity_ids: [anchor.id] }),
            call("build_night_experience", { anchor_entity_ids: [anchor.id] }),
          ]);
          return { target, anchor, score: choice!.score, sponsors, experience };
        }),
      )),
    );
  }

  const usedBrands = new Set<string>();
  const submission: PlanSubmissionT = {
    market_summary: marketSummary(run),
    nights: kits.map(({ target, anchor, score, sponsors, experience }) => {
      const all = (Array.isArray(sponsors) ? sponsors : []) as { id: string; name: string; affinity?: number }[];
      // Spread sponsor asks across the season instead of pitching the same brand every night.
      const brands = [...all.filter((b) => !usedBrands.has(b.id)), ...all.filter((b) => usedBrands.has(b.id))];
      brands.slice(0, 2).forEach((b) => usedBrands.add(b.id));
      const exp = (experience ?? {}) as {
        playlist_artists?: { id: string }[];
        nearby_places?: { id: string; name: string }[];
        podcasts?: { id: string; name: string }[];
      };
      const profile = taste.profiles.get(anchor.id);
      const title = nightTitle(anchor, run.team.ipPolicy);
      const seg = SEGMENTS[target.segment];
      const trend = profile?.trend ? `${profile.trend.direction} (${profile.trend.changePct > 0 ? "+" : ""}${profile.trend.changePct}% in 16 weeks)` : "steady";
      return {
        date: target.date,
        anchor_entity_id: anchor.id,
        supporting_entity_ids: [],
        title,
        tagline: `${seg.label} night built on what ${run.team.venue.city.split(",")[0]} actually loves.`,
        why: `${anchor.name} ranks #${anchor.localRank ?? "?"} locally vs #${anchor.nationalRank ?? "?"} by national popularity (local affinity ${score.localAffinity}). Audience fit for ${seg.label}: ${score.segmentFit}; interest is ${trend}; near-venue index ${score.nearVenue}.`,
        sponsor_picks: brands.slice(0, 2).map((b) => ({
          brand_id: b.id,
          angle: `${b.name}'s audience over-indexes on ${anchor.name}${b.affinity ? ` (Qloo affinity ${b.affinity})` : ""} — a natural presenting partner.`,
        })),
        giveaway: GIVEAWAY[anchor.kind] ?? "Limited-edition theme-night bobblehead",
        activations: [
          `Pre-game ${anchor.kind === "artist" ? "listening party" : "costume contest"} on the concourse`,
          `Between-innings trivia about ${anchor.name}`,
          `${seg.label}-priced ticket bundle with a themed concession item`,
        ],
        playlist_artist_ids: (exp.playlist_artists ?? []).slice(0, 6).map((a) => a.id),
        local_partner_picks: (exp.nearby_places ?? []).slice(0, 2).map((p) => ({
          place_id: p.id,
          idea: `Pre-game meetup at ${p.name} with a ticket + drink bundle`,
        })),
        media_partner: exp.podcasts?.[0]
          ? { podcast_id: exp.podcasts[0].id, idea: `Ad read + ticket giveaway on ${exp.podcasts[0].name}` }
          : undefined,
        promo: {
          headline: `${title} — ${target.weekday} ${target.date.slice(5).replace("-", "/")}`,
          social: `${title} is coming to the ballpark. ${seg.emoji} Grab your crew, dress the part, and catch a game built for fans like you.`,
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
  podcast: "Live podcast taping on the concourse + signed merch",
  book: "Reading-challenge passport and themed bookmark",
};

function nightTitle(anchor: EntityCard, policy: "licensed_ok" | "ip_light") {
  const owned = Boolean(anchor.owners?.length);
  if (policy === "ip_light" && owned && anchor.kind !== "artist") {
    const tag = anchor.tags?.[0];
    return tag ? `${tag} Night` : `${anchor.kind === "videogame" ? "Gamer" : "Movie Buff"} Night`;
  }
  return `${anchor.name} Night`;
}

function marketSummary(run: RunContext) {
  const top = [...run.taste.cards.values()]
    .filter((c) => (c.lift ?? 0) > 0)
    .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))
    .slice(0, 3);
  if (!top.length) return `Qloo's location signal for ${run.taste.city} shaped every pick below.`;
  return `${run.taste.city} over-indexes on ${top
    .map((c) => `${c.name} (#${c.localRank} locally vs #${c.nationalRank} nationally)`)
    .join(", ")}. Nights below pair those local loves with the audience each date needs.`;
}
