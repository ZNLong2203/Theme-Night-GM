import { ArrowRight, Check, CircleSlash, Database, Lock, MapPinned, Play, Receipt, ShieldCheck, Ticket, Users, X } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { REPO_URL } from "@/lib/config";
import { featuredPlans } from "@/lib/featured";
import { SCORE_LABELS, SCORE_WEIGHTS } from "@/lib/scoring";

const STEPS = [
  {
    n: "01",
    title: "Read the room",
    body: "Asks Qloo what your city has the strongest affinity for across movies, TV, artists, games, podcasts and books, and where it over-indexes vs national popularity.",
    chips: ["/v2/insights", "signal.location.query", "filter.popularity.min", "bias.trends"],
  },
  {
    n: "02",
    title: "Size the fandom",
    body: "For each candidate: who the fans are, whether they live near your venue, whether interest is rising, and the taste tags that describe them.",
    chips: ["urn:demographics", "urn:heatmap", "/v2/trending", "urn:tag"],
  },
  {
    n: "03",
    title: "Fit the audience",
    body: "Scores the shortlist for each date's crowd (families, Gen Z, young pros, 55+) and measures overlap with your existing fan base, to find nights that bring new people.",
    chips: ["signal.demographics.age", "signal.demographics.audiences", "filter.results.entities", "/v2/audiences"],
  },
  {
    n: "04",
    title: "Build the night",
    body: "Finds sponsor brands that share the fandom's taste, the artists for the in-game playlist, places within 6 km for pre-game partners, and podcasts for media buys.",
    chips: ["urn:entity:brand", "urn:entity:artist", "urn:entity:place + filter.location", "urn:entity:podcast", "/v2/analysis/compare"],
  },
  {
    n: "05",
    title: "Ship it with receipts",
    body: "The agent submits a plan, and the server rejects any entity Qloo didn't return. Each night gets a Taste Fit Score, a licensing flag and the exact requests behind it.",
    chips: ["validated IDs", "Taste Fit Score", "request log", "copy-as-curl"],
  },
];

export default async function Home() {
  const featured = await featuredPlans();
  const durham = featured.find((f) => f.slug === "durham-baseball");
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="floodlights relative overflow-hidden border-b border-line">
          <div className="turf-lines absolute inset-0 opacity-40" />
          <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 md:py-24 lg:grid-cols-[1.15fr_1fr] lg:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-amber">
                <Ticket size={13} /> An agent for the people who fill seats
              </div>
              <h1 className="font-display text-5xl font-extrabold uppercase leading-[0.95] tracking-tight md:text-7xl">
                Your emptiest Tuesday,
                <br />
                <span className="text-amber">programmed with taste.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                Theme Night GM is an AI promotions agent for sports teams. It reads what <em>your</em> city actually loves through Qloo&apos;s
                taste graph: who those fans are, where they live and whether they&apos;re growing. Then it turns your weak home dates into theme
                nights with sponsors, a playlist, local partners and promo copy. Every pick comes with receipts.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={durham ? `/studio?replay=${durham.id}` : "/studio?preset=durham-baseball&autorun=1"}
                  className="inline-flex h-12 items-center gap-2 rounded-lg bg-amber px-6 font-semibold text-amber-ink hover:bg-[#ffc56e]"
                >
                  <Play size={18} /> Watch it plan Durham
                </Link>
                <Link
                  href="/studio"
                  className="inline-flex h-12 items-center gap-2 rounded-lg border border-line-strong bg-surface px-6 font-semibold hover:border-amber/60 hover:text-amber"
                >
                  Brief it on your team <ArrowRight size={18} />
                </Link>
              </div>
              <p className="mt-4 text-xs text-faint">
                No sign-up.{" "}
                {durham ? (
                  <>
                    Replays a recorded live run instantly, or{" "}
                    <Link href="/studio?preset=durham-baseball&autorun=1" className="underline hover:text-text">
                      run it live
                    </Link>{" "}
                    (about two minutes).
                  </>
                ) : (
                  "Runs live against the Qloo API; a full season plan takes about two minutes."
                )}
              </p>
            </div>

            <div className="relative">
              <div className="rounded-2xl border border-line bg-surface/90 p-5 shadow-2xl shadow-black/50">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-faint">What the GM weighs for one date</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-faint">illustration</span>
                </div>
                <div className="rounded-xl border border-line bg-bg p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-14 rounded-lg border border-line py-1.5 text-center">
                      <div className="text-[10px] font-semibold uppercase text-amber">Tue</div>
                      <div className="font-display text-2xl font-bold leading-none">6</div>
                      <div className="text-[10px] uppercase text-muted">Apr</div>
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-muted">Night game · school night · vs Norfolk</div>
                      <div className="font-display text-xl font-bold uppercase">Which crowd? Which fandom?</div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2.5">
                    {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k, i) => (
                      <div key={k} className="flex items-center gap-3 text-xs">
                        <span className="w-32 shrink-0 text-muted">{SCORE_LABELS[k].label}</span>
                        <div className="h-1.5 flex-1 rounded-full bg-line">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${[82, 74, 61, 69, 77][i]}%`, background: ["var(--amber)", "var(--turf)", "var(--sky)", "var(--violet)", "var(--rose)"][i] }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono text-faint">×{SCORE_WEIGHTS[k]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Sponsors", "brands sharing the taste"],
                    ["Playlist", "artists fans love locally"],
                    ["Partners", "places ≤ 6 km away"],
                  ].map(([t, d]) => (
                    <div key={t} className="rounded-lg border border-line bg-bg p-2">
                      <div className="font-display text-sm font-bold uppercase">{t}</div>
                      <div className="text-[10px] text-faint">{d}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {featured.length > 0 && (
          <section className="mx-auto max-w-7xl px-4 pt-12">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">Finished plans from live runs</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((f) => (
                <div key={f.slug} className="rounded-xl border border-line bg-surface p-4">
                  <div className="font-display text-lg font-bold uppercase">{f.city}</div>
                  <div className="text-xs text-muted">{f.team}</div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                    <Link href={`/plan/${f.id}`} className="rounded-md bg-amber px-2.5 py-1 text-amber-ink hover:bg-[#ffc56e]">
                      Open plan
                    </Link>
                    <Link href={`/studio?replay=${f.id}`} className="rounded-md border border-line-strong px-2.5 py-1 hover:border-amber/60 hover:text-amber">
                      Replay the run
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Problem */}
        <section className="mx-auto max-w-7xl px-4 py-16">
          <div className="max-w-3xl">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">The problem</div>
            <h2 className="font-display text-3xl font-bold uppercase tracking-wide md:text-4xl">Theme nights fill seats. They&apos;re planned on gut feel.</h2>
            <p className="mt-4 text-muted">
              Minor-league and mid-market clubs lean on promotions to sell weeknight tickets: bobbleheads, fireworks, &quot;Night&quot; after
              &quot;Night&quot;. A small promotions staff plans a whole season of them every off-season, usually from the same list every other
              club uses. Nothing in that process tells them what <em>their</em> market loves, whether those fans live near the ballpark, or
              which sponsor would pay to be part of it.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-5">
              <div className="mb-3 flex items-center gap-2 font-display text-lg font-bold uppercase text-muted">
                <CircleSlash size={18} className="text-rose" /> LLM alone
              </div>
              <ul className="space-y-2 text-sm text-muted">
                {[
                  "Suggests the same Star Wars / Harry Potter / 80s nights for every city",
                  "Can't tell you if the fans live 5 km or 50 km from your venue",
                  "Guesses which audience a fandom skews to",
                  "Invents sponsor fits with nothing to show a brand",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <X size={16} className="mt-0.5 shrink-0 text-rose" /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-amber/30 bg-amber/5 p-5">
              <div className="mb-3 flex items-center gap-2 font-display text-lg font-bold uppercase text-amber">
                <Check size={18} /> Theme Night GM + Qloo
              </div>
              <ul className="space-y-2 text-sm text-text">
                {[
                  "Finds fandoms your city over-indexes on: local rank vs national rank",
                  "Maps where those fans concentrate around your venue (urn:heatmap)",
                  "Scores each fandom for the date's crowd with demographic & life-stage signals",
                  "Pitches sponsors whose Qloo audience shares the taste, with numbers to quote",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-turf" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-line bg-surface/40">
          <div className="mx-auto max-w-7xl px-4 py-16">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">How the agent works</div>
            <h2 className="max-w-3xl font-display text-3xl font-bold uppercase tracking-wide md:text-4xl">
              Eight tools, about 90–110 Qloo requests, one season plan.
            </h2>
            <p className="mt-3 max-w-3xl text-muted">
              A Gemini 3.8 Flash agent plans and calls tools. Each tool is a Qloo workflow that bundles the requests needed to answer one question
              a promotions director would ask. You can watch every step live.
            </p>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((s) => (
                <div key={s.n} className="flex flex-col rounded-xl border border-line bg-bg p-4">
                  <div className="font-display text-3xl font-extrabold text-amber/80">{s.n}</div>
                  <div className="mt-1 font-display text-lg font-bold uppercase tracking-wide">{s.title}</div>
                  <p className="mt-2 flex-1 text-sm text-muted">{s.body}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {s.chips.map((c) => (
                      <code key={c} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-sky">
                        {c}
                      </code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Score + responsibility */}
        <section className="mx-auto grid max-w-7xl gap-6 px-4 py-16 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-6">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">Taste Fit Score</div>
            <h3 className="font-display text-2xl font-bold uppercase">One number a GM can defend</h3>
            <p className="mt-2 text-sm text-muted">
              Computed by code from Qloo responses, not written by the model, so it is consistent across runs and explainable line by line.
            </p>
            <ul className="mt-5 space-y-3">
              {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k) => (
                <li key={k} className="flex gap-3">
                  <span className="w-12 shrink-0 font-mono text-sm text-amber">{Math.round(SCORE_WEIGHTS[k] * 100)}%</span>
                  <span>
                    <span className="block text-sm font-semibold">{SCORE_LABELS[k].label}</span>
                    <span className="block text-xs text-muted">{SCORE_LABELS[k].help}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-line bg-surface p-6">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">Responsible by design</div>
            <h3 className="font-display text-2xl font-bold uppercase">Aggregate taste, never people</h3>
            <ul className="mt-5 space-y-4 text-sm">
              {[
                [Lock, "No personal data goes to Qloo.", "The agent sends team, city and venue only. Results are aggregate audience affinities."],
                [Users, "No sensitive targeting.", "Segments are age and life stage only. The agent is instructed never to infer ethnicity, religion, health or politics."],
                [Receipt, "Every claim has a receipt.", "Each night lists the exact Qloo requests behind it, and you can copy any of them as curl."],
                [ShieldCheck, "IP-aware.", "Studio and publisher metadata flags nights that need a license, and the license-free mode avoids them."],
                [Database, "Can't cite made-up data.", "The plan validator rejects any entity ID that Qloo didn't return during the run."],
              ].map(([Icon, title, body]) => {
                const I = Icon as typeof Lock;
                return (
                  <li key={title as string} className="flex gap-3">
                    <I size={18} className="mt-0.5 shrink-0 text-turf" />
                    <span>
                      <span className="font-semibold">{title as string}</span> <span className="text-muted">{body as string}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-col items-center px-4 py-16 text-center">
            <MapPinned size={28} className="text-amber" />
            <h2 className="mt-3 font-display text-3xl font-bold uppercase md:text-4xl">Pick a market. Watch the GM work.</h2>
            <p className="mt-2 max-w-xl text-muted">Durham baseball, LA baseball, Portland soccer, Nashville hockey, or your own team, city and schedule.</p>
            <Link href="/studio" className="mt-6 inline-flex h-12 items-center gap-2 rounded-lg bg-amber px-6 font-semibold text-amber-ink hover:bg-[#ffc56e]">
              Open the studio <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-faint">
          <span>Built for the Qloo Agentic Hackathon · Taste data by Qloo · Agent: Gemini 3.8 Flash · MIT License</span>
          <span className="flex gap-4">
            <a href={REPO_URL} className="hover:text-text">
              Source on GitHub
            </a>
            <a href="https://docs.qloo.com" className="hover:text-text">
              Qloo API docs
            </a>
          </span>
        </div>
      </footer>
    </>
  );
}
