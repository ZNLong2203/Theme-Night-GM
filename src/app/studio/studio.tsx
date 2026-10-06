"use client";

import { ArrowLeft, History, Loader2, RotateCcw, Square, Timer } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ModeBadges, SiteHeader } from "@/components/site-header";
import { AgentTrace } from "@/components/studio/agent-trace";
import { LiveCanvas } from "@/components/studio/live-canvas";
import { SeasonBoard } from "@/components/studio/season-board";
import { TeamSetup } from "@/components/studio/team-setup";
import { Button, Card } from "@/components/ui";
import { PRESETS, teamFromPreset } from "@/lib/presets";
import type { AgentEvent, TeamConfig } from "@/lib/types";
import { useAgentRun, useSavedPlans } from "@/lib/use-agent-run";

export function Studio() {
  const params = useSearchParams();
  const preset = PRESETS.find((p) => p.slug === params.get("preset")) ?? PRESETS[0];
  const [team, setTeam] = useState<TeamConfig>(() => teamFromPreset(preset));
  const [view, setView] = useState<"setup" | "run">(() => (params.get("autorun") || params.get("replay") ? "run" : "setup"));
  const recent = useSavedPlans();
  const { state, start, replay, stop, load, setPlan } = useAgentRun();
  const [now, setNow] = useState(() => Date.now());
  const booted = useRef(false);

  // ?autorun=1 starts a live run. ?replay=<run id> (or ?replay=1&preset=<slug> for the latest featured
  // run) plays back a recorded live run instantly — no waiting, no extra API spend.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const replayParam = params.get("replay");
    if (replayParam) {
      const runId: Promise<string | undefined> = /^[0-9a-f-]{36}$/.test(replayParam)
        ? Promise.resolve(replayParam)
        : fetch("/api/featured")
            .then((r) => r.json())
            .then((rows: { slug: string; id: string }[]) => rows.find((row) => row.slug === preset.slug)?.id);
      runId
        .then((id) => (id ? fetch(`/api/runs/${id}`) : Promise.reject(new Error("no recorded run"))))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("run expired"))))
        .then((events: AgentEvent[]) => {
          const planEvent = events.find((e) => e.type === "plan");
          if (planEvent?.type === "plan") setTeam(planEvent.plan.team);
          replay(events, 2);
        })
        .catch(() => start(team));
    } else if (params.get("autorun")) {
      start(team);
      // Consumed: a reload (or Back to this entry) must not quietly start, and pay for, another live run.
      const rest = new URLSearchParams(params.toString());
      rest.delete("autorun");
      const query = rest.toString();
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
    }
  }, [params, preset.slug, replay, start, team]);

  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state.status]);

  const run = () => {
    setView("run");
    start(team);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const running = state.status === "running";
  const elapsed = state.elapsedMs ?? (state.startedAt ? now - state.startedAt : 0);

  return (
    <>
      <SiteHeader mode={state.mode} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {view === "setup" ? (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber">Studio</div>
                <h1 className="font-display text-3xl font-bold uppercase tracking-wide md:text-4xl">Brief your GM</h1>
                <p className="mt-1 max-w-2xl text-sm text-muted">
                  Tell the agent about your club and which dates need help. It reads your market through Qloo&apos;s taste graph, then programs
                  each night — with sponsors, playlist, partners and promo copy — and shows every request behind every pick.
                </p>
              </div>
              {state.plan && (
                <Button variant="outline" onClick={() => setView("run")}>
                  Back to current plan
                </Button>
              )}
            </div>
            {recent.length > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted">
                <History size={14} /> Recent plans:
                {recent.slice(0, 5).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      load(p);
                      setTeam(p.team);
                      setView("run");
                    }}
                    className="rounded-md border border-line px-2 py-1 hover:border-amber/50 hover:text-text"
                  >
                    {p.team.teamName} · {new Date(p.createdAt).toLocaleDateString()}
                  </button>
                ))}
              </div>
            )}
            <TeamSetup team={team} onChange={setTeam} onRun={run} running={running} />
          </>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setView("setup")}>
                  <ArrowLeft size={14} /> Setup
                </Button>
                <div>
                  <div className="font-display text-xl font-bold uppercase tracking-wide">{team.teamName}</div>
                  <div className="text-xs text-muted">
                    {team.venue.city} · {team.dates.filter((d) => d.target).length} target dates
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ModeBadges mode={state.mode} />
                <span className="flex items-center gap-1 font-mono text-xs text-muted">
                  <Timer size={13} /> {(elapsed / 1000).toFixed(0)}s · {state.requests.length} Qloo requests
                </span>
                {running ? (
                  <Button variant="outline" size="sm" onClick={stop}>
                    <Square size={13} /> Stop
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={run}>
                    <RotateCcw size={13} /> Re-run
                  </Button>
                )}
              </div>
            </div>

            {state.error && (
              <Card className="mb-4 border-rose/40 bg-rose/5 p-3 text-sm text-rose">
                {state.error}
              </Card>
            )}

            {state.plan && <SeasonBoard plan={state.plan} onPlanChange={state.status === "running" ? undefined : setPlan} />}

            <section className={state.plan ? "mt-8" : ""}>
              {state.plan && (
                <h3 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-muted">How the GM built this plan</h3>
              )}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
                <Card className="scroll-thin max-h-[640px] overflow-y-auto p-4">
                  <div className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-muted">
                    {running && <Loader2 size={14} className="animate-spin text-amber" />} Agent trace
                  </div>
                  <AgentTrace timeline={state.timeline} requests={state.requests} running={running} />
                </Card>
                <LiveCanvas state={state} venue={team.venue} />
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
