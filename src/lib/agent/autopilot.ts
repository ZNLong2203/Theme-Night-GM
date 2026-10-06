import "server-only";
import { scoreIn } from "@/lib/qloo/workflows";
import { SEGMENTS } from "@/lib/schedule";
import { identityTheme, isAlcoholBrand, isDrinkingSpot, isYoungCrowd, sensitiveTopic } from "@/lib/sensitivity";
import type { EntityCard, EntityKind, SegmentId, Sport } from "@/lib/types";
import type { PlanSubmissionT } from "./assemble";
import { missingFit, runTool, type RunContext } from "./tools";

type Ref = { id: string; name: string };
type Experience = { playlist_artists?: Ref[]; nearby_places?: Ref[]; podcasts?: Ref[] };
type SponsorKit = Ref[] | { brands?: Ref[] };

const SCAN_KINDS = ["movie", "tv_show", "artist", "videogame", "book"] as const;

/** Copy that fits the sport: where the crowd goes and what the break in play is called. */
const SPORT_COPY: Record<Sport, { venue: string; breakName: string }> = {
  baseball: { venue: "the ballpark", breakName: "Between-innings" },
  basketball: { venue: "the arena", breakName: "Timeout" },
  hockey: { venue: "the arena", breakName: "Intermission" },
  soccer: { venue: "the stadium", breakName: "Halftime" },
  football: { venue: "the stadium", breakName: "Halftime" },
};

/**
 * Deterministic planner that drives the same tools as the LLM agent. It runs when no Gemini key is
 * configured and as the safety net when the model misses its deadline. It reuses everything the
 * run has already measured — scans, scores, profiles and the night kits the model built — so a
 * late model still gets its research turned into a plan instead of a restart.
 */
export async function runAutopilot(run: RunContext, opts: { reason?: string } = {}) {
  const { taste, targets, emit } = run;
  // Unique per pass: the safety net can run after an earlier autopilot pass in the same run.
  const pass = crypto.randomUUID().slice(0, 4);
  let seq = 0;
  const call = (name: string, args: unknown) => runTool(name, args, `auto_${pass}_${++seq}`, run);
  const think = (text: string) => emit({ type: "thought", text });
  const segments = [...new Set(targets.map((t) => t.segment))] as SegmentId[];
  const safe = (c: EntityCard) => !sensitiveTopic(c) && (SCAN_KINDS as readonly EntityKind[]).includes(c.kind);

  if (opts.reason) think(opts.reason);

  const unscanned = SCAN_KINDS.filter((kind) => !taste.pools.has(kind));
  if (unscanned.length) {
    think(`Reading the room in ${taste.city}: scanning ${unscanned.length} culture domain(s) for local affinity.`);
    await call("scan_market_taste", { kinds: unscanned });
  }

  // Anchors the model already researched come first, then the strongest scan results per domain.
  const researched = [...run.kits.keys()].map((id) => taste.cards.get(id)).filter((c): c is EntityCard => Boolean(c && safe(c)));
  const byKind = new Map<EntityKind, EntityCard[]>();
  for (const id of [...taste.pools.values()].flat()) {
    const card = taste.cards.get(id);
    if (card && safe(card)) byKind.set(card.kind, [...(byKind.get(card.kind) ?? []), card]);
  }
  // Enough per domain to cover every date even if some domains came back empty.
  const perKind = Math.ceil(targets.length / Math.max(1, byKind.size)) + 1;
  const fromScan = [...byKind.values()].flatMap((cards) =>
    [...cards]
      // Recognizable AND local: national popularity guards against obscure picks.
      .sort((a, b) => (b.localPct ?? 0) + (b.popularity ?? 0) + 0.02 * (b.lift ?? 0) - ((a.localPct ?? 0) + (a.popularity ?? 0) + 0.02 * (a.lift ?? 0)))
      .slice(0, perKind),
  );
  // When the model already researched a night for every date, fresh candidates can't win (researched
  // anchors sort first), so the safety net skips scoring them and finishes fast.
  const covered = researched.length >= targets.length;
  const candidates = [...new Map([...researched, ...(covered ? [] : fromScan)].map((c) => [c.id, c])).values()].slice(
    0,
    Math.max(14, targets.length),
  );
  if (!candidates.length) {
    think(`Qloo returned no usable fandoms for ${taste.city}, so there is nothing to build a plan on.`);
    return;
  }

  const unscored = missingFit(run, candidates.map((c) => c.id), segments).map((id) => taste.cards.get(id)!);
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
  // If unused fandoms run out, the best one is reused (a warning, not a rejection) so no date is dropped.
  const used = new Set<string>();
  const assignments = [...targets]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((target) => {
      const rank = (cards: EntityCard[]) =>
        cards.map((c) => ({ card: c, score: scoreIn(taste, c, target.segment) })).sort((a, b) => b.score.total - a.score.total);
      const choice = rank(finalists.filter((c) => !used.has(c.id)))[0] ?? rank(finalists)[0];
      used.add(choice.card.id);
      return { target, choice };
    });

  const missingKits = assignments.filter(({ choice }) => !run.kits.get(choice.card.id)?.sponsors || !run.kits.get(choice.card.id)?.experience);
  if (missingKits.length) {
    think(`Pulling sponsor prospects, playlists and nearby partners for ${missingKits.length} night(s).`);
    const ids = [...new Set(missingKits.map(({ choice }) => choice.card.id))];
    await Promise.all(
      ids.flatMap((id) => {
        const kit = run.kits.get(id);
        return [
          kit?.sponsors ? null : call("find_sponsors", { anchor_entity_ids: [id] }),
          kit?.experience ? null : call("build_night_experience", { anchor_entity_ids: [id] }),
        ].filter(Boolean);
      }),
    );
  }

  const city = run.team.venue.city.split(",")[0];
  const copy = SPORT_COPY[run.team.sport];
  const usedBrands = new Set<string>();
  const usedTitles = new Set<string>();
  // Kits hold the tool output the model saw; look each pick up again to apply the validator's own predicates.
  const card = (ref: Ref) => taste.cards.get(ref.id) ?? { id: ref.id, name: ref.name, kind: "brand" as const };
  const submission: PlanSubmissionT = {
    market_summary: marketSummary(run),
    nights: assignments.map(({ target, choice }) => {
      const anchor = choice.card;
      const score = choice.score;
      const kit = run.kits.get(anchor.id) ?? {};
      const youngCrowd = isYoungCrowd(target.segment);
      const sponsorKit = kit.sponsors as SponsorKit | undefined;
      const all = (Array.isArray(sponsorKit) ? sponsorKit : (sponsorKit?.brands ?? [])).filter((b) => {
        const c = card(b);
        return !sensitiveTopic(c) && !(youngCrowd && isAlcoholBrand(c));
      });
      // Spread sponsor asks across the season instead of pitching the same brand every night.
      const brands = [...all.filter((b) => !usedBrands.has(b.id)), ...all.filter((b) => usedBrands.has(b.id))].slice(0, 2);
      brands.forEach((b) => usedBrands.add(b.id));
      const exp = (kit.experience ?? {}) as Experience;
      const places = (exp.nearby_places ?? []).filter((p) => !(youngCrowd && isDrinkingSpot(card(p)))).slice(0, 2);
      const podcast = (exp.podcasts ?? []).find((p) => !sensitiveTopic(card(p)));
      const profile = taste.profiles.get(anchor.id);
      const seg = SEGMENTS[target.segment];
      const title = nightTitle(anchor, target.segment, run.team.ipPolicy, usedTitles);
      usedTitles.add(title);
      const trendFailure = profile?.unavailable?.find((u) => u.startsWith("Trend: "));
      const trend =
        profile?.trend?.window && profile.trend.direction !== "unknown"
          ? `${profile.trend.direction} (${profile.trend.changePct > 0 ? "+" : ""}${profile.trend.changePct}% in Qloo's latest trending window)`
          : trendFailure
            ? `unknown (${trendFailure.slice("Trend: ".length)})`
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
          angle: `Qloo ranks ${b.name} among the ${card(b).category ?? "brands"} that ${anchor.name} fans in ${city} over-index on — a natural presenting partner.`,
        })),
        giveaway: GIVEAWAY[anchor.kind] ?? "Limited-edition theme-night bobblehead",
        activations: [
          anchor.kind === "artist" ? "Pre-game listening party on the concourse" : "Pre-game costume contest on the concourse",
          `${copy.breakName} trivia for the fandom`,
          `${seg.label} ticket bundle with a themed concession item`,
        ],
        playlist_artist_ids: (exp.playlist_artists ?? []).slice(0, 6).map((a) => a.id),
        local_partner_picks: places.map((p) => ({ place_id: p.id, idea: `Pre-game meetup at ${p.name} with a ticket bundle` })),
        media_partner: podcast ? { podcast_id: podcast.id, idea: `Ad read + ticket giveaway on ${podcast.name}` } : undefined,
        promo: {
          headline: `${title}: ${target.weekday} ${target.date.slice(5).replace("-", "/")}`,
          social: `${title} is coming to ${copy.venue}. ${seg.emoji} Grab your crew and catch a game built for fans like you.`,
          email_subject: `You're invited: ${title}`,
        },
      };
    }),
  };

  think("Submitting the season plan for validation.");
  const result = (await call("submit_season_plan", submission)) as { accepted?: boolean; errors?: string[] } | undefined;
  if (result && result.accepted === false) think(`The validator rejected the plan: ${(result.errors ?? []).join("; ")}`);
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

/** Evocative alternates so two license-free nights of the same kind and segment don't share a name. */
const KIND_ALT: Partial<Record<EntityKind, string[]>> = {
  movie: ["Silver Screen", "Blockbuster", "Popcorn Premiere"],
  tv_show: ["Season Finale", "Prestige TV", "Couch to Concourse"],
  artist: ["Playlist", "Encore", "Headliner"],
  videogame: ["Level Up", "Pixel", "Respawn"],
  book: ["Page Turners", "Story Hour", "Plot Twist"],
};

/**
 * Safe, license-aware names; never built from raw Qloo keyword tags (they can read badly out of context).
 * Under ip_light only artists keep their name: owner metadata is often missing, so a missing owner
 * isn't treated as "free to use". Names that would read as an identity night fall back to generic.
 */
function nightTitle(anchor: EntityCard, segment: SegmentId, policy: "licensed_ok" | "ip_light", taken: Set<string>) {
  const named = `${anchor.name} Night`;
  if ((policy === "licensed_ok" || anchor.kind === "artist") && !identityTheme(named) && !taken.has(named)) return named;
  const label = SEGMENTS[segment].label.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const options = [KIND_NIGHT[anchor.kind] ?? "Fan", ...(KIND_ALT[anchor.kind] ?? [])].map((word) => `${label} ${word} Night`);
  return options.find((t) => !taken.has(t)) ?? `${options[0]} ${taken.size + 1}`;
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
