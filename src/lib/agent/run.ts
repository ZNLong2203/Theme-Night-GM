import "server-only";
import { FinishReason, GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import { QlooRecorder, qlooIsLive } from "@/lib/qloo/client";
import { TasteContext } from "@/lib/qloo/workflows";
import type { AgentEvent, RunMode, TeamConfig } from "@/lib/types";
import { runAutopilot } from "./autopilot";
import { buildBrief, SYSTEM_PROMPT } from "./prompt";
import { FUNCTION_DECLARATIONS, runTool, type RunContext } from "./tools";

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const MAX_STEPS = 12;
/** Hard deadline for the LLM loop; the autopilot then finishes on cached Qloo data well inside maxDuration (300 s). */
const LLM_DEADLINE_MS = 200_000;
const THINKING: Record<string, ThinkingLevel> = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };
const THINKING_LEVEL = THINKING[process.env.GEMINI_THINKING ?? "low"] ?? ThinkingLevel.LOW;

export function runMode(): RunMode {
  return {
    qloo: qlooIsLive() ? "live" : "simulated",
    llm: process.env.GEMINI_API_KEY ? "gemini" : "autopilot",
    model: process.env.GEMINI_API_KEY ? GEMINI_MODEL : undefined,
  };
}

export async function runAgent(team: TeamConfig, emit: (event: AgentEvent) => void, signal?: AbortSignal) {
  const started = Date.now();
  const recorder = new QlooRecorder((request) => emit({ type: "qloo_request", request }));
  const taste = new TasteContext(recorder, team.venue.city, team.venue, team.sport);
  const targets = team.dates.filter((d) => d.target).sort((a, b) => a.date.localeCompare(b.date));
  const mode = runMode();
  const run: RunContext = { taste, team, targets, mode, emit, kits: new Map() };
  let llmSteps = 0;

  emit({ type: "run_started", runId: crypto.randomUUID(), mode, at: new Date().toISOString() });

  if (!targets.length) {
    emit({ type: "error", message: "Pick at least one target date." });
    emit({ type: "done", elapsedMs: Date.now() - started, qlooCalls: 0, llmSteps: 0 });
    return;
  }

  try {
    if (mode.llm === "gemini") {
      llmSteps = await geminiLoop(run, started, signal);
    } else {
      await runAutopilot(run);
    }
    if (!run.submitted && !signal?.aborted) {
      await runAutopilot(run, {
        reason: "The model didn't land a valid plan in its step budget — finishing with the deterministic planner on the same Qloo evidence.",
      });
    }
  } catch (error) {
    emit({ type: "error", message: (error as Error).message ?? "Agent failed" });
  }

  emit({ type: "done", elapsedMs: Date.now() - started, qlooCalls: recorder.logs.length, llmSteps });
}

async function geminiLoop(run: RunContext, started: number, signal?: AbortSignal): Promise<number> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const contents: Content[] = [{ role: "user", parts: [{ text: buildBrief(run.team, run.targets) }] }];
  let nudges = 0;
  let steps = 0;

  const deadline = AbortSignal.timeout(Math.max(1_000, LLM_DEADLINE_MS - (Date.now() - started)));
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
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
          thinkingConfig: { thinkingLevel: THINKING_LEVEL, includeThoughts: true },
          abortSignal: abort,
        },
      });
    } catch (error) {
      if (abort.aborted) break; // deadline or client disconnect: fall through to the safety net
      throw error;
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

    if (!calls.length) {
      if (run.submitted || nudges >= 2) break;
      nudges += 1;
      contents.push({
        role: "user",
        parts: [
          {
            text: "You haven't submitted an accepted plan yet. Finish any missing research, then call submit_season_plan with exactly one night per target date using only IDs from tool results.",
          },
        ],
      });
      continue;
    }

    const responses: Part[] = await Promise.all(
      calls.map(async (call, i) => {
        const callId = call.id ?? `s${step}_${i}`;
        const output = await runTool(call.name ?? "", call.args, callId, run);
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

    if (run.submitted) break;
  }
  return steps;
}
