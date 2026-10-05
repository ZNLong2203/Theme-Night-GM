import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { QlooRecorder } from "@/lib/qloo/client";
import { fanbaseOverlap, profileEntities, scoreSegmentFit, searchEntities, localAffinityFor, TasteContext } from "@/lib/qloo/workflows";
import { SEGMENTS, SPORTS } from "@/lib/schedule";
import { computeScore } from "@/lib/scoring";
import type { BaselineNight, BaselineResult, EntityKind, TeamConfig } from "@/lib/types";
import { GEMINI_MODEL, runMode } from "./run";

const KINDS = ["movie", "tv_show", "artist", "videogame", "podcast", "book"] as const;

const BaselineSchema = z.object({
  nights: z.array(
    z.object({
      date: z.string(),
      title: z.string(),
      anchor_name: z.string(),
      anchor_kind: z.enum(KINDS),
      why: z.string(),
    }),
  ),
});

/** What a typical LLM proposes when asked with no data — used only when no Gemini key is configured. */
const GENERIC_FALLBACK = [
  ["Star Wars Night", "Star Wars", "movie"],
  ["Harry Potter Night", "Harry Potter and the Sorcerer's Stone", "book"],
  ["Superhero Night", "Deadpool & Wolverine", "movie"],
  ["Taylor Swift Night", "Taylor Swift", "artist"],
  ["80s Night", "Stranger Things", "tv_show"],
  ["Gamer Night", "Fortnite", "videogame"],
  ["Margaritaville Night", "Jimmy Buffett", "artist"],
  ["Office Night", "The Office", "tv_show"],
] as const;

/**
 * The control group: ask the same LLM to plan the same dates with no tools, then fact-check its
 * picks with Qloo using exactly the same scoring as the agent's plan.
 */
export async function runBaseline(team: TeamConfig): Promise<BaselineResult> {
  const targets = team.dates.filter((d) => d.target).sort((a, b) => a.date.localeCompare(b.date));
  const mode = runMode();
  let proposals: z.infer<typeof BaselineSchema>["nights"];

  if (mode.llm === "gemini") {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `You are a promotions strategist for ${team.teamName}, a ${SPORTS[team.sport].label.toLowerCase()} team (${team.league}) playing at ${team.venue.name} in ${team.venue.city}.
Plan one theme night for each of these weak home dates. Anchor each night on one real, specific movie, TV show, music artist, video game, podcast or book that you believe fans in ${team.venue.city} love.
${targets.map((t) => `- ${t.date} (${t.weekday} ${t.time}) for ${SEGMENTS[t.segment].label} (${SEGMENTS[t.segment].short})`).join("\n")}
Return JSON only.`;
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            nights: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string" },
                  title: { type: "string" },
                  anchor_name: { type: "string", description: "Exact title or artist name" },
                  anchor_kind: { type: "string", enum: [...KINDS] },
                  why: { type: "string" },
                },
                required: ["date", "title", "anchor_name", "anchor_kind", "why"],
              },
            },
          },
          required: ["nights"],
        },
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    proposals = BaselineSchema.parse(JSON.parse(response.text ?? "{}")).nights;
  } else {
    proposals = targets.map((t, i) => {
      const [title, anchor, kind] = GENERIC_FALLBACK[i % GENERIC_FALLBACK.length];
      return { date: t.date, title, anchor_name: anchor, anchor_kind: kind, why: "Generic pick (no LLM key configured)." };
    });
  }

  // Fact-check with Qloo: resolve each pick, then score it exactly like the agent's picks.
  const recorder = new QlooRecorder();
  const taste = new TasteContext(recorder, team.venue.city, team.venue);
  const matches = await Promise.all(
    proposals.map(async (p) => {
      const found = await searchEntities(taste, p.anchor_name, [p.anchor_kind as EntityKind], 1).catch(() => []);
      return { proposal: p, match: found[0] };
    }),
  );
  const ids = [...new Set(matches.flatMap((m) => (m.match ? [m.match.id] : [])))];
  if (ids.length) {
    const segments = [...new Set(targets.map((t) => t.segment))];
    await Promise.all([
      localAffinityFor(taste, ids),
      scoreSegmentFit(taste, ids, segments),
      profileEntities(taste, ids.slice(0, 6)),
      fanbaseOverlap(taste, team.sport, ids),
    ]);
  }

  const nights: BaselineNight[] = targets.map((target) => {
    const m = matches.find((x) => x.proposal.date === target.date);
    const base = {
      date: target.date,
      segment: target.segment,
      title: m?.proposal.title ?? "(no proposal)",
      anchorName: m?.proposal.anchor_name ?? "",
      why: m?.proposal.why ?? "",
    };
    if (!m?.match) return { ...base, found: false };
    const card = taste.cards.get(m.match.id) ?? m.match;
    return {
      ...base,
      found: true,
      match: card,
      score: computeScore({
        entity: card,
        segment: target.segment,
        localAffinity: taste.localAffinity.get(card.id),
        profile: taste.profiles.get(card.id),
        segmentFit: taste.segmentFit.get(card.id),
        fanOverlap: taste.fanOverlap.get(card.id),
      }),
      evidence: taste.evidence.get(card.id) ?? [],
    };
  });

  return { nights, requests: recorder.logs, mode };
}
