"use client";

import { CalendarDays, Crosshair, Loader2, MapPin, Play, Sparkles, Wand2 } from "lucide-react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { PRESETS, teamFromPreset } from "@/lib/presets";
import { formatDate, generateSchedule, SEGMENTS, SPORTS, withTargets } from "@/lib/schedule";
import type { GameDate, SegmentId, Sport, TeamConfig } from "@/lib/types";
import { Badge, Button, Card, cn } from "../ui";

const CATEGORY_OPTIONS = [
  "Beverages",
  "Beer",
  "Restaurants",
  "Quick Service Restaurants",
  "Automotive",
  "Telecommunications",
  "Insurance",
  "Apparel",
  "Outdoor Gear",
  "Toys",
  "Retail",
];

const inputCls =
  "h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-text outline-none placeholder:text-faint focus:border-amber/60";

export function TeamSetup({
  team,
  onChange,
  onRun,
  running,
}: {
  team: TeamConfig;
  onChange: Dispatch<SetStateAction<TeamConfig>>;
  onRun: () => void;
  running: boolean;
}) {
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string>();
  const targets = team.dates.filter((d) => d.target);
  const set = (patch: Partial<TeamConfig>) => onChange({ ...team, ...patch });

  const months = useMemo(() => {
    const groups = new Map<string, GameDate[]>();
    for (const d of team.dates) {
      const key = d.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    return [...groups.entries()];
  }, [team.dates]);

  const toggleDate = (date: string) =>
    set({ dates: team.dates.map((d) => (d.date === date ? { ...d, target: !d.target } : d)) });
  const setSegment = (date: string, segment: SegmentId) =>
    set({ dates: team.dates.map((d) => (d.date === date ? { ...d, segment } : d)) });

  async function locate() {
    setLocating(true);
    setLocateError(undefined);
    const { name, city } = team.venue;
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(name ? `${name}, ${city}` : city)}`);
      const body = await res.json();
      const hit = body.results?.[0] ?? (await (await fetch(`/api/geocode?q=${encodeURIComponent(city)}`)).json()).results?.[0];
      if (!hit) throw new Error("No match — try a more specific city.");
      const lat = Number(hit.lat.toFixed(5));
      const lon = Number(hit.lon.toFixed(5));
      // Apply to the latest team so edits made during the lookup survive; skip it if the venue text it
      // answers for has since changed.
      onChange((current) =>
        current.venue.name === name && current.venue.city === city ? { ...current, venue: { ...current.venue, lat, lon } } : current,
      );
    } catch (error) {
      setLocateError((error as Error).message);
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      {/* Team */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide">
          <Sparkles size={18} className="text-amber" /> Your club
        </div>

        <div className="mb-5">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">Start from a demo market</div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.slug}
                onClick={() => onChange(teamFromPreset(p, targets.length || 6))}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-left text-xs transition-colors",
                  team.teamName === p.teamName ? "border-amber/60 bg-amber/10 text-amber" : "border-line bg-bg text-muted hover:border-line-strong hover:text-text",
                )}
              >
                <span className="mr-1">{SPORTS[p.sport].icon}</span>
                {p.venue.city.split(",")[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs text-muted">Team name</span>
            <input className={inputCls} value={team.teamName} onChange={(e) => set({ teamName: e.target.value })} />
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">Sport</span>
            <select
              className={inputCls}
              value={team.sport}
              onChange={(e) => {
                const sport = e.target.value as Sport;
                set({ sport, league: SPORTS[sport].league, dates: withTargets(generateSchedule(sport), targets.length || 6) });
              }}
            >
              {Object.entries(SPORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.icon} {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">League / level</span>
            <input className={inputCls} value={team.league} onChange={(e) => set({ league: e.target.value })} />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs text-muted">Market (city Qloo should read)</span>
            <input
              className={inputCls}
              value={team.venue.city}
              placeholder="e.g. Durham, North Carolina"
              onChange={(e) => set({ venue: { ...team.venue, city: e.target.value } })}
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs text-muted">Venue</span>
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={team.venue.name}
                onChange={(e) => set({ venue: { ...team.venue, name: e.target.value } })}
              />
              <Button variant="outline" onClick={locate} disabled={locating} title="Look up coordinates (OpenStreetMap)">
                {locating ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />}
                Locate
              </Button>
            </div>
            <span className="mt-1 flex items-center gap-1 font-mono text-[11px] text-faint">
              <MapPin size={11} /> {team.venue.lat.toFixed(4)}, {team.venue.lon.toFixed(4)}
              {locateError && <span className="ml-2 text-rose">{locateError}</span>}
            </span>
          </label>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs text-muted">Sponsor categories your sales team needs to fill</div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_OPTIONS.map((c) => {
              const on = team.sponsorCategories.includes(c);
              return (
                <button
                  key={c}
                  onClick={() =>
                    set({
                      sponsorCategories: on ? team.sponsorCategories.filter((x) => x !== c) : [...team.sponsorCategories, c].slice(0, 6),
                    })
                  }
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs",
                    on ? "border-turf/50 bg-turf/10 text-turf" : "border-line text-muted hover:text-text",
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs text-muted">Licensed IP</div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["ip_light", "Keep it license-free", "Evoke fandoms without studio logos"],
                ["licensed_ok", "Licensed IP is OK", "We'll flag what needs a license"],
              ] as const
            ).map(([value, label, help]) => (
              <button
                key={value}
                onClick={() => set({ ipPolicy: value })}
                className={cn(
                  "rounded-lg border p-2.5 text-left",
                  team.ipPolicy === value ? "border-amber/60 bg-amber/10" : "border-line hover:border-line-strong",
                )}
              >
                <div className={cn("text-sm font-semibold", team.ipPolicy === value ? "text-amber" : "text-text")}>{label}</div>
                <div className="text-[11px] text-muted">{help}</div>
              </button>
            ))}
          </div>
        </div>

        <label className="mt-5 block">
          <span className="mb-1 block text-xs text-muted">Notes for the GM (optional)</span>
          <textarea
            className={cn(inputCls, "h-20 resize-none py-2")}
            maxLength={600}
            placeholder="e.g. We already run Bark in the Park and Fireworks Fridays. Our concourse has a stage."
            value={team.notes ?? ""}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </label>
      </Card>

      {/* Schedule */}
      <Card className="flex flex-col p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide">
            <CalendarDays size={18} className="text-amber" /> Home schedule
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Auto-pick weakest</span>
            {[4, 6, 8].map((n) => (
              <button
                key={n}
                onClick={() => set({ dates: withTargets(team.dates.map((d) => ({ ...d, target: false })), n) })}
                className={cn(
                  "h-7 w-7 rounded-md border text-xs font-semibold",
                  targets.length === n ? "border-amber/60 bg-amber/10 text-amber" : "border-line text-muted hover:text-text",
                )}
              >
                {n}
              </button>
            ))}
            <Wand2 size={14} className="text-faint" />
          </div>
        </div>
        <p className="mb-4 text-xs text-muted">
          {team.dates.length} home dates generated for the next season. Highlighted dates are the weak ones the GM will program — click any date to
          add or remove it.
        </p>

        <div className="scroll-thin grid max-h-[300px] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {months.map(([month, days]) => (
            <div key={month}>
              <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-faint">
                {formatDate(`${month}-15`, { month: "long", year: "numeric" })}
              </div>
              <div className="flex flex-wrap gap-1">
                {days.map((d) => (
                  <button
                    key={d.date}
                    onClick={() => toggleDate(d.date)}
                    title={`${d.weekday} ${formatDate(d.date)} · ${d.time} vs ${d.opponent ?? "TBD"}`}
                    className={cn(
                      "flex h-10 w-9 flex-col items-center justify-center rounded-md border text-[11px] leading-tight transition-colors",
                      d.target
                        ? "border-amber bg-amber text-amber-ink"
                        : ["Fri", "Sat"].includes(d.weekday)
                          ? "border-line bg-surface-2 text-faint"
                          : "border-line text-muted hover:border-line-strong hover:text-text",
                    )}
                  >
                    <span className="font-semibold">{Number(d.date.slice(8))}</span>
                    <span className="text-[9px] uppercase opacity-80">{d.weekday.slice(0, 2)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-muted">
              Theme nights to plan: <span className="font-semibold text-text">{targets.length}</span>
              {targets.length > 8 && <span className="ml-2 text-rose">max 8 per run</span>}
            </span>
            <span className="text-[11px] text-faint">Target audience per date →</span>
          </div>
          <div className="scroll-thin max-h-[190px] space-y-1.5 overflow-y-auto pr-1">
            {targets.map((d) => (
              <div key={d.date} className="flex items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5">
                <span className="w-28 font-mono text-xs text-text">
                  {d.weekday} {formatDate(d.date)}
                </span>
                <Badge tone={d.time === "day" ? "sky" : "violet"}>{d.time}</Badge>
                <span className="hidden flex-1 truncate text-xs text-faint sm:block">vs {d.opponent}</span>
                <select
                  value={d.segment}
                  onChange={(e) => setSegment(d.date, e.target.value as SegmentId)}
                  className="ml-auto h-7 rounded-md border border-line bg-surface px-2 text-xs text-text outline-none"
                >
                  {(Object.keys(SEGMENTS) as SegmentId[]).map((s) => (
                    <option key={s} value={s}>
                      {SEGMENTS[s].emoji} {SEGMENTS[s].label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {!targets.length && <p className="py-4 text-center text-xs text-faint">Pick at least one date above.</p>}
          </div>
        </div>

        <Button size="lg" className="mt-5 w-full" onClick={onRun} disabled={running || !targets.length || targets.length > 8 || !team.venue.city}>
          {running ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
          Hire the GM — plan {targets.length} theme night{targets.length === 1 ? "" : "s"}
        </Button>
      </Card>
    </div>
  );
}
