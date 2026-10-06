import "server-only";
import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import { publicError } from "@/lib/errors";
import { QlooRecorder } from "@/lib/qloo/client";
import { profileEntities, scoreCandidates, TasteContext } from "@/lib/qloo/workflows";
import { DAY, kvSet } from "@/lib/store";
import type { AgentEvent, GameDate, SeasonPlan, SegmentId } from "@/lib/types";
import { assemblePlan, PlanSubmission } from "./assemble";
import { buildRevisionBrief, REVISION_PROMPT } from "./prompt";
import { geminiLoop, runDeadline, runMode, RUN_DEADLINE_MS } from "./run";
import { missingFit, resolveId, TOOLS, type RunContext, type ToolDef, type ToolRegistry } from "./tools";

const SEGMENT_IDS = ["families", "gen_z", "young_pros", "boomers"] as const;
const RevisionNight = PlanSubmission.shape.nights.element.extend({ segment: z.enum(SEGMENT_IDS).optional() });
const RevisionSubmission = z.object({ summary: z.string().min(1), nights: z.array(RevisionNight).min(1) });
type RevisionSubmissionT = z.infer<typeof RevisionSubmission>;

/** A revision touches a night or two; ~50 requests is typical. */
const REVISION_QLOO_BUDGET = 120;
const RESEARCH_TOOLS = ["search_entities", "scan_market_taste", "score_audience_fit", "profile_fandoms", "find_sponsors", "build_night_experience", "compare_fanbases"];

/** Load everything the original run measured, so the plan's entities stay valid IDs for the model. */
function seedTaste(ctx: TasteContext, plan: SeasonPlan) {
  ctx.remember(
    plan.nights.flatMap((n) => [
      n.anchor,
      ...n.supporting,
      ...n.sponsors.map((s) => s.brand),
      ...n.playlist,
      ...n.localPartners.map((l) => l.place),
      ...(n.mediaPartner ? [n.mediaPartner.podcast] : []),
    ]),
  );
  for (const profile of plan.profiles) {
    ctx.profiles.set(profile.entity.id, profile);
    if (profile.segmentFit) ctx.segmentFit.set(profile.entity.id, profile.segmentFit);
    if (profile.demographics) ctx.demographics.set(profile.entity.id, profile.demographics);
  }
  for (const n of plan.nights) {
    ctx.localPct.set(n.anchor.id, n.score.localAffinity);
    ctx.fanOverlap.set(n.anchor.id, Math.max(0, Math.min(1, (1 - n.score.newFanReach) / 0.8)));
    ctx.segmentFit.set(n.anchor.id, { ...ctx.segmentFit.get(n.anchor.id), [n.segment]: n.score.segmentFit });
    ctx.cite(n.anchor.id, ...n.evidence);
  }
}

function submitRevisionTool(base: SeasonPlan, request: string, revisedId: string): ToolDef<RevisionSubmissionT> {
  const submit = TOOLS.submit_season_plan.declaration.parametersJsonSchema as { properties: { nights: { items: { properties: object; required: string[] } } } };
  const nightSchema = structuredClone(submit.properties.nights.items);
  (nightSchema.properties as Record<string, unknown>).segment = {
    type: "string",
    enum: [...SEGMENT_IDS],
    description: "Only when the director asks to move this date to a different audience.",
  };
  const declaration: FunctionDeclaration = {
    name: "submit_revision",
    description:
      "Submit ONLY the nights you changed (full night objects). The server validates IDs and policies exactly like the original plan, recomputes Taste Fit, and merges them into the plan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One sentence: what changed." },
        nights: { type: "array", items: nightSchema },
      },
      required: ["summary", "nights"],
    },
  };
  return {
    declaration,
    schema: RevisionSubmission,
    label: (a) => `Submitting ${a.nights.length} revised night(s) for validation`,
    async execute(args, run) {
      const byDate = new Map(run.targets.map((t) => [t.date, t]));
      const unknown = args.nights.filter((n) => !byDate.has(n.date)).map((n) => n.date);
      if (unknown.length) {
        return { output: { accepted: false, errors: [`Not dates in this plan: ${unknown.join(", ")}`] }, summary: "Revision rejected: unknown dates" };
      }
      const targets: GameDate[] = args.nights.map((n) => ({ ...byDate.get(n.date)!, segment: (n.segment as SegmentId | undefined) ?? byDate.get(n.date)!.segment }));
      const anchors = args.nights.map((n) => resolveId(run, n.anchor_entity_id)).filter((id): id is string => Boolean(id));
      const segments = [...new Set(targets.map((t) => t.segment))];
      const unscored = missingFit(run, anchors, segments);
      if (unscored.length) await scoreCandidates(run.taste, unscored, segments);
      const unprofiled = anchors.filter((id) => !run.taste.profiles.has(id));
      if (unprofiled.length) await profileEntities(run.taste, unprofiled);

      const { plan: partial, errors, warnings } = assemblePlan({ ...run, targets }, { market_summary: base.marketSummary, nights: args.nights });
      if (!partial) return { output: { accepted: false, errors }, summary: `Revision rejected: ${errors.join("; ")}` };

      const changed = new Set(partial.nights.map((n) => n.date));
      const profiles = new Map([...base.profiles, ...partial.profiles].map((p) => [p.entity.id, p]));
      const merged: SeasonPlan = {
        ...base,
        id: revisedId,
        revisedFrom: base.id,
        runId: base.runId ?? base.id,
        nights: [...base.nights.filter((n) => !changed.has(n.date)), ...partial.nights].sort((a, b) => a.date.localeCompare(b.date)),
        profiles: [...profiles.values()].filter((p) => [...base.nights, ...partial.nights].some((n) => n.anchor.id === p.entity.id)),
        requests: [...base.requests, ...run.taste.recorder.logs],
        mode: { ...run.mode },
        revisions: [...(base.revisions ?? []), { at: new Date().toISOString(), request, summary: args.summary, changedDates: [...changed] }],
      };
      run.submitted = true;
      run.emit({ type: "plan", plan: merged });
      return {
        output: { accepted: true, warnings, scores: partial.nights.map((n) => ({ date: n.date, title: n.title, score: n.score.total })) },
        summary: `Revision accepted: ${partial.nights.map((n) => `${n.title} (${n.score.total})`).join(", ")}.`,
      };
    },
  };
}

/** "Ask the GM": answer a question about a plan, or revise specific nights with fresh Qloo research. */
export async function runRevision(
  base: SeasonPlan,
  request: string,
  send: (event: AgentEvent) => void,
  signal?: AbortSignal,
  options: { persist?: boolean } = {},
) {
  const started = Date.now();
  let revised: SeasonPlan | undefined;
  let repliedAfterPlan = false;
  const emit = (event: AgentEvent) => {
    if (event.type === "plan") revised = event.plan;
    if (event.type === "message" && revised) repliedAfterPlan = true;
    send(event);
  };
  const lastQ = Math.max(0, ...base.requests.map((r) => Number(r.id.slice(1)) || 0));
  const runSignal = runDeadline(signal, RUN_DEADLINE_MS);
  const recorder = new QlooRecorder((r) => emit({ type: "qloo_request", request: r }), lastQ, { budget: REVISION_QLOO_BUDGET, signal: runSignal });
  const taste = new TasteContext(recorder, base.team.venue.city, base.team.venue, base.team.sport);
  seedTaste(taste, base);
  const targets: GameDate[] = base.nights.map((n) => ({ date: n.date, weekday: n.weekday, time: n.time, segment: n.segment, target: true }));
  const mode = runMode();
  const run: RunContext = { id: base.id, taste, team: base.team, targets, mode, emit, kits: new Map(), signal: runSignal };
  let llmSteps = 0;

  emit({ type: "run_started", runId: base.id, mode, at: new Date().toISOString() });
  if (mode.llm !== "gemini") {
    emit({ type: "message", text: "Revisions need the Gemini agent, and no GEMINI_API_KEY is configured on this server." });
  } else {
    // Revisions fork: the revised plan gets its own id, so a shared link (or a featured plan) never changes under its readers.
    const submit = submitRevisionTool(base, request, crypto.randomUUID());
    const registry: ToolRegistry = {
      ...Object.fromEntries(RESEARCH_TOOLS.map((name) => [name, TOOLS[name]])),
      submit_revision: submit as unknown as ToolDef<never>,
    };
    try {
      const loop = await geminiLoop(run, started, signal, {
        system: REVISION_PROMPT,
        brief: buildRevisionBrief(base, request),
        declarations: Object.values(registry).map((t) => t.declaration),
        registry,
        deadlineMs: 150_000,
        replyAfterSubmit: true,
      });
      llmSteps = loop.steps;
      if (loop.failure && !revised) emit({ type: "error", message: `The GM couldn't reach Gemini (${loop.failure}). Try again in a minute.` });
    } catch (error) {
      emit({ type: "error", message: publicError(error, "The revision hit an unexpected error.") });
    }
  }
  // The model doesn't always add a closing line after submitting; fall back to its own summary.
  if (revised && !repliedAfterPlan) emit({ type: "message", text: revised.revisions?.at(-1)?.summary ?? "Plan updated." });
  emit({ type: "done", elapsedMs: Date.now() - started, qlooCalls: recorder.logs.length, llmSteps });
  if (revised && options.persist) await kvSet(`plan:${revised.id}`, revised, 90 * DAY);
}
