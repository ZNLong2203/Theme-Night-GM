"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Gift,
  Link2,
  Megaphone,
  MapPin,
  Mic,
  Music2,
  Printer,
  ShieldCheck,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatDate, SEGMENTS } from "@/lib/schedule";
import type { Night, SeasonPlan } from "@/lib/types";
import { HeatMap } from "../heat-map";
import { Badge, Button, Card, cn, EntityAvatar, KindBadge, ScoreRing } from "../ui";
import { DemographicsBars, ScoreBars, TrendSpark } from "../viz";
import { AskTheGm } from "./ask-gm";
import { BaselineCompare } from "./baseline-compare";
import { Receipts } from "./receipts";

export function SeasonBoard({ plan, onPlanChange }: { plan: SeasonPlan; onPlanChange?: (plan: SeasonPlan) => void }) {
  const [open, setOpen] = useState<Night | null>(null);
  const avg = Math.round(plan.nights.reduce((s, n) => s + n.score.total, 0) / plan.nights.length);
  const sponsors = new Set(plan.nights.flatMap((n) => n.sponsors.map((s) => s.brand.id)));
  const live = plan.requests.filter((r) => !r.cached).length;
  const revised = new Set(plan.revisions?.at(-1)?.changedDates ?? []);

  return (
    <div>
      <Card className="floodlights overflow-hidden p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">Season plan · {plan.team.league}</div>
            <h2 className="font-display text-3xl font-bold uppercase tracking-wide md:text-4xl">{plan.team.teamName}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{plan.marketSummary}</p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <ShareButton plan={plan} />
            <Button variant="outline" size="sm" onClick={() => downloadJson(plan)}>
              <Download size={14} /> JSON
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(plan)}>
              <Download size={14} /> Calendar CSV
            </Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Theme nights" value={plan.nights.length} />
          <Kpi label="Avg Taste Fit" value={avg} suffix="/100" />
          <Kpi label="Sponsor prospects" value={sponsors.size} />
          <Kpi label="Qloo requests as evidence" value={plan.requests.length} hint={`${live} live · ${plan.requests.length - live} cached`} />
        </div>
      </Card>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plan.nights.map((night) => (
          <NightCard key={night.date} night={night} revised={revised.has(night.date)} onOpen={() => setOpen(night)} />
        ))}
      </div>

      {onPlanChange && <AskTheGm plan={plan} onPlanChange={onPlanChange} />}

      <BaselineCompare key={plan.id} plan={plan} onPlanChange={onPlanChange} />

      {open && <NightDetail night={open} plan={plan} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ShareButton({ plan }: { plan: SeasonPlan }) {
  const [copied, setCopied] = useState(false);
  const temporary = plan.mode.store !== "redis";
  return (
    <Button
      size="sm"
      title={temporary ? "No Redis attached: the link lasts only while this server instance is warm" : "Anyone with the link can view this plan"}
      onClick={() => {
        navigator.clipboard.writeText(`${window.location.origin}/plan/${plan.id}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? "Link copied" : temporary ? "Share (temporary)" : "Share link"}
    </Button>
  );
}

function Kpi({ label, value, suffix, hint }: { label: string; value: number; suffix?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg/70 p-3">
      <div className="font-display text-3xl font-bold text-text">
        {value}
        {suffix && <span className="text-base text-faint">{suffix}</span>}
      </div>
      <div className="text-xs text-muted">{label}</div>
      {hint && <div className="font-mono text-[10px] text-faint">{hint}</div>}
    </div>
  );
}

const RISK_TONE = { low: "turf", medium: "amber", high: "rose" } as const;

function NightCard({ night, revised, onOpen }: { night: Night; revised?: boolean; onOpen: () => void }) {
  const seg = SEGMENTS[night.segment];
  return (
    <button onClick={onOpen} className="group text-left">
      <Card className={cn("flex h-full flex-col p-4 transition-colors group-hover:border-amber/50", revised && "border-turf/50")}>
        <div className="flex items-start gap-3">
          <div className="w-14 shrink-0 rounded-lg border border-line bg-bg py-1.5 text-center">
            <div className="text-[10px] font-semibold uppercase text-amber">{night.weekday}</div>
            <div className="font-display text-2xl font-bold leading-none">{Number(night.date.slice(8))}</div>
            <div className="text-[10px] uppercase text-muted">{formatDate(night.date, { month: "short" })}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap gap-1">
              <Badge tone="sky">
                {seg.emoji} {seg.label}
              </Badge>
              <Badge tone={night.time === "day" ? "amber" : "violet"}>{night.time}</Badge>
              {revised && <Badge tone="turf">revised</Badge>}
            </div>
            <h3 className="font-display text-xl font-bold uppercase leading-tight tracking-wide text-text">{night.title}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted">{night.tagline}</p>
          </div>
          <ScoreRing value={night.score.total} />
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-bg p-2">
          <EntityAvatar entity={night.anchor} size={34} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{night.anchor.name}</div>
            <KindBadge kind={night.anchor.kind} />
          </div>
        </div>
        <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-muted">{night.why}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          {night.sponsors.slice(0, 3).map((s) => (
            <Badge key={s.brand.id} tone="turf">
              {s.brand.name}
            </Badge>
          ))}
          <Badge tone={RISK_TONE[night.licensing.risk]} className="ml-auto" title={night.licensing.note}>
            IP {night.licensing.risk}
          </Badge>
        </div>
      </Card>
    </button>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="no-print inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-text"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check size={11} /> : <Copy size={11} />} {done ? "Copied" : label}
    </button>
  );
}

function Panel({ title, icon: Icon, children, className }: { title: string; icon: typeof Gift; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-line bg-bg p-4", className)}>
      <h4 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-muted">
        <Icon size={14} className="text-amber" /> {title}
      </h4>
      {children}
    </section>
  );
}

export function NightDetail({ night, plan, onClose }: { night: Night; plan: SeasonPlan; onClose: () => void }) {
  const profile = plan.profiles.find((p) => p.entity.id === night.anchor.id);
  const seg = SEGMENTS[night.segment];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // While the one-pager is open, printing (button or Ctrl+P) shows only it: see .one-pager in globals.css.
    document.body.classList.add("one-pager-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      document.body.classList.remove("one-pager-open");
    };
  }, [onClose]);

  const pitch = (s: Night["sponsors"][number]) =>
    `${night.title} (${formatDate(night.date, { weekday: "long", month: "long", day: "numeric" })}) at ${plan.team.teamName}: ${s.angle} Presenting rights include the ${night.giveaway.toLowerCase()} and in-game activations.`;

  // Portaled to <body> so the print rules can hide the rest of the page and keep only this sheet.
  return createPortal(
    <div
      className="one-pager fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm print:static print:block print:bg-transparent print:backdrop-blur-none"
      onClick={onClose}
    >
      <div
        className="scroll-thin h-full w-full max-w-5xl overflow-y-auto border-l border-line bg-surface print:h-auto print:max-w-none print:overflow-visible print:border-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-5 py-3 backdrop-blur print:hidden">
          <span className="font-mono text-xs text-muted">
            {night.weekday} {formatDate(night.date, { month: "long", day: "numeric", year: "numeric" })} · {night.time} game
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer size={14} /> Sponsor one-pager
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X size={16} />
            </Button>
          </div>
        </div>

        <div className="p-5 md:p-7">
          <div className="flex flex-wrap items-start gap-5">
            <ScoreRing value={night.score.total} size={84} stroke={7} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap gap-1.5">
                <Badge tone="sky">
                  {seg.emoji} {seg.label} · {seg.short}
                </Badge>
                <Badge tone={RISK_TONE[night.licensing.risk]}>IP risk: {night.licensing.risk}</Badge>
              </div>
              <h2 className="font-display text-4xl font-bold uppercase leading-none tracking-wide">{night.title}</h2>
              <p className="mt-1 text-muted">{night.tagline}</p>
              <div className="mt-3 flex items-center gap-2">
                <EntityAvatar entity={night.anchor} size={36} />
                <div>
                  <div className="text-sm font-semibold">Anchor fandom: {night.anchor.name}</div>
                  <KindBadge kind={night.anchor.kind} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <Panel title="Why this night works" icon={Sparkles}>
                <p className="text-sm leading-relaxed text-text">{night.why}</p>
                <div className="mt-4">
                  <ScoreBars score={night.score} />
                </div>
              </Panel>
              <Panel title={`Where ${night.anchor.name} fans are`} icon={MapPin}>
                <HeatMap
                  points={profile?.heat?.points ?? []}
                  venue={plan.team.venue}
                  catchmentKm={profile?.heat?.catchmentKm}
                  places={night.localPartners.map((l) => l.place)}
                  className="h-60 w-full overflow-hidden rounded-lg border border-line"
                />
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-muted">Age & gender affinity</div>
                    <DemographicsBars demographics={profile?.demographics} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-muted">Momentum (Qloo trending)</div>
                    <TrendSpark trend={profile?.trend} />
                  </div>
                </div>
              </Panel>
              <Panel title="Promo copy" icon={Megaphone}>
                <div className="space-y-3 text-sm">
                  {(
                    [
                      ["Headline", night.promo.headline],
                      ["Social post", night.promo.social],
                      ["Email subject", night.promo.emailSubject],
                    ] as const
                  ).map(([label, text]) => (
                    <div key={label}>
                      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-faint">
                        {label} <CopyButton text={text} />
                      </div>
                      <p className="rounded-lg border border-line bg-surface p-2.5 text-text">{text}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <div className="space-y-4">
              <Panel title="Sponsor prospects" icon={Store}>
                <ul className="space-y-3">
                  {night.sponsors.map((s) => (
                    <li key={s.brand.id} className="rounded-lg border border-line bg-surface p-3">
                      <div className="flex items-center gap-2">
                        <EntityAvatar entity={s.brand} size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                            {s.brand.name}
                            {s.brand.category && <Badge tone="turf">{s.brand.category}</Badge>}
                          </div>
                          <div className="truncate text-[11px] text-faint">{s.brand.industries?.join(" · ")}</div>
                        </div>
                        <CopyButton text={pitch(s)} label="Pitch" />
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted">{s.angle}</p>
                    </li>
                  ))}
                  {!night.sponsors.length && <li className="text-xs text-faint">No sponsor matched the requested categories.</li>}
                </ul>
              </Panel>
              <Panel title="The night" icon={Gift}>
                <div className="text-sm">
                  <div className="text-[11px] uppercase tracking-wide text-faint">Giveaway</div>
                  <p className="mb-3 text-text">{night.giveaway}</p>
                  <div className="text-[11px] uppercase tracking-wide text-faint">Activations</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-muted">
                    {night.activations.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              </Panel>
              {night.playlist.length > 0 && (
                <Panel title="In-game playlist" icon={Music2}>
                  <div className="flex flex-wrap gap-1.5">
                    {night.playlist.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pl-0.5 pr-2.5 text-xs">
                        <EntityAvatar entity={a} size={20} className="rounded-full" /> {a.name}
                      </span>
                    ))}
                  </div>
                </Panel>
              )}
              {(night.localPartners.length > 0 || night.mediaPartner) && (
                <Panel title="Partners" icon={Mic}>
                  <ul className="space-y-2.5 text-sm">
                    {night.localPartners.map((l) => (
                      <li key={l.place.id}>
                        <div className="font-semibold">{l.place.name}</div>
                        {l.place.address && <div className="text-[11px] text-faint">{l.place.address}</div>}
                        <div className="text-xs text-muted">{l.idea}</div>
                      </li>
                    ))}
                    {night.mediaPartner && (
                      <li>
                        <div className="font-semibold">🎙 {night.mediaPartner.podcast.name}</div>
                        <div className="text-xs text-muted">{night.mediaPartner.idea}</div>
                      </li>
                    )}
                  </ul>
                </Panel>
              )}
              <Panel title="Licensing check" icon={night.licensing.risk === "low" ? ShieldCheck : AlertTriangle}>
                <p className="text-xs leading-relaxed text-muted">{night.licensing.note}</p>
                <p className="mt-2 text-[10px] text-faint">Rules-based flag from Qloo metadata (studio/publisher), not legal advice.</p>
              </Panel>
            </div>
          </div>

          <Panel title={`Evidence · ${night.evidence.length} Qloo requests behind this night`} icon={Sparkles} className="mt-4 print:hidden">
            <Receipts requests={plan.requests} highlight={night.evidence} />
          </Panel>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function save(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function downloadJson(plan: SeasonPlan) {
  save(`${slug(plan.team.teamName)}-theme-nights.json`, "application/json", JSON.stringify(plan, null, 2));
}

function downloadCsv(plan: SeasonPlan) {
  // Spreadsheets run cells that start with = + - @ (or tab/CR) as formulas, even when quoted. Titles come from
  // the LLM and anchor names from Qloo (the idol group "=LOVE"), so prefix a ' to keep them plain text.
  const esc = (v: string | number) => {
    const text = typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = [
    ["Date", "Weekday", "Time", "Segment", "Title", "Anchor fandom", "Taste Fit", "Sponsor prospects", "Giveaway", "IP risk"],
    ...plan.nights.map((n) => [
      n.date,
      n.weekday,
      n.time,
      SEGMENTS[n.segment].label,
      n.title,
      n.anchor.name,
      n.score.total,
      n.sponsors.map((s) => s.brand.name).join("; "),
      n.giveaway,
      n.licensing.risk,
    ]),
  ];
  save(`${slug(plan.team.teamName)}-theme-nights.csv`, "text/csv", rows.map((r) => r.map(esc).join(",")).join("\n"));
}
