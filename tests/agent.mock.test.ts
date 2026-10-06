import { beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent, SeasonPlan, TeamConfig, ToolUIData } from "@/lib/types";

/**
 * End-to-end run of the agent with no API keys: Qloo answers from the deterministic simulator and
 * the autopilot planner drives the same tools Gemini would. This is the path the public demo and CI
 * take, so it must produce a valid, fully cited plan.
 */

type Of<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;

/** Every entity ID a tool surfaced to the planner (what the plan is allowed to cite). */
function idsFrom(ui: ToolUIData): string[] {
  switch (ui.kind) {
    case "market_scan":
      return ui.scan.domains.flatMap((d) => d.entities.map((e) => e.id));
    case "profiles":
      return ui.profiles.map((p) => p.entity.id);
    case "fit_matrix":
      return ui.rows.map((r) => r.entity.id);
    case "sponsors":
      return ui.brands.map((b) => b.id);
    case "experience":
      return [...ui.artists, ...ui.places, ...ui.podcasts].map((e) => e.id);
    case "search":
      return ui.results.map((r) => r.id);
    case "crossover":
      return [];
  }
}

describe("runAgent in simulated mode (no keys)", () => {
  const events: AgentEvent[] = [];
  let team: TeamConfig;
  let isAlcoholBrand: typeof import("@/lib/sensitivity").isAlcoholBrand;
  let sensitiveTopic: typeof import("@/lib/sensitivity").sensitiveTopic;
  let identityTheme: typeof import("@/lib/sensitivity").identityTheme;

  const ofType = <T extends AgentEvent["type"]>(type: T) => events.filter((e): e is Of<T> => e.type === type);

  beforeAll(async () => {
    // Keys must be absent before the agent modules load so every path runs simulated.
    delete process.env.QLOO_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { runAgent } = await import("@/lib/agent/run");
    const { PRESETS, teamFromPreset } = await import("@/lib/presets");
    ({ isAlcoholBrand, sensitiveTopic, identityTheme } = await import("@/lib/sensitivity"));

    team = teamFromPreset(PRESETS[0], 4);
    await runAgent(team, (event) => events.push(event));
  }, 60_000);

  it("announces a simulated, autopilot run", () => {
    const started = events[0] as Of<"run_started">;
    expect(started.type).toBe("run_started");
    expect(started.mode).toMatchObject({ qloo: "simulated", llm: "autopilot" });
    expect(started.mode.model).toBeUndefined();
  });

  it("finishes without errors and reports the run", () => {
    expect(ofType("error")).toEqual([]);
    const done = events.at(-1) as Of<"done">;
    expect(done.type).toBe("done");
    expect(done.llmSteps).toBe(0);
    expect(done.qlooCalls).toBe(ofType("qloo_request").length);
    expect(done.qlooCalls).toBeGreaterThan(10);
  });

  it("pairs every tool call with a successful result", () => {
    const calls = ofType("tool_call");
    const results = ofType("tool_result");
    expect(calls.length).toBeGreaterThan(0);
    expect(results.map((r) => r.callId).sort()).toEqual(calls.map((c) => c.callId).sort());
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(calls.map((c) => c.name)).toContain("scan_market_taste");
    expect(calls.at(-1)?.name).toBe("submit_season_plan");
  });

  it("emits one plan with a night on each target date", () => {
    const plans = ofType("plan");
    expect(plans).toHaveLength(1);
    const plan: SeasonPlan = plans[0].plan;
    const targets = team.dates.filter((d) => d.target).map((d) => d.date).sort();
    expect(targets).toHaveLength(4);
    expect(plan.nights).toHaveLength(4);
    expect(plan.nights.map((n) => n.date)).toEqual(targets);
    expect(plan.mode).toMatchObject({ qloo: "simulated", llm: "autopilot" });
    expect(new Set(plan.nights.map((n) => n.anchor.id)).size).toBe(4);
    for (const night of plan.nights) {
      expect(night.score.total).toBeGreaterThanOrEqual(0);
      expect(night.score.total).toBeLessThanOrEqual(100);
    }
  });

  it("only cites entities that a tool actually returned", () => {
    const returned = new Set(ofType("tool_result").flatMap((r) => (r.ui ? idsFrom(r.ui) : [])));
    const plan = ofType("plan")[0].plan;
    for (const night of plan.nights) {
      expect(returned.has(night.anchor.id), `anchor ${night.anchor.name}`).toBe(true);
      for (const s of night.sponsors) expect(returned.has(s.brand.id), `sponsor ${s.brand.name}`).toBe(true);
      for (const a of night.playlist) expect(returned.has(a.id), `artist ${a.name}`).toBe(true);
      for (const p of night.localPartners) expect(returned.has(p.place.id), `place ${p.place.name}`).toBe(true);
      if (night.mediaPartner) expect(returned.has(night.mediaPartner.podcast.id)).toBe(true);
    }
  });

  it("backs every night with recorded Qloo requests", () => {
    const requestIds = new Set(ofType("qloo_request").map((e) => e.request.id));
    expect(ofType("qloo_request").every((e) => e.request.simulated)).toBe(true);
    const plan = ofType("plan")[0].plan;
    expect(plan.requests.length).toBe(requestIds.size);
    for (const night of plan.nights) {
      expect(night.evidence.length).toBeGreaterThan(0);
      for (const id of night.evidence) expect(requestIds.has(id), `evidence ${id}`).toBe(true);
    }
  });

  it("respects the content rules the validator enforces", () => {
    const plan = ofType("plan")[0].plan;
    for (const night of plan.nights) {
      expect(sensitiveTopic(night.anchor)).toBeUndefined();
      expect(identityTheme(night.title, night.tagline)).toBeUndefined();
      if (night.segment === "families" || night.segment === "gen_z") {
        expect(night.sponsors.filter((s) => isAlcoholBrand(s.brand))).toEqual([]);
      }
    }
  });
});
