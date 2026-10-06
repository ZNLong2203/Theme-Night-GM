"use client";

import { FlaskConical, Loader2, SearchX } from "lucide-react";
import { useState } from "react";
import { formatDate, SEGMENTS } from "@/lib/schedule";
import type { BaselineResult, SeasonPlan } from "@/lib/types";
import { savePlan } from "@/lib/use-agent-run";
import { Badge, Button, Card, cn, EntityAvatar, ScoreRing } from "../ui";

/**
 * The control group. Same dates, same model, no Qloo tools — then both plans are scored with the
 * same Qloo-backed formula so the difference Qloo makes is measured, not claimed.
 */
export function BaselineCompare({ plan }: { plan: SeasonPlan }) {
  const [result, setResult] = useState<BaselineResult | undefined>(plan.baseline);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function run() {
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch("/api/baseline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan.team),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(Array.isArray(body.error) ? body.error.join(" ") : (body.error ?? "Control run failed"));
      setResult(body);
      savePlan({ ...plan, baseline: body });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const gmAvg = avg(plan.nights.map((n) => n.score.total));
  const baseScores = result?.nights.map((n) => n.score?.total ?? 0) ?? [];
  const baseAvg = avg(baseScores);
  const notFound = result?.nights.filter((n) => !n.found).length ?? 0;

  return (
    <Card className="mt-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <div className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
            <FlaskConical size={13} /> Control group
          </div>
          <h3 className="font-display text-2xl font-bold uppercase tracking-wide">Same dates. Same model. No Qloo.</h3>
          <p className="mt-1 text-sm text-muted">
            We ask {result?.mode.llm === "gemini" || plan.mode.llm === "gemini" ? "the same Gemini model" : "a generic planner"} to program these dates
            with no taste data. Then we fact-check its picks with Qloo using the exact same Taste Fit formula.
          </p>
        </div>
        {!result && (
          <Button onClick={run} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
            Run the LLM-only control
          </Button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-rose">{error}</p>}

      {result && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-bg p-3">
              <div className="text-xs text-muted">LLM-only avg Taste Fit</div>
              <div className="font-display text-3xl font-bold text-rose">{baseAvg}</div>
            </div>
            <div className="rounded-lg border border-amber/30 bg-amber/5 p-3">
              <div className="text-xs text-muted">Theme Night GM avg Taste Fit</div>
              <div className="font-display text-3xl font-bold text-turf">{gmAvg}</div>
            </div>
            <div className="rounded-lg border border-line bg-bg p-3">
              <div className="text-xs text-muted">Difference Qloo made</div>
              <div className="font-display text-3xl font-bold text-amber">
                {gmAvg - baseAvg > 0 ? "+" : ""}
                {gmAvg - baseAvg} pts
              </div>
              {notFound > 0 && <div className="text-[11px] text-faint">{notFound} LLM pick(s) not found in Qloo&apos;s graph (scored 0)</div>}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">LLM-only pick</th>
                  <th className="pb-2 font-medium">Theme Night GM pick</th>
                </tr>
              </thead>
              <tbody>
                {plan.nights.map((night) => {
                  const b = result.nights.find((n) => n.date === night.date);
                  return (
                    <tr key={night.date} className="border-t border-line align-top">
                      <td className="py-3 pr-3">
                        <div className="font-mono text-xs text-text">
                          {night.weekday} {formatDate(night.date)}
                        </div>
                        <div className="text-[11px] text-faint">
                          {SEGMENTS[night.segment].emoji} {SEGMENTS[night.segment].label}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-start gap-3">
                          {b?.score ? <ScoreRing value={b.score.total} size={40} stroke={4} /> : <SearchX size={22} className="mt-2 text-faint" />}
                          <div className="min-w-0">
                            <div className="font-semibold text-muted">{b?.title}</div>
                            <div className="text-xs text-faint">
                              anchor: {b?.anchorName}
                              {b && !b.found && <Badge className="ml-1">not in Qloo</Badge>}
                            </div>
                            {b?.score && (
                              <div className="mt-1 font-mono text-[10px] text-faint">
                                local {b.score.localAffinity.toFixed(2)} · fit {b.score.segmentFit.toFixed(2)} · reach {b.score.newFanReach.toFixed(2)}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={cn("py-3")}>
                        <div className="flex items-start gap-3">
                          <ScoreRing value={night.score.total} size={40} stroke={4} />
                          <div className="min-w-0">
                            <div className="font-semibold text-text">{night.title}</div>
                            <div className="flex items-center gap-1 text-xs text-muted">
                              <EntityAvatar entity={night.anchor} size={16} className="rounded" /> {night.anchor.name}
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-faint">
                              local {night.score.localAffinity.toFixed(2)} · fit {night.score.segmentFit.toFixed(2)} · reach{" "}
                              {night.score.newFanReach.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 font-mono text-[10px] text-faint">
            Control fact-check used {result.requests.length} Qloo requests ({result.mode.qloo}). Scores use the same weights as the plan.
          </p>
        </>
      )}
    </Card>
  );
}
