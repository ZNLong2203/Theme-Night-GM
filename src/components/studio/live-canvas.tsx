"use client";

import { ArrowUpRight, Flame, Map as MapIcon, Receipt, Store, Table2, Users } from "lucide-react";
import { useState } from "react";
import { SEGMENTS } from "@/lib/schedule";
import type { EntityProfile, SegmentId, Venue } from "@/lib/types";
import type { RunState } from "@/lib/use-agent-run";
import { HeatMap } from "../heat-map";
import { Badge, Card, cn, EntityAvatar, KIND_META, KindBadge, Meter } from "../ui";
import { DemographicsBars, TrendSpark } from "../viz";
import { Receipts } from "./receipts";

type Tab = "market" | "fandoms" | "fit" | "kits" | "receipts";

const TABS: { id: Tab; label: string; icon: typeof Flame }[] = [
  { id: "market", label: "Market", icon: Flame },
  { id: "fandoms", label: "Fandoms", icon: MapIcon },
  { id: "fit", label: "Audience fit", icon: Table2 },
  { id: "kits", label: "Night kits", icon: Store },
  { id: "receipts", label: "Receipts", icon: Receipt },
];

const UI_TO_TAB: Record<string, Tab> = {
  market_scan: "market",
  profiles: "fandoms",
  fit_matrix: "fit",
  sponsors: "kits",
  experience: "kits",
  crossover: "kits",
};

export function LiveCanvas({ state, venue }: { state: RunState; venue: Venue }) {
  // Follow the agent to whichever evidence it just produced, until the user picks a tab themselves.
  const [pinnedTab, setPinnedTab] = useState<Tab>();
  const tab: Tab = pinnedTab ?? (state.lastUi ? (UI_TO_TAB[state.lastUi] ?? "market") : state.plan && !state.scan ? "receipts" : "market");

  const counts: Record<Tab, number> = {
    market: state.scan?.domains.reduce((n, d) => n + d.entities.length, 0) ?? 0,
    fandoms: state.profiles.length,
    fit: state.fit.length,
    kits: state.sponsors.length + state.experiences.length,
    receipts: state.requests.length,
  };

  return (
    <Card className="flex min-h-[560px] flex-col overflow-hidden">
      <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-2 pt-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPinnedTab(id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold",
              tab === id ? "border-amber text-amber" : "border-transparent text-muted hover:text-text",
            )}
          >
            <Icon size={14} />
            {label}
            {counts[id] > 0 && <span className="rounded bg-surface-2 px-1 font-mono text-[10px] text-faint">{counts[id]}</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 p-4">
        {tab === "market" && <MarketBoard state={state} />}
        {tab === "fandoms" && <FandomBoard profiles={state.profiles} venue={venue} />}
        {tab === "fit" && <FitMatrix rows={state.fit} />}
        {tab === "kits" && <KitBoard state={state} />}
        {tab === "receipts" && <Receipts requests={state.requests} />}
      </div>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full min-h-[300px] place-items-center text-center text-sm text-faint">{children}</div>;
}

function MarketBoard({ state }: { state: RunState }) {
  if (!state.scan) return <Empty>Waiting for the GM to read the room…</Empty>;
  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        What <span className="text-text">{state.scan.city}</span> has the strongest Qloo affinity for. <span className="text-turf">↑ lift</span> = places higher
        locally than by national popularity.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {state.scan.domains.map((domain) => (
          <div key={domain.kind} className="rounded-lg border border-line bg-bg p-3">
            <div className="mb-2 flex items-center justify-between">
              <KindBadge kind={domain.kind} />
              <span className="font-mono text-[10px] text-faint">{domain.evidence}</span>
            </div>
            <ul className="space-y-2">
              {domain.entities.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <EntityAvatar entity={e} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-text">{e.name}</span>
                      {(e.lift ?? 0) > 2 && (
                        <span className="flex shrink-0 items-center font-mono text-[10px] text-turf" title={`#${e.localRank} locally vs #${e.nationalRank} by national popularity`}>
                          <ArrowUpRight size={10} />
                          {e.lift}
                        </span>
                      )}
                    </div>
                    <Meter value={e.affinity ?? 0} className="mt-1 h-1" color={KIND_META[e.kind].color} />
                  </div>
                  <span className="w-9 text-right font-mono text-[10px] text-muted">{e.affinity?.toFixed(2) ?? "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FandomBoard({ profiles, venue }: { profiles: EntityProfile[]; venue: Venue }) {
  const [selected, setSelected] = useState<string>();
  const active = profiles.find((p) => p.entity.id === selected) ?? profiles[0];
  if (!active) return <Empty>Fandom deep-dives (demographics, trend, heatmap) will appear here.</Empty>;
  return (
    <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <div className="scroll-thin flex gap-2 overflow-x-auto xl:flex-col xl:overflow-visible">
        {profiles.map((p) => (
          <button
            key={p.entity.id}
            onClick={() => setSelected(p.entity.id)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg border p-2 text-left",
              p.entity.id === active.entity.id ? "border-amber/50 bg-amber/5" : "border-line hover:border-line-strong",
            )}
          >
            <EntityAvatar entity={p.entity} size={32} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-text">{p.entity.name}</span>
              <span className="font-mono text-[10px] text-faint">
                venue {p.heat?.nearVenueIndex.toFixed(2) ?? "—"} · {p.trend?.direction ?? "—"}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-bold uppercase">{active.entity.name}</span>
              <KindBadge kind={active.entity.kind} />
            </div>
            <Badge tone="amber" title="Share of heatmap affinity inside the venue catchment vs the metro (0.5 = average)">
              near-venue index {active.heat?.nearVenueIndex.toFixed(2) ?? "—"}
            </Badge>
          </div>
          <HeatMap
            key={active.entity.id}
            points={active.heat?.points ?? []}
            venue={venue}
            catchmentKm={active.heat?.catchmentKm}
            className="h-64 w-full overflow-hidden rounded-lg border border-line"
          />
          <p className="mt-1 font-mono text-[10px] text-faint">
            Qloo urn:heatmap · {active.heat?.points.length ?? 0} cells · dashed ring = {active.heat?.catchmentKm ?? 16} km venue catchment
          </p>
        </div>
        <div className="rounded-lg border border-line bg-bg p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Users size={13} /> Age & gender affinity (vs average)
          </div>
          <DemographicsBars demographics={active.demographics} />
        </div>
        <div className="space-y-3 rounded-lg border border-line bg-bg p-3">
          <div>
            <div className="mb-1 text-xs font-semibold text-muted">16-week trend</div>
            <TrendSpark trend={active.trend} />
          </div>
          {active.tasteTags?.length ? (
            <div>
              <div className="mb-1 text-xs font-semibold text-muted">Taste tags of this audience</div>
              <div className="flex flex-wrap gap-1">
                {active.tasteTags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            </div>
          ) : null}
          <div className="font-mono text-[10px] text-faint">evidence: {active.evidence.join(", ")}</div>
        </div>
      </div>
    </div>
  );
}

function FitMatrix({ rows }: { rows: RunState["fit"] }) {
  if (!rows.length) return <Empty>Audience-fit scores will appear here.</Empty>;
  const segments = (Object.keys(SEGMENTS) as SegmentId[]).filter((s) => rows.some((r) => r.fit[s] !== undefined));
  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        Qloo affinity when the shortlist is scored with each segment&apos;s demographic or life-stage signal plus the city&apos;s location signal.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr className="text-left text-muted">
              <th className="pb-2 font-medium">Fandom</th>
              {segments.map((s) => (
                <th key={s} className="pb-2 text-center font-medium">
                  {SEGMENTS[s].emoji} {SEGMENTS[s].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entity, fit }) => (
              <tr key={entity.id} className="border-t border-line">
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-2">
                    <EntityAvatar entity={entity} size={24} />
                    <span className="truncate text-text">{entity.name}</span>
                  </div>
                </td>
                {segments.map((s) => {
                  const v = fit[s];
                  return (
                    <td key={s} className="px-1 py-1.5 text-center">
                      <span
                        className="inline-block w-14 rounded-md py-1 font-mono"
                        style={{
                          background: v === undefined ? "transparent" : `color-mix(in oklab, var(--turf) ${Math.round(v * 70)}%, var(--surface-2))`,
                          color: v !== undefined && v > 0.6 ? "#04140d" : "var(--muted)",
                        }}
                      >
                        {v?.toFixed(2) ?? "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KitBoard({ state }: { state: RunState }) {
  const anchors = [...new Set([...state.sponsors.map((s) => s.anchor), ...state.experiences.map((e) => e.anchor)])];
  if (!anchors.length) return <Empty>Sponsor prospects, playlists and local partners will appear here.</Empty>;
  return (
    <div className="space-y-4">
      {anchors.map((anchor) => {
        const s = state.sponsors.find((x) => x.anchor === anchor);
        const e = state.experiences.find((x) => x.anchor === anchor);
        return (
          <div key={anchor} className="rounded-lg border border-line bg-bg p-3">
            <div className="mb-2 font-display text-base font-bold uppercase tracking-wide">{anchor}</div>
            <div className="grid gap-3 md:grid-cols-3">
              <KitColumn title="Sponsor prospects" items={s?.brands ?? []} />
              <KitColumn title="Playlist" items={e?.artists ?? []} />
              <KitColumn title="Partners near the venue" items={e?.places ?? []} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KitColumn({ title, items }: { title: string; items: { id: string; name: string; kind: EntityProfile["entity"]["kind"]; affinity?: number; image?: string; industries?: string[] }[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</div>
      <ul className="space-y-1.5">
        {items.slice(0, 5).map((i) => (
          <li key={i.id} className="flex items-center gap-2">
            <EntityAvatar entity={i} size={22} />
            <span className="min-w-0 flex-1 truncate text-xs text-text">{i.name}</span>
            <span className="font-mono text-[10px] text-faint">{i.affinity?.toFixed(2) ?? ""}</span>
          </li>
        ))}
        {!items.length && <li className="text-xs text-faint">—</li>}
      </ul>
    </div>
  );
}
