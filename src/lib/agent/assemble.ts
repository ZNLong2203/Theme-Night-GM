import "server-only";
import { z } from "zod";
import { licensingFor } from "@/lib/licensing";
import { computeScore } from "@/lib/scoring";
import { identityTheme, isAlcoholBrand, sensitiveTopic } from "@/lib/sensitivity";
import type { EntityCard, Night, SeasonPlan } from "@/lib/types";
import type { RunContext } from "./tools";

export const PlanSubmission = z.object({
  market_summary: z.string().min(1),
  nights: z
    .array(
      z.object({
        date: z.string(),
        anchor_entity_id: z.string(),
        supporting_entity_ids: z.array(z.string()).optional().default([]),
        title: z.string().min(1),
        tagline: z.string().default(""),
        why: z.string().min(1),
        sponsor_picks: z.array(z.object({ brand_id: z.string(), angle: z.string() })).default([]),
        giveaway: z.string().default(""),
        activations: z.array(z.string()).default([]),
        playlist_artist_ids: z.array(z.string()).optional().default([]),
        local_partner_picks: z.array(z.object({ place_id: z.string(), idea: z.string() })).optional().default([]),
        media_partner: z.object({ podcast_id: z.string(), idea: z.string() }).optional(),
        promo: z.object({ headline: z.string(), social: z.string(), email_subject: z.string() }),
      }),
    )
    .min(1),
});
export type PlanSubmissionT = z.infer<typeof PlanSubmission>;

/**
 * Turn the model's submission into a SeasonPlan. Entities are looked up from what Qloo actually
 * returned during this run — unknown IDs are rejected so the plan can't cite invented data.
 */
export function assemblePlan(
  run: RunContext,
  submission: PlanSubmissionT,
): { plan?: SeasonPlan; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { taste, team, targets } = run;
  const lookup = (ref: string): EntityCard | undefined => {
    const direct = taste.cards.get(ref);
    if (direct) return direct;
    const lower = ref.trim().toLowerCase();
    for (const card of taste.cards.values()) if (card.name.toLowerCase() === lower) return card;
    return undefined;
  };

  const targetByDate = new Map(targets.map((t) => [t.date, t]));
  const seenDates = new Set<string>();
  const nights: Night[] = [];

  for (const n of submission.nights) {
    const target = targetByDate.get(n.date);
    if (!target) {
      errors.push(`${n.date} is not a target date (valid: ${targets.map((t) => t.date).join(", ")})`);
      continue;
    }
    if (seenDates.has(n.date)) {
      errors.push(`${n.date} appears twice`);
      continue;
    }
    seenDates.add(n.date);
    const anchor = lookup(n.anchor_entity_id);
    if (!anchor) {
      errors.push(`anchor_entity_id "${n.anchor_entity_id}" on ${n.date} was not returned by any Qloo tool call`);
      continue;
    }
    const topic = sensitiveTopic(anchor);
    if (topic) {
      errors.push(`${anchor.name} on ${n.date} touches a sensitive topic ("${topic}") — pick a different anchor`);
      continue;
    }
    const identity = identityTheme(n.title, n.tagline);
    if (identity) {
      errors.push(
        `"${n.title}" on ${n.date} frames the night around identity ("${identity}"). Pride, heritage and faith nights are community partnerships, not taste programming — rename it around the fandom itself.`,
      );
      continue;
    }

    const pick = <T,>(refs: T[], key: (r: T) => string, label: string) =>
      refs.flatMap((r) => {
        const card = lookup(key(r));
        if (!card) warnings.push(`Dropped unknown ${label} "${key(r)}" on ${n.date}`);
        return card ? [{ ref: r, card }] : [];
      });

    const supporting = pick(n.supporting_entity_ids, (r) => r, "supporting entity").map((x) => x.card);
    const youngCrowd = target.segment === "families" || target.segment === "gen_z";
    const sponsors = pick(n.sponsor_picks, (r) => r.brand_id, "sponsor")
      .filter((x) => {
        if (youngCrowd && isAlcoholBrand(x.card)) {
          warnings.push(`Removed alcohol sponsor ${x.card.name} from the ${target.segment} night on ${n.date}`);
          return false;
        }
        return true;
      })
      .slice(0, 3)
      .map((x) => ({ brand: x.card, angle: x.ref.angle }));
    const playlist = pick(n.playlist_artist_ids, (r) => r, "artist").map((x) => x.card);
    const localPartners = pick(n.local_partner_picks, (r) => r.place_id, "place").map((x) => ({ place: x.card, idea: x.ref.idea }));
    const media = n.media_partner ? lookup(n.media_partner.podcast_id) : undefined;
    if (n.media_partner && !media) warnings.push(`Dropped unknown podcast on ${n.date}`);

    const profile = taste.profiles.get(anchor.id);
    const score = computeScore({
      entity: anchor,
      segment: target.segment,
      localAffinity: taste.localPct.get(anchor.id),
      profile,
      segmentFit: taste.segmentFit.get(anchor.id),
      fanOverlap: taste.fanOverlap.get(anchor.id),
    });

    const evidence = new Set<string>(taste.evidence.get(anchor.id) ?? []);
    for (const c of [...sponsors.map((s) => s.brand), ...playlist, ...localPartners.map((l) => l.place), ...(media ? [media] : [])]) {
      for (const r of taste.evidence.get(c.id) ?? []) evidence.add(r);
    }

    nights.push({
      date: target.date,
      weekday: target.weekday,
      time: target.time,
      segment: target.segment,
      title: n.title,
      tagline: n.tagline,
      anchor,
      supporting,
      score,
      why: n.why,
      sponsors,
      giveaway: n.giveaway,
      activations: n.activations,
      playlist,
      localPartners,
      mediaPartner: media && n.media_partner ? { podcast: media, idea: n.media_partner.idea } : undefined,
      promo: { headline: n.promo.headline, social: n.promo.social, emailSubject: n.promo.email_subject },
      licensing: licensingFor(anchor, team.ipPolicy),
      evidence: [...evidence].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
    });
  }

  const missing = targets.filter((t) => !seenDates.has(t.date)).map((t) => t.date);
  if (missing.length) errors.push(`Missing nights for target dates: ${missing.join(", ")}`);
  const anchors = nights.map((n) => n.anchor.id);
  if (new Set(anchors).size < anchors.length) warnings.push("Some anchors repeat — consider more variety.");
  if (errors.length) return { errors, warnings };

  nights.sort((a, b) => a.date.localeCompare(b.date));
  const usedProfiles = [...new Set(nights.flatMap((n) => [n.anchor.id]))]
    .map((id) => taste.profiles.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ ...p, segmentFit: taste.segmentFit.get(p.entity.id) }));

  return {
    plan: {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      team,
      marketSummary: submission.market_summary,
      nights,
      profiles: usedProfiles,
      requests: taste.recorder.logs,
      mode: run.mode,
    },
    errors,
    warnings,
  };
}
