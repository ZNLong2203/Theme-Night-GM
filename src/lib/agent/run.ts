import "server-only";
import { FinishReason, GoogleGenAI, ThinkingLevel, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { PRESETS } from "@/lib/presets";
import { publicError } from "@/lib/errors";
import { QlooRecorder, qlooIsLive } from "@/lib/qloo/client";
import { DAY, kvSet, storeKind } from "@/lib/store";
import { TasteContext } from "@/lib/qloo/workflows";
import type { AgentEvent, RunMode, SeasonPlan, TeamConfig } from "@/lib/types";
import { runAutopilot } from "./autopilot";
import { buildBrief, SYSTEM_PROMPT } from "./prompt";
import { FUNCTION_DECLARATIONS, runTool, TOOLS, type RunContext, type ToolRegistry } from "./tools";

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const MAX_STEPS = 12;
/** Hard deadline for the LLM loop; the autopilot then finishes on cached Qloo data well inside maxDuration (300 s). */
const LLM_DEADLINE_MS = 190_000;
/** Everything (tools, Qloo retries, the safety net) stops here, so the stream always ends with `done` before maxDuration. */
export const RUN_DEADLINE_MS = 270_000;
/** Uncached Qloo requests one planning run may make (a normal live run makes ~90). */
const RUN_QLOO_BUDGET = 220;
/** Function calls executed per model turn; extra calls get an error so one turn can't flood the shared limiter. */
const MAX_CALLS_PER_TURN = 10;
const THINKING: Record<string, ThinkingLevel> = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };
const THINKING_LEVEL = THINKING[process.env.GEMINI_THINKING ?? "low"] ?? ThinkingLevel.LOW;

export function runMode(): RunMode {
  return {
    qloo: qlooIsLive() ? "live" : "simulated",
    llm: process.env.GEMINI_API_KEY ? "gemini" : "autopilot",
    model: process.env.GEMINI_API_KEY ? GEMINI_MODEL : undefined,
    store: storeKind(),
  };
}

const KEEP_FOR = 90 * DAY;
/** Run logs bigger than this aren't stored for replay (the plan itself still is). */
const MAX_RUN_LOG_BYTES = 3_000_000;

export async function runAgent(team: TeamConfig, send: (event: AgentEvent) => void, signal?: AbortSignal) {
  const started = Date.now();
  const runId = crypto.randomUUID();
  const log: AgentEvent[] = [];
  let plan: SeasonPlan | undefined;
  const emit = (event: AgentEvent) => {
    log.push(event);
    if (event.type === "plan") plan = event.plan;
    send(event);
  };
  const runSignal = runDeadline(signal, RUN_DEADLINE_MS);
  const recorder = new QlooRecorder((request) => emit({ type: "qloo_request", request }), 0, { budget: RUN_QLOO_BUDGET, signal: runSignal });
  const taste = new TasteContext(recorder, team.venue.city, team.venue, team.sport);
  const targets = team.dates.filter((d) => d.target).sort((a, b) => a.date.localeCompare(b.date));
  const mode = runMode();
  const run: RunContext = { id: runId, taste, team, targets, mode, emit, kits: new Map(), signal: runSignal };
  let llmSteps = 0;

  emit({ type: "run_started", runId, mode, at: new Date().toISOString() });

  if (!targets.length) {
    emit({ type: "error", message: "Pick at least one target date." });
    emit({ type: "done", elapsedMs: Date.now() - started, qlooCalls: 0, llmSteps: 0 });
    return;
  }

  try {
    if (mode.llm === "gemini") {
      const loop = await geminiLoop(run, started, signal, {
        system: SYSTEM_PROMPT,
        brief: buildBrief(run.team, run.targets),
        declarations: FUNCTION_DECLARATIONS,
        registry: TOOLS,
        nudge:
          "You haven't submitted an accepted plan yet. Finish any missing research, then call submit_season_plan with exactly one night per target date using only IDs from tool results.",
      });
      llmSteps = loop.steps;
      // The safety net exists for exactly this: a late, confused or unreachable model still yields a plan.
      if (!run.submitted && !runSignal.aborted) {
        await runAutopilot(run, {
          reason: loop.failure
            ? `Gemini returned an error (${loop.failure}) — finishing with the deterministic planner on the same Qloo evidence.`
            : "The model didn't land a valid plan in its step budget — finishing with the deterministic planner on the same Qloo evidence.",
        });
      }
    } else {
      // Deterministic: a second pass would pick the same nights, so there is no retry here.
      await runAutopilot(run);
    }
    if (!run.submitted) {
      emit({
        type: "error",
        message: signal?.aborted ? "Run stopped." : runSignal.aborted ? "The run hit its time limit before a plan was accepted." : "The agent finished without an accepted plan.",
      });
    }
  } catch (error) {
    emit({ type: "error", message: publicError(error, "The agent hit an unexpected error.") });
  }

  emit({ type: "done", elapsedMs: Date.now() - started, qlooCalls: recorder.logs.length, llmSteps });
  if (plan) await persistRun(plan, log);
}

/** The client's signal combined with a hard run deadline. */
export function runDeadline(signal: AbortSignal | undefined, ms: number) {
  const deadline = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/** Save the plan (shareable at /plan/<id>) and the event log (replayable in the studio). */
async function persistRun(plan: SeasonPlan, log: AgentEvent[]) {
  const saves: Promise<unknown>[] = [kvSet(`plan:${plan.id}`, plan, KEEP_FOR)];
  if (JSON.stringify(log).length <= MAX_RUN_LOG_BYTES) saves.push(kvSet(`run:${plan.id}`, log, KEEP_FOR));
  const preset = PRESETS.find((p) => p.teamName === plan.team.teamName && p.venue.city === plan.team.venue.city);
  if (preset && plan.mode.qloo === "live") {
    saves.push(kvSet(`featured:${preset.slug}`, { id: plan.id, at: plan.createdAt, team: plan.team.teamName }, KEEP_FOR));
  }
  await Promise.all(saves);
}

export interface LoopOptions {
  system: string;
  brief: string;
  declarations: FunctionDeclaration[];
  registry: ToolRegistry;
  /** Sent when the model stops calling tools before submitting; omit to accept a text-only answer. */
  nudge?: string;
  deadlineMs?: number;
  /** Give the model one more turn after an accepted submission so it can summarize the change. */
  replyAfterSubmit?: boolean;
}

/**
 * Gemini function-calling loop shared by the planner and the revision agent. It never throws for a
 * Gemini error: it returns the failure so the caller can fall back (the planner's safety net).
 */
export async function geminiLoop(
  run: RunContext,
  started: number,
  signal: AbortSignal | undefined,
  options: LoopOptions,
): Promise<{ steps: number; failure?: string }> {
  // Transient 429/503s are retried by the SDK before they count as a failure.
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { retryOptions: { attempts: 3, initialDelay: 1, maxDelay: 8 } } });
  const contents: Content[] = [{ role: "user", parts: [{ text: options.brief }] }];
  let nudges = 0;
  let steps = 0;
  let finalTurn = false;
  let failure: string | undefined;

  const deadline = AbortSignal.timeout(Math.max(1_000, (options.deadlineMs ?? LLM_DEADLINE_MS) - (Date.now() - started)));
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (abort.aborted) break;
    steps += 1;
    let response;
    const stepStarted = Date.now();
    run.emit({ type: "llm_step", step: steps, status: "started" });
    try {
      response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction: options.system,
          tools: [{ functionDeclarations: options.declarations }],
          thinkingConfig: { thinkingLevel: THINKING_LEVEL, includeThoughts: true },
          abortSignal: abort,
        },
      });
    } catch (error) {
      run.emit({ type: "llm_step", step: steps, status: "finished", ms: Date.now() - stepStarted });
      if (abort.aborted) break; // deadline or client disconnect: fall through to the safety net
      console.error("[gemini]", error);
      failure = geminiFailure(error);
      break;
    }

    const usage = response.usageMetadata;
    run.emit({
      type: "llm_step",
      step: steps,
      status: "finished",
      ms: Date.now() - stepStarted,
      inputTokens: usage?.promptTokenCount,
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    });
    const candidate = response.candidates?.[0];
    const content = candidate?.content;
    if (!content?.parts?.length) {
      if (candidate?.finishReason === FinishReason.MALFORMED_FUNCTION_CALL && nudges < 3) {
        nudges += 1;
        contents.push({
          role: "user",
          parts: [{ text: "Your last function call was malformed. Call the tool again with valid JSON arguments." }],
        });
        continue;
      }
      break;
    }

    // Keep the model turn verbatim: it carries the thought signatures Gemini 3 needs on the next request.
    contents.push(content);

    const calls = content.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    for (const part of content.parts) {
      if (part.functionCall || !part.text?.trim()) continue;
      run.emit({ type: part.thought ? "thought" : "message", text: part.text.trim() });
    }

    if (finalTurn) break;
    if (!calls.length) {
      if (run.submitted || !options.nudge || nudges >= 2) break;
      nudges += 1;
      contents.push({ role: "user", parts: [{ text: options.nudge }] });
      continue;
    }

    const responses: Part[] = await Promise.all(
      calls.map(async (call, i) => {
        const callId = call.id ?? `s${step}_${i}`;
        const output =
          i < MAX_CALLS_PER_TURN
            ? await runTool(call.name ?? "", call.args, callId, run, options.registry)
            : { error: `Skipped: at most ${MAX_CALLS_PER_TURN} tool calls run per turn. Batch IDs into fewer calls.` };
        const isError = Boolean(output && typeof output === "object" && "error" in output);
        return {
          functionResponse: {
            id: call.id,
            name: call.name,
            response: isError ? (output as Record<string, unknown>) : { output },
          },
        };
      }),
    );
    contents.push({ role: "user", parts: responses });

    if (run.submitted) {
      if (!options.replyAfterSubmit) break;
      finalTurn = true;
    }
  }
  return { steps, failure };
}

/** A short, safe description of a Gemini error (full details stay in the server log). */
function geminiFailure(error: unknown): string {
  const status = (error as { status?: number }).status;
  if (status === 429) return "rate limit or quota (429)";
  if (status === 503 || status === 500) return `model unavailable (${status})`;
  if (status === 401 || status === 403) return `API key rejected (${status})`;
  return status ? `HTTP ${status}` : "request failed";
}
