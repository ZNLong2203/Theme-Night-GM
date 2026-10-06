"use client";

import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, ChevronDown, Dna, Equal, Loader2, MapPin, Receipt, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { Receipts } from "@/components/studio/receipts";
import { Badge, Button, Card, cn, EntityAvatar, KIND_META, KindBadge } from "@/components/ui";
import { DNA_DEPTH, DNA_KINDS, type DomainOverlap, type MarketDnaResult, type MarketSide, type SharedEntity } from "@/lib/market-dna";
import { PRESETS } from "@/lib/presets";
import type { EntityCard, EntityKind } from "@/lib/types";

type Side = "a" | "b";

const CITIES = [...new Set(PRESETS.map((p) => p.venue.city))];
const DEFAULT_A = PRESETS.find((p) => p.slug === "durham-baseball")?.venue.city ?? CITIES[0];
const DEFAULT_B = PRESETS.find((p) => p.slug === "la-baseball")?.venue.city ?? CITIES[1];

// Market A is always amber and market B always sky, from the picker down to every column.
const TONE = {
  a: { text: "text-amber", dot: "bg-amber", accent: "border-t-amber/70", chip: "border-amber/50 bg-amber/10 text-amber", focus: "focus:border-amber/60", badge: "amber", color: "var(--amber)" },
  b: { text: "text-sky", dot: "bg-sky", accent: "border-t-sky/70", chip: "border-sky/50 bg-sky/10 text-sky", focus: "focus:border-sky/60", badge: "sky", color: "var(--sky)" },
} as const;

const NOUN: Partial<Record<EntityKind, string>> = {
  movie: "movies",
  tv_show: "TV shows",
  artist: "artists",
  videogame: "video games",
  book: "books",
};
const noun = (kind: EntityKind) => NOUN[kind] ?? KIND_META[kind].plural.toLowerCase();
/** "Durham, North Carolina" → "Durham". */
const shortName = (city: string) => city.split(",")[0]?.trim() || city;
const depthOf = (d: DomainOverlap) => Math.max(d.poolA, d.poolB);

function errorText(body: unknown, status: number) {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  if (Array.isArray(error)) return error.join(" ");
  return `Comparison failed (HTTP ${status}).`;
}

async function requestDna(qs: string, signal: AbortSignal): Promise<MarketDnaResult> {
  const response = await fetch(`/api/market-dna?${qs}`, { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorText(body, response.status));
  return body as MarketDnaResult;
}

const queryFor = (a: string, b: string) => new URLSearchParams({ a: a.trim(), b: b.trim() }).toString();

export function MarketDna() {
  const params = useSearchParams();
  const router = useRouter();
  const [a, setA] = useState(() => params.get("a") || DEFAULT_A);
  const [b, setB] = useState(() => params.get("b") || DEFAULT_B);
  // A shared link (?a=&b=) starts loading straight away; a bare visit waits for a click.
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(() =>
    params.get("a") && params.get("b") ? "loading" : "idle",
  );
  const [result, setResult] = useState<MarketDnaResult>();
  const [error, setError] = useState<string>();
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const inflight = useRef<AbortController | null>(null);
  const booted = useRef(false);

  /** Fetch one comparison; a newer compare aborts the older one so results never arrive out of order. */
  const load = useCallback(
    (qs: string) => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      requestDna(qs, controller.signal).then(
        (body) => {
          setResult(body);
          setStatus("done");
          // Shareable: the URL now reproduces exactly this comparison.
          router.replace(`/market-dna?${qs}`, { scroll: false });
        },
        (err: Error) => {
          if (controller.signal.aborted) return;
          setStatus("error");
          setError(err.message);
        },
      );
    },
    [router],
  );

  const compare = (left: string, right: string) => {
    const x = left.trim();
    const y = right.trim();
    if (x.length < 2 || y.length < 2 || x.toLowerCase() === y.toLowerCase()) {
      setStatus("error");
      setError(x.length < 2 || y.length < 2 ? "Enter two markets (at least 2 characters each)." : "Pick two different markets.");
      return;
    }
    setStatus("loading");
    setError(undefined);
    setStartedAt(Date.now());
    setNow(Date.now());
    load(queryFor(x, y));
  };

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const qa = params.get("a");
    const qb = params.get("b");
    if (qa && qb) load(queryFor(qa, qb));
  }, [params, load]);

  useEffect(() => {
    if (status !== "loading") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [status]);

  const loading = status === "loading";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <div className="mb-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber">Market DNA</div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide md:text-4xl">What one market loves that another doesn&apos;t</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Qloo ranks every city&apos;s taste on its own. Put two markets side by side and the gap shows up right away: the movies, shows,
            artists, games and books one city over-indexes on that barely register in the other. A theme night should be built on that local
            edge.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            compare(a, b);
          }}
        >
          <Card className="p-4 md:p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start">
              <MarketPicker side="a" value={a} other={b} onChange={setA} />
              <button
                type="button"
                onClick={() => {
                  setA(b);
                  setB(a);
                }}
                className="mx-auto grid h-9 w-9 place-items-center rounded-full border border-line-strong bg-bg text-muted hover:border-amber/60 hover:text-amber md:mt-7"
                aria-label="Swap markets"
                title="Swap markets"
              >
                <ArrowLeftRight size={15} className="rotate-90 md:rotate-0" />
              </button>
              <MarketPicker side="b" value={b} other={a} onChange={setB} />
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
              <Button type="submit" size="lg" disabled={loading} className="w-full sm:w-auto">
                {loading ? <Loader2 size={18} className="animate-spin" /> : <Dna size={18} />}
                {loading ? "Comparing…" : "Compare markets"}
              </Button>
              <span className="text-xs text-faint">
                {DNA_KINDS.length * 2} Qloo insight queries: top {DNA_DEPTH} {DNA_KINDS.map(noun).join(", ")} for each market, popularity ≥ 0.8.
                Cached for 12 hours.
              </span>
            </div>
          </Card>
        </form>

        <div className="mt-6">
          {loading && <LoadingState a={a} b={b} seconds={Math.max(0, (now - startedAt) / 1000)} />}
          {!loading && status === "error" && error && <Card className="border-rose/40 bg-rose/5 p-4 text-sm text-rose">{error}</Card>}
          {!loading && result && <Results result={result} />}
          {!loading && !result && status !== "error" && <IdleState a={a} b={b} />}
        </div>
      </main>
    </>
  );
}

function MarketPicker({ side, value, other, onChange }: { side: Side; value: string; other: string; onChange: (city: string) => void }) {
  const tone = TONE[side];
  const id = `market-${side}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        <span className={cn("h-2 w-2 rounded-full", tone.dot)} /> Market {side.toUpperCase()}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={120}
        autoComplete="off"
        spellCheck={false}
        placeholder="Any city, e.g. Austin, Texas"
        className={cn(
          "h-11 w-full rounded-lg border border-line-strong bg-bg px-3 text-sm text-text outline-none placeholder:text-faint",
          tone.focus,
        )}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CITIES.map((city) => {
          const selected = city.toLowerCase() === value.trim().toLowerCase();
          const taken = city.toLowerCase() === other.trim().toLowerCase();
          return (
            <button
              key={city}
              type="button"
              disabled={taken}
              onClick={() => onChange(city)}
              title={taken ? "Already picked as the other market" : undefined}
              className={cn(
                "rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                selected ? tone.chip : "border-line text-muted hover:border-line-strong hover:text-text",
              )}
            >
              {city}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IdleState({ a, b }: { a: string; b: string }) {
  return (
    <Card className="floodlights relative overflow-hidden p-6 md:p-8">
      <div className="mx-auto max-w-2xl text-center">
        <Dna size={28} className="mx-auto text-amber" />
        <h2 className="mt-2 font-display text-2xl font-bold uppercase tracking-wide">Two markets, side by side</h2>
        <p className="mt-2 text-sm text-muted">
          <span className="text-amber">{shortName(a) || "Market A"}</span> vs <span className="text-sky">{shortName(b) || "Market B"}</span> is
          loaded. Hit <span className="text-text">Compare markets</span> or type any city. For each domain you&apos;ll see what only one market
          loves, what both share, and how much higher each pick ranks locally than nationally.
        </p>
      </div>
      <div className="mx-auto mt-6 grid max-w-3xl grid-cols-3 gap-2 text-center" aria-hidden>
        {[
          ["Only A loves", "border-t-amber/70"],
          ["Both love", "border-t-turf/70"],
          ["Only B loves", "border-t-sky/70"],
        ].map(([label, accent]) => (
          <div key={label} className={cn("rounded-lg border border-t-2 border-line bg-bg/70 p-3", accent)}>
            <div className="font-display text-xs font-bold uppercase tracking-wide text-muted sm:text-sm">{label}</div>
            <div className="mt-2 space-y-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-2 rounded-full bg-line" style={{ width: `${88 - i * 18}%`, marginInline: "auto" }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LoadingState({ a, b, seconds }: { a: string; b: string; seconds: number }) {
  return (
    <div aria-live="polite">
      <Card className="flex items-center gap-3 p-4">
        <Loader2 size={20} className="shrink-0 animate-spin text-amber" />
        <div className="min-w-0">
          <div className="font-display text-lg font-bold uppercase tracking-wide">Reading two markets…</div>
          <div className="text-xs text-muted">
            Asking Qloo for <span className="text-amber">{shortName(a)}</span> and <span className="text-sky">{shortName(b)}</span>&apos;s top{" "}
            {DNA_DEPTH} in {DNA_KINDS.length} domains · <span className="font-mono">{seconds.toFixed(1)}s</span>
          </div>
        </div>
      </Card>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {DNA_KINDS.map((kind) => (
          <div key={kind} className="h-28 animate-pulse rounded-lg border border-line bg-surface" />
        ))}
      </div>
      <div className="mt-4 h-72 animate-pulse rounded-xl border border-line bg-surface" />
    </div>
  );
}

// ---------- results ----------

interface Signature {
  entity: Pick<EntityCard, "name" | "kind" | "image">;
  detail: string;
  lift?: number;
}

/** The pick that best captures a market: its biggest-lift entity the other market doesn't rank at all. */
function signatureOf(overlap: DomainOverlap[], side: Side, self: string, other: string): Signature | null {
  const unique = overlap.flatMap((d) => (side === "a" ? d.onlyA : d.onlyB).map((entity) => ({ entity, depth: depthOf(d) })));
  const best = unique.sort(
    (x, y) => (y.entity.lift ?? 0) - (x.entity.lift ?? 0) || (x.entity.localRank ?? 99) - (y.entity.localRank ?? 99),
  )[0];
  if (best) {
    return {
      entity: best.entity,
      detail: `#${best.entity.localRank} in ${self} · not in ${other}'s top ${best.depth}`,
      lift: best.entity.lift,
    };
  }
  // No unique picks (very similar markets): fall back to the shared pick that leans hardest this way.
  const gap = (s: SharedEntity) => (side === "a" ? s.rankB - s.rankA : s.rankA - s.rankB);
  const lean = overlap.flatMap((d) => (side === "a" ? d.leansA : d.leansB)).sort((x, y) => gap(y) - gap(x))[0];
  if (!lean) return null;
  const [mine, theirs] = side === "a" ? [lean.rankA, lean.rankB] : [lean.rankB, lean.rankA];
  return { entity: lean, detail: `#${mine} in ${self} vs #${theirs} in ${other}` };
}

function headline(overlap: DomainOverlap[], nameA: string, nameB: string) {
  const sharpest = [...overlap].sort((x, y) => x.sharedCount / depthOf(x) - y.sharedCount / depthOf(y))[0];
  if (!sharpest) return null;
  const n = depthOf(sharpest);
  const s = sharpest.sharedCount;
  const what = noun(sharpest.kind);
  const pair = (
    <>
      <span className="text-amber">{nameA}</span> and <span className="text-sky">{nameB}</span>
    </>
  );
  if (s === 0) return <>{pair} share none of their top {n} {what}</>;
  if (s >= n) {
    // Identical lists in every domain: the story is the order, so lead with the biggest rank swing.
    const swing = overlap
      .flatMap((d) => [...d.leansA, ...d.leansB])
      .sort((x, y) => Math.abs(y.rankA - y.rankB) - Math.abs(x.rankA - x.rankB))[0];
    if (!swing) return <>{pair} agree on all {n} of their top {what}</>;
    return (
      <>
        {pair} love the same things in a different order: {swing.name} is #{swing.rankA} in {nameA}, #{swing.rankB} in {nameB}
      </>
    );
  }
  return (
    <>
      {pair} share {s / n < 0.5 ? "only " : ""}
      {s} of their top {n} {what}
    </>
  );
}

function Results({ result }: { result: MarketDnaResult }) {
  const { a, b, overlap } = result;
  const nameA = shortName(a.city);
  const nameB = shortName(b.city);
  const shared = overlap.reduce((n, d) => n + d.sharedCount, 0);
  const union = overlap.reduce((n, d) => n + d.poolA + d.poolB - d.sharedCount, 0);
  const overall = union ? Math.round((shared / union) * 100) : 0;
  const unique = overlap.reduce((n, d) => n + d.uniqueA + d.uniqueB, 0);
  const signatures = [signatureOf(overlap, "a", nameA, nameB), signatureOf(overlap, "b", nameB, nameA)] as const;
  const gaps = [
    ...(a.unavailable ?? []).map((u) => ({ ...u, city: nameA })),
    ...(b.unavailable ?? []).map((u) => ({ ...u, city: nameB })),
  ];

  return (
    <div className="space-y-6">
      {/* Matchup + headline */}
      <Card className="floodlights relative overflow-hidden p-4 md:p-6">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
          <MarketBanner side="a" market={a} simulated={result.simulated} />
          <div className="text-center font-display text-xl font-extrabold uppercase text-faint">vs</div>
          <MarketBanner side="b" market={b} simulated={result.simulated} />
        </div>
        <div className="mt-5 border-t border-line pt-5">
          <p className="font-display text-2xl font-bold uppercase leading-tight tracking-wide break-words md:text-4xl">
            {headline(overlap, nameA, nameB)}.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
            <span>
              <span className="font-mono text-base text-text">{overall}%</span> overall taste overlap
            </span>
            <span>
              <span className="font-mono text-base text-text">{unique}</span> picks only one market ranks
            </span>
            <span className="font-mono text-faint">
              {result.requests.length} Qloo requests · {(result.elapsedMs / 1000).toFixed(1)}s
            </span>
            {result.simulated && <Badge tone="violet">simulated data</Badge>}
          </div>
        </div>
      </Card>

      {/* Per-domain stat strip */}
      <section aria-label="Overlap by domain">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <LegendDot className="bg-amber" label={`Only ${nameA}`} />
          <LegendDot className="bg-turf" label="Both" />
          <LegendDot className="bg-sky" label={`Only ${nameB}`} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {overlap.map((d) => (
            <a
              key={d.kind}
              href={`#dna-${d.kind}`}
              className="group min-w-0 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-line-strong"
            >
              <div className="flex items-center justify-between gap-2">
                <KindBadge kind={d.kind} />
                <span className="font-mono text-[10px] text-faint" title="Jaccard overlap of the two top lists">
                  {Math.round(d.jaccard * 100)}%
                </span>
              </div>
              <div className="mt-2 font-display text-3xl font-bold leading-none">
                {d.sharedCount}
                <span className="text-lg text-faint">/{depthOf(d)}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted">shared {noun(d.kind)}</div>
              <OverlapBar d={d} nameA={nameA} nameB={nameB} className="mt-2.5" />
            </a>
          ))}
        </div>
        {gaps.length > 0 && (
          <p className="mt-2 text-xs text-faint">
            Qloo had no data for{" "}
            {gaps.map((g, i) => (
              <span key={`${g.city}-${g.kind}`} title={g.reason}>
                {i > 0 && ", "}
                {noun(g.kind)} in {g.city}
              </span>
            ))}
            , so {gaps.length === 1 ? "that domain is" : "those domains are"} left out.
          </p>
        )}
      </section>

      {/* Signature picks */}
      {(signatures[0] || signatures[1]) && (
        <div className="grid gap-3 md:grid-cols-2">
          {signatures.map((sig, i) => {
            const side: Side = i === 0 ? "a" : "b";
            if (!sig) return <div key={side} className="hidden md:block" />;
            return (
              <Card key={side} className={cn("flex items-center gap-3 border-t-2 p-4", TONE[side].accent)}>
                <EntityAvatar entity={sig.entity} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                    <Sparkles size={11} className={TONE[side].text} /> The most {side === "a" ? nameA : nameB} pick
                  </div>
                  <div className="truncate font-display text-xl font-bold uppercase tracking-wide">{sig.entity.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <KindBadge kind={sig.entity.kind} />
                    <span className="font-mono text-[11px] text-muted">{sig.detail}</span>
                  </div>
                </div>
                {sig.lift !== undefined && sig.lift > 0 && (
                  <div className="shrink-0 text-right" title="Places higher on local affinity than on national popularity">
                    <div className="flex items-center justify-end font-display text-2xl font-bold text-turf">
                      <ArrowUpRight size={18} />
                      {sig.lift}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-faint">lift</div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Domain by domain */}
      <section className="space-y-4">
        <p className="text-xs text-muted">
          Ranks are inside each market&apos;s own top {DNA_DEPTH}. <span className="text-turf">↑ lift</span> = how many places higher a pick ranks on
          local affinity than on national popularity within the same Qloo result. We compare ranks, not raw affinity, because Qloo normalizes
          affinity per query.
        </p>
        {overlap.map((d) => (
          <DomainCompare key={d.kind} d={d} nameA={nameA} nameB={nameB} evidence={[evidenceFor(a, d.kind), evidenceFor(b, d.kind)]} />
        ))}
      </section>

      {/* Receipts */}
      <details className="group rounded-xl border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
          <Receipt size={16} className="shrink-0 text-amber" />
          <span className="font-display text-lg font-bold uppercase tracking-wide">Receipts</span>
          <span className="hidden text-xs text-muted sm:inline">every Qloo request behind this comparison</span>
          <span className="ml-auto font-mono text-xs text-faint">{result.requests.length}</span>
          <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-line p-4">
          <Receipts requests={result.requests} />
        </div>
      </details>
    </div>
  );
}

const evidenceFor = (market: MarketSide, kind: EntityKind) => market.domains.find((d) => d.kind === kind)?.evidence;

function MarketBanner({ side, market, simulated }: { side: Side; market: MarketSide; simulated: boolean }) {
  const tone = TONE[side];
  return (
    <div className={cn("min-w-0", side === "b" && "md:text-right")}>
      <div className={cn("flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted", side === "b" && "md:justify-end")}>
        <span className={cn("h-2 w-2 rounded-full", tone.dot)} /> Market {side.toUpperCase()}
      </div>
      <div className={cn("font-display text-3xl font-extrabold uppercase leading-none tracking-wide break-words md:text-4xl", tone.text)}>
        {shortName(market.city)}
      </div>
      <div className={cn("mt-1.5 flex items-start gap-1.5 text-xs text-muted", side === "b" && "md:justify-end")}>
        <MapPin size={13} className="mt-px shrink-0" />
        <span className="min-w-0 break-words">
          {market.resolvedAs ? (
            <>
              Qloo resolved <span className="text-text">{market.city}</span> as <span className="text-text">{market.resolvedAs}</span>
            </>
          ) : simulated ? (
            <>
              <span className="text-text">{market.city}</span> · simulated data has no locality resolution
            </>
          ) : (
            <>
              <span className="text-text">{market.city}</span> · Qloo didn&apos;t report how it resolved this name
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-sm", className)} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Three-part bar: unique to A | shared | unique to B, sized by count. */
function OverlapBar({ d, nameA, nameB, className }: { d: DomainOverlap; nameA: string; nameB: string; className?: string }) {
  const parts = [
    { n: d.uniqueA, color: "var(--amber)", label: `${d.uniqueA} ${noun(d.kind)} only in ${nameA}'s top ${d.poolA}` },
    { n: d.sharedCount, color: "var(--turf)", label: `${d.sharedCount} in both markets' top lists` },
    { n: d.uniqueB, color: "var(--sky)", label: `${d.uniqueB} ${noun(d.kind)} only in ${nameB}'s top ${d.poolB}` },
  ];
  return (
    <div className={className}>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => p.label).join("; ")}>
        {parts.map((p) =>
          p.n > 0 ? <div key={p.color} title={p.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flexGrow: p.n, flexBasis: 0, background: p.color }} /> : null,
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
        <span>{d.uniqueA}</span>
        <span>{d.sharedCount}</span>
        <span>{d.uniqueB}</span>
      </div>
    </div>
  );
}

function DomainCompare({ d, nameA, nameB, evidence }: { d: DomainOverlap; nameA: string; nameB: string; evidence: (string | undefined)[] }) {
  const meta = KIND_META[d.kind];
  return (
    <Card id={`dna-${d.kind}`} className="scroll-mt-20 p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <meta.icon size={18} style={{ color: meta.color }} />
          <h3 className="font-display text-xl font-bold uppercase tracking-wide md:text-2xl">{meta.plural}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>
            <span className="font-mono text-text">
              {d.sharedCount}/{depthOf(d)}
            </span>{" "}
            shared
          </span>
          <span>
            <span className="font-mono text-text">{Math.round(d.jaccard * 100)}%</span> overlap
          </span>
          {evidence.some(Boolean) && (
            <span className="font-mono text-[10px] text-faint" title="Receipt ids of the Qloo requests behind this domain">
              {evidence.filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1fr)]">
        <OnlyColumn side="a" name={nameA} other={nameB} entities={d.onlyA} count={d.uniqueA} leans={d.leansA} depth={d.poolA} />
        <SharedColumn shared={d.shared} nameA={nameA} nameB={nameB} />
        <OnlyColumn side="b" name={nameB} other={nameA} entities={d.onlyB} count={d.uniqueB} leans={d.leansB} depth={d.poolB} />
      </div>
    </Card>
  );
}

function OnlyColumn({
  side,
  name,
  other,
  entities,
  count,
  leans,
  depth,
}: {
  side: Side;
  name: string;
  other: string;
  entities: EntityCard[];
  count: number;
  leans: SharedEntity[];
  depth: number;
}) {
  const tone = TONE[side];
  const extraLeans = leans.slice(0, Math.max(2, 6 - entities.length));
  return (
    <div className={cn("min-w-0 rounded-lg border border-t-2 border-line bg-bg p-3", tone.accent)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate font-display text-sm font-bold uppercase tracking-wide">
          Only <span className={tone.text}>{name}</span> loves
        </div>
        <Badge tone={tone.badge} title={`${count} of ${name}'s top ${depth} aren't in ${other}'s top list`}>
          {count} unique
        </Badge>
      </div>
      {entities.length ? (
        <ol className="space-y-2.5">
          {entities.map((e) => (
            <li key={e.id} className="flex items-center gap-2.5">
              <span className="w-7 shrink-0 text-right font-mono text-[11px] text-muted">#{e.localRank}</span>
              <EntityAvatar entity={e} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text" title={e.name}>
                  {e.name}
                </div>
                <div className="truncate font-mono text-[10px] text-faint">
                  local #{e.localRank} · national #{e.nationalRank}
                </div>
              </div>
              <LiftBadge entity={e} city={name} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-faint">
          Nothing in {name}&apos;s top {depth} that {other} doesn&apos;t also rank.
        </p>
      )}
      {extraLeans.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">Both rank it, {name} much higher</div>
          <ul className="space-y-2">
            {extraLeans.map((s) => {
              const [mine, theirs] = side === "a" ? [s.rankA, s.rankB] : [s.rankB, s.rankA];
              return (
                <li key={s.id} className="flex items-center gap-2.5" title={`#${mine} in ${name} vs #${theirs} in ${other}`}>
                  <span className="w-7 shrink-0 text-right font-mono text-[11px] text-muted">#{mine}</span>
                  <EntityAvatar entity={s} size={26} />
                  <span className="min-w-0 flex-1 truncate text-xs text-text">{s.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    #{theirs} in {other}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function LiftBadge({ entity, city }: { entity: EntityCard; city: string }) {
  const lift = entity.lift ?? 0;
  const title = `#${entity.localRank} in ${city} on local affinity vs #${entity.nationalRank} by national popularity in the same result`;
  if (lift > 0) {
    return (
      <Badge tone="turf" title={title} className="shrink-0 font-mono">
        <ArrowUpRight size={11} />
        {lift}
      </Badge>
    );
  }
  return (
    <Badge title={title} className="shrink-0 font-mono text-faint">
      {lift < 0 ? <ArrowDownRight size={11} /> : <Equal size={11} />}
      {lift < 0 ? -lift : ""}
    </Badge>
  );
}

const SHARED_PREVIEW = 10;

function SharedColumn({ shared, nameA, nameB }: { shared: SharedEntity[]; nameA: string; nameB: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? shared : shared.slice(0, SHARED_PREVIEW);
  return (
    <div className="min-w-0 rounded-lg border border-t-2 border-line border-t-turf/70 bg-surface-2/50 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="font-display text-sm font-bold uppercase tracking-wide">
          Both <span className="text-turf">love</span>
        </div>
        <Badge tone="turf">{shared.length} shared</Badge>
      </div>
      {shared.length ? (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {visible.map((s) => (
              <li
                key={s.id}
                title={`#${s.rankA} in ${nameA} · #${s.rankB} in ${nameB}`}
                className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-line bg-bg py-1 pl-1 pr-2"
              >
                <EntityAvatar entity={s} size={20} className="rounded" />
                <span className="min-w-0 truncate text-xs text-text">{s.name}</span>
                <span className="shrink-0 font-mono text-[10px]">
                  <span className="text-amber/80">#{s.rankA}</span>
                  <span className="text-faint">/</span>
                  <span className="text-sky/80">#{s.rankB}</span>
                </span>
              </li>
            ))}
          </ul>
          {shared.length > SHARED_PREVIEW && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-xs text-muted hover:text-text">
              {expanded ? "Show fewer" : `+${shared.length - SHARED_PREVIEW} more`}
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-faint">Nothing in common. These two markets don&apos;t share a single pick in this domain.</p>
      )}
    </div>
  );
}
