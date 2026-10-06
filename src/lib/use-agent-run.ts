"use client";

import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type {
  AgentEvent,
  EntityCard,
  EntityProfile,
  MarketScan,
  QlooRequestLog,
  RunMode,
  SeasonPlan,
  SegmentId,
  TeamConfig,
  ToolUIData,
} from "./types";

export interface TimelineTool {
  callId: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  summary?: string;
}

export type TimelineItem =
  | { id: string; kind: "thought" | "message"; text: string; at: number }
  | { id: string; kind: "tool"; tool: TimelineTool; at: number }
  | { id: string; kind: "llm"; step: number; status: "started" | "finished" | "interrupted"; ms?: number; outputTokens?: number; at: number };

export interface RunState {
  status: "idle" | "running" | "done" | "error";
  mode?: RunMode;
  timeline: TimelineItem[];
  requests: QlooRequestLog[];
  scan?: MarketScan;
  profiles: EntityProfile[];
  fit: { entity: EntityCard; fit: Partial<Record<SegmentId, number>> }[];
  sponsors: { anchor: string; brands: EntityCard[] }[];
  experiences: { anchor: string; artists: EntityCard[]; places: EntityCard[]; podcasts: EntityCard[] }[];
  crossovers: { a: string; b: string; tags: { name: string; score: number }[] }[];
  lastUi?: ToolUIData["kind"];
  plan?: SeasonPlan;
  error?: string;
  startedAt?: number;
  elapsedMs?: number;
  llmSteps?: number;
  events: AgentEvent[];
}

const initial: RunState = {
  status: "idle",
  timeline: [],
  requests: [],
  profiles: [],
  fit: [],
  sponsors: [],
  experiences: [],
  crossovers: [],
  events: [],
};

type Action =
  | { type: "reset" }
  | { type: "event"; event: AgentEvent }
  | { type: "fail"; message: string }
  | { type: "stopped" }
  | { type: "load"; plan: SeasonPlan }
  | { type: "replace_plan"; plan: SeasonPlan };

function mergeBy<T>(list: T[], items: T[], key: (t: T) => string) {
  const map = new Map(list.map((t) => [key(t), t]));
  for (const item of items) map.set(key(item), item);
  return [...map.values()];
}

function applyUi(state: RunState, ui: ToolUIData): RunState {
  switch (ui.kind) {
    case "market_scan":
      return {
        ...state,
        scan: state.scan ? { ...ui.scan, domains: mergeBy(state.scan.domains, ui.scan.domains, (d) => d.kind) } : ui.scan,
      };
    case "profiles":
      return { ...state, profiles: mergeBy(state.profiles, ui.profiles, (p) => p.entity.id) };
    case "fit_matrix":
      return { ...state, fit: mergeBy(state.fit, ui.rows, (r) => r.entity.id) };
    case "sponsors":
      return { ...state, sponsors: mergeBy(state.sponsors, [{ anchor: ui.anchor, brands: ui.brands }], (s) => s.anchor) };
    case "experience":
      return { ...state, experiences: mergeBy(state.experiences, [ui], (s) => s.anchor) };
    case "crossover":
      return { ...state, crossovers: [...state.crossovers, ui] };
    default:
      return state;
  }
}

/**
 * A Gemini step that never reported `finished` (deadline, API error, Stop). Steps run one at a time and report
 * before their tool calls, so a newer step or a tool call (e.g. from the autopilot) also means it is over.
 */
function closeLlm(timeline: TimelineItem[]): TimelineItem[] {
  return timeline.map((item) => (item.kind === "llm" && item.status === "started" ? { ...item, status: "interrupted" } : item));
}

/** Close rows still spinning when a run ends: no `finished` or `tool_result` is coming for them any more. */
function settle(timeline: TimelineItem[]): TimelineItem[] {
  return closeLlm(timeline).map((item) =>
    item.kind === "tool" && item.tool.status === "running"
      ? { ...item, tool: { ...item.tool, status: "error", summary: "Interrupted before it returned." } }
      : item,
  );
}

function reducer(state: RunState, action: Action): RunState {
  if (action.type === "reset") return { ...initial, status: "running", startedAt: Date.now() };
  if (action.type === "fail") return { ...state, status: "error", error: action.message, timeline: settle(state.timeline) };
  if (action.type === "stopped") {
    if (state.status !== "running") return state;
    return {
      ...state,
      status: state.plan ? "done" : "error",
      error: state.plan ? state.error : "Stopped before the GM finished.",
      timeline: settle(state.timeline),
      elapsedMs: state.startedAt ? Date.now() - state.startedAt : undefined,
    };
  }
  // Only the plan on screen may be replaced: a late result for another plan (or for the plan a new run cleared) is dropped.
  if (action.type === "replace_plan") return state.plan?.id === action.plan.id ? { ...state, plan: action.plan } : state;
  if (action.type === "load") return { ...initial, status: "done", plan: action.plan, mode: action.plan.mode, requests: action.plan.requests, profiles: action.plan.profiles };

  const event = action.event;
  const next = { ...state, events: [...state.events, event] };
  const now = Date.now();
  switch (event.type) {
    case "run_started":
      return { ...next, status: "running", mode: event.mode };
    case "thought":
    case "message":
      return { ...next, timeline: [...next.timeline, { id: `${event.type}-${next.timeline.length}`, kind: event.type, text: event.text, at: now }] };
    case "llm_step": {
      const id = `llm-${event.step}`;
      if (event.status === "started") {
        return { ...next, timeline: [...closeLlm(next.timeline), { id, kind: "llm", step: event.step, status: "started", at: now }] };
      }
      return {
        ...next,
        timeline: next.timeline.map((item) =>
          item.id === id && item.kind === "llm" ? { ...item, status: "finished", ms: event.ms, outputTokens: event.outputTokens } : item,
        ),
      };
    }
    case "tool_call":
      return {
        ...next,
        timeline: [
          ...closeLlm(next.timeline),
          {
            id: event.callId,
            kind: "tool",
            at: now,
            tool: { callId: event.callId, name: event.name, label: event.label, args: event.args, status: "running" },
          },
        ],
      };
    case "tool_result": {
      const timeline = next.timeline.map((item) =>
        item.kind === "tool" && item.tool.callId === event.callId
          ? { ...item, tool: { ...item.tool, status: event.ok ? ("ok" as const) : ("error" as const), summary: event.summary } }
          : item,
      );
      const withUi = event.ui ? applyUi({ ...next, timeline, lastUi: event.ui.kind }, event.ui) : { ...next, timeline };
      return withUi;
    }
    case "qloo_request":
      return { ...next, requests: [...next.requests, event.request] };
    case "plan":
      return { ...next, plan: event.plan };
    case "error":
      return { ...next, error: event.message };
    case "done":
      return {
        ...next,
        status: next.plan ? "done" : "error",
        timeline: settle(next.timeline),
        elapsedMs: event.elapsedMs,
        llmSteps: event.llmSteps,
        error: next.plan ? next.error : (next.error ?? "The agent finished without a plan."),
      };
    default:
      return next;
  }
}

// ---- local persistence (per-browser history of plans) ----

const STORE_KEY = "tngm:plans:v1";

const EMPTY: SeasonPlan[] = [];
let snapshot: { raw: string | null; plans: SeasonPlan[] } = { raw: null, plans: EMPTY };

function readPlans(): SeasonPlan[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw !== snapshot.raw) snapshot = { raw, plans: raw ? (JSON.parse(raw) as SeasonPlan[]) : EMPTY };
    return snapshot.plans;
  } catch {
    return EMPTY;
  }
}

function subscribePlans(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("tngm:plans", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("tngm:plans", onChange);
  };
}

/** Plans saved in this browser (newest first). */
export function useSavedPlans() {
  return useSyncExternalStore(subscribePlans, readPlans, () => EMPTY);
}

export function savePlan(plan: SeasonPlan) {
  try {
    const all = readPlans().filter((p) => p.id !== plan.id);
    localStorage.setItem(STORE_KEY, JSON.stringify([plan, ...all].slice(0, 12)));
    window.dispatchEvent(new Event("tngm:plans"));
  } catch {
    // storage full or unavailable — the plan is still on screen and downloadable
  }
}

export function useAgentRun() {
  const [state, dispatch] = useReducer(reducer, initial);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  // Abort when the owner unmounts (leaving Studio, closing the board) so the server stops spending Qloo
  // requests, Gemini tokens and a concurrent-run slot on a run nobody is watching. StrictMode re-runs
  // effects in dev (cleanup, then setup, synchronously), so only abort if no setup followed.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) abortRef.current?.abort();
      });
    };
  }, []);

  const handle = useCallback((event: AgentEvent) => {
    dispatch({ type: "event", event });
    if (event.type === "plan") savePlan(event.plan);
  }, []);

  const stream = useCallback(
    async (url: string, body: unknown, onPlan?: (plan: SeasonPlan) => void) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "reset" });
      let finished = false;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(Array.isArray(payload.error) ? payload.error.join("; ") : `Request failed (${response.status})`);
        }
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value.replace(/\r\n/g, "\n");
          let index: number;
          while ((index = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const event = JSON.parse(line.slice(6)) as AgentEvent;
              handle(event);
              if (event.type === "plan") onPlan?.(event.plan);
              if (event.type === "done") finished = true;
            }
          }
        }
        // maxDuration or a proxy cut the stream: no `done` is coming, so end the run here.
        if (!finished && !controller.signal.aborted) dispatch({ type: "fail", message: "The connection closed before the GM finished. Try again." });
      } catch (error) {
        // Aborts come from stop(), load(), a newer run or unmount, and each of those settles the state itself.
        if ((error as Error).name !== "AbortError") dispatch({ type: "fail", message: (error as Error).message });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [handle],
  );

  const start = useCallback((team: TeamConfig) => stream("/api/agent", team), [stream]);

  /** "Ask the GM": stream a revision of an existing plan; `onPlan` receives the merged plan. */
  const revise = useCallback(
    (plan: SeasonPlan, message: string, onPlan: (plan: SeasonPlan) => void) => stream("/api/revise", { plan, message }, onPlan),
    [stream],
  );

  /** Replay a recorded run (used for the instant demo) with realistic pacing. */
  const replay = useCallback(
    async (events: AgentEvent[], speed = 1) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "reset" });
      for (const event of events) {
        const delay = event.type === "qloo_request" ? 35 : event.type === "tool_call" ? 260 : event.type === "thought" ? 700 : 120;
        await new Promise((r) => setTimeout(r, delay / speed));
        // Checked after the wait: Stop (or a newer run) may have landed while we slept.
        if (controller.signal.aborted) return;
        handle(event);
      }
      if (!events.some((e) => e.type === "done")) dispatch({ type: "fail", message: "The recording ends before the run finished." });
      if (abortRef.current === controller) abortRef.current = null;
    },
    [handle],
  );

  const stop = useCallback(() => {
    const controller = abortRef.current;
    if (!controller) return;
    abortRef.current = null;
    controller.abort();
    dispatch({ type: "stopped" });
  }, []);

  const load = useCallback((plan: SeasonPlan) => {
    // A run still streaming would keep writing its events, and finally its own plan, over the one being opened.
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "load", plan });
  }, []);
  const setPlan = useCallback((plan: SeasonPlan) => {
    dispatch({ type: "replace_plan", plan });
    savePlan(plan);
  }, []);

  return { state, start, revise, replay, stop, load, setPlan };
}
