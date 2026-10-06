"use client";

import { AlertTriangle, Brain, CheckCircle2, ChevronRight, Loader2, MessageSquare, Sparkles, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TimelineItem } from "@/lib/use-agent-run";
import type { QlooRequestLog } from "@/lib/types";
import { Badge, cn } from "../ui";

const TOOL_TITLES: Record<string, string> = {
  scan_market_taste: "Read the room",
  profile_fandoms: "Size the fandoms",
  score_audience_fit: "Fit the audience",
  find_sponsors: "Find sponsors",
  build_night_experience: "Build the night",
  compare_fanbases: "Compare fan bases",
  search_entities: "Look up",
  submit_season_plan: "Submit plan",
};

export function AgentTrace({ timeline, requests, running }: { timeline: TimelineItem[]; requests: QlooRequestLog[]; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [timeline.length]);

  const byCall = new Map<string, QlooRequestLog[]>();
  for (const r of requests) if (r.callId) byCall.set(r.callId, [...(byCall.get(r.callId) ?? []), r]);

  return (
    <ol className="relative space-y-2.5">
      {timeline.map((item) => {
        if (item.kind === "llm") {
          return (
            <li key={item.id} className="flex items-center gap-2 pl-1 font-mono text-[11px] text-faint">
              {item.status === "started" ? (
                <Loader2 size={12} className="animate-spin text-sky" />
              ) : item.status === "interrupted" ? (
                <AlertTriangle size={12} />
              ) : (
                <Sparkles size={12} className="text-sky" />
              )}
              {item.status === "started" ? (
                <span className="text-sky">Gemini is deciding the next step…</span>
              ) : item.status === "interrupted" ? (
                <span>Gemini step {item.step} · interrupted</span>
              ) : (
                <span>
                  Gemini step {item.step} · {((item.ms ?? 0) / 1000).toFixed(1)}s{item.outputTokens ? ` · ${item.outputTokens.toLocaleString()} tokens` : ""}
                </span>
              )}
            </li>
          );
        }
        if (item.kind !== "tool") {
          return (
            <li key={item.id} className="flex gap-2.5">
              <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md", item.kind === "thought" ? "bg-violet/10 text-violet" : "bg-sky/10 text-sky")}>
                {item.kind === "thought" ? <Brain size={13} /> : <MessageSquare size={13} />}
              </span>
              <p className={cn("text-[13px] leading-relaxed", item.kind === "thought" ? "italic text-muted" : "text-text")}>{item.text}</p>
            </li>
          );
        }
        const { tool } = item;
        const calls = byCall.get(tool.callId) ?? [];
        const expanded = open === tool.callId;
        return (
          <li key={item.id} className="rounded-lg border border-line bg-bg">
            <button className="flex w-full items-start gap-2.5 p-2.5 text-left" onClick={() => setOpen(expanded ? null : tool.callId)}>
              <span
                className={cn(
                  "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md",
                  tool.status === "running" && "bg-amber/10 text-amber",
                  tool.status === "ok" && "bg-turf/10 text-turf",
                  tool.status === "error" && "bg-rose/10 text-rose",
                )}
              >
                {tool.status === "running" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : tool.status === "ok" ? (
                  <CheckCircle2 size={13} />
                ) : (
                  <AlertTriangle size={13} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-display text-sm font-bold uppercase tracking-wide text-text">{TOOL_TITLES[tool.name] ?? tool.name}</span>
                  <code className="font-mono text-[10px] text-faint">{tool.name}()</code>
                  {calls.length > 0 && (
                    <Badge tone="amber" title="Qloo API requests behind this step">
                      {calls.length} Qloo {calls.length === 1 ? "call" : "calls"}
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{tool.summary ?? tool.label}</span>
              </span>
              {calls.length > 0 && <ChevronRight size={14} className={cn("mt-1 text-faint transition-transform", expanded && "rotate-90")} />}
            </button>
            {expanded && (
              <div className="space-y-1 border-t border-line px-2.5 py-2">
                {calls.map((r) => (
                  <div key={r.id} className="flex items-baseline gap-2 font-mono text-[11px]">
                    <span className="text-amber">{r.id}</span>
                    <span className="text-sky">{r.endpoint}</span>
                    <span className="truncate text-muted">{r.purpose}</span>
                    <span className="ml-auto shrink-0 text-faint">
                      {r.resultCount} results · {r.cached ? "cached" : `${r.ms}ms`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
      {running && (
        <li className="flex items-center gap-2.5 pl-1 text-xs text-muted">
          <span className="pulse-dot h-2 w-2 rounded-full bg-amber" /> GM is working…
        </li>
      )}
      {!timeline.length && !running && (
        <li className="flex items-center gap-2 text-xs text-faint">
          <Wrench size={13} /> The agent&apos;s steps will appear here.
        </li>
      )}
      <div ref={end} />
    </ol>
  );
}
