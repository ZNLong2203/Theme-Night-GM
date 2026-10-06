"use client";

import { ArrowRight, PlayCircle, Receipt } from "lucide-react";
import Link from "next/link";
import { Receipts } from "@/components/studio/receipts";
import { SeasonBoard } from "@/components/studio/season-board";
import { Card } from "@/components/ui";
import type { SeasonPlan } from "@/lib/types";

export function SharedPlan({ plan }: { plan: SeasonPlan }) {
  // A fixed time zone: the server renders in UTC, and a viewer's local zone would make hydration disagree.
  const created = `${new Date(plan.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <p className="text-sm text-muted">
          Shared plan · generated {created} · {plan.mode.qloo === "live" ? "live Qloo data" : "simulated data"}
          {plan.mode.model ? ` · ${plan.mode.model}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/studio?replay=${plan.runId ?? plan.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs font-semibold hover:border-amber/60 hover:text-amber"
          >
            <PlayCircle size={14} /> Replay how the GM built it
          </Link>
          <Link href="/studio" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber px-3 text-xs font-semibold text-amber-ink hover:bg-[#ffc56e]">
            Plan your own team <ArrowRight size={14} />
          </Link>
        </div>
      </div>
      <SeasonBoard plan={plan} />
      <Card className="no-print mt-8 p-4">
        <div className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-muted">
          <Receipt size={14} className="text-amber" /> Every Qloo request behind this plan
        </div>
        <Receipts requests={plan.requests} />
      </Card>
    </>
  );
}
