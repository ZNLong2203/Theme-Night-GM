"use client";

import { Loader2, MessagesSquare, Send, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate, SEGMENTS } from "@/lib/schedule";
import type { SeasonPlan } from "@/lib/types";
import { useAgentRun } from "@/lib/use-agent-run";
import { Button, Card, cn, ModelText } from "../ui";
import { AgentTrace } from "./agent-trace";

/** Follow-up chat: the GM answers questions about the plan or revises specific nights with fresh Qloo research. */
export function AskTheGm({ plan, onPlanChange }: { plan: SeasonPlan; onPlanChange: (plan: SeasonPlan) => void }) {
  const { state, revise, stop } = useAgentRun();
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState<string>();
  const running = state.status === "running";
  const replies = state.timeline.filter((item) => item.kind === "message");
  const steps = state.timeline.filter((item) => item.kind === "tool").length;

  const suggestions = useMemo(() => {
    const first = plan.nights[0];
    const nonFamily = plan.nights.find((n) => n.segment !== "families");
    return [
      nonFamily && `Make ${nonFamily.weekday} ${formatDate(nonFamily.date)} a families night with a different fandom`,
      first && `Why did you pick ${first.anchor.name} for ${formatDate(first.date)}?`,
      `Find a beverage sponsor for every night that doesn't have one`,
      plan.nights.length > 1 && `Swap the ${SEGMENTS[plan.nights[plan.nights.length - 1].segment].label} night for something more local`,
    ].filter((s): s is string => Boolean(s));
  }, [plan]);

  const ask = (text: string) => {
    const message = text.trim();
    if (message.length < 3 || running) return;
    setAsked(message);
    setDraft("");
    revise(plan, message, onPlanChange);
  };

  return (
    <Card className="no-print mt-5 p-5">
      <div className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
        <MessagesSquare size={13} /> Ask the GM
      </div>
      <h3 className="font-display text-2xl font-bold uppercase tracking-wide">Push back on the plan</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Ask why, or ask for a change. The GM re-runs only the Qloo research it needs, revises just those nights, and the validator checks them
        like the original plan.
      </p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder="e.g. Move the May 6 night to young pros and find a craft-soda sponsor"
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm text-text outline-none placeholder:text-faint focus:border-amber/60"
        />
        {running ? (
          <Button type="button" variant="outline" onClick={stop}>
            <Square size={14} /> Stop
          </Button>
        ) : (
          <Button type="submit" disabled={draft.trim().length < 3}>
            <Send size={15} /> Ask
          </Button>
        )}
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            disabled={running}
            onClick={() => ask(s)}
            className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-amber/50 hover:text-text disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      {asked && (
        <div className="mt-5 space-y-3">
          <div className="ml-auto max-w-xl rounded-xl rounded-br-sm bg-amber/10 px-3.5 py-2 text-sm text-text">{asked}</div>
          {replies.map((r) =>
            r.kind === "message" ? (
              <div key={r.id} className="max-w-2xl rounded-xl rounded-bl-sm border border-line bg-bg px-3.5 py-2 text-sm leading-relaxed text-text">
                <ModelText text={r.text} />
              </div>
            ) : null,
          )}
          {running && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={13} className="animate-spin text-amber" /> The GM is on it…
            </div>
          )}
          {state.error && <p className="text-sm text-rose">{state.error}</p>}
          {state.timeline.length > 0 && (
            <details className={cn("rounded-lg border border-line bg-bg", running && "open")} open={running}>
              <summary className="cursor-pointer px-3 py-2 text-xs text-muted">
                Show the GM&apos;s work · {steps} tool call{steps === 1 ? "" : "s"} · {state.requests.length} Qloo request
                {state.requests.length === 1 ? "" : "s"}
              </summary>
              <div className="scroll-thin max-h-80 overflow-y-auto border-t border-line p-3">
                <AgentTrace timeline={state.timeline.filter((i) => i.kind !== "message")} requests={state.requests} running={running} />
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
