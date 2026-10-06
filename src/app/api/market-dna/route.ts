import { z } from "zod";
import { compareMarkets, DNA_DEPTH, DNA_KINDS, type MarketDnaResult, type MarketSide } from "@/lib/market-dna";
import { publicError } from "@/lib/errors";
import { QlooRecorder, qlooIsLive } from "@/lib/qloo/client";
import { scanMarket, TasteContext } from "@/lib/qloo/workflows";
import { checkRate, clientKey, tooMany } from "@/lib/rate-limit";
import type { MarketScan, QlooRequestLog } from "@/lib/types";

export const maxDuration = 60;

const City = z.string().trim().min(2, "Market names need at least 2 characters.").max(120, "Market names are capped at 120 characters.");
const QuerySchema = z
  .object({ a: City, b: City })
  .refine((q) => q.a.toLowerCase() !== q.b.toLowerCase(), { message: "Pick two different markets.", path: ["b"] });

/** One market's top lists. Each side gets its own recorder so its receipts stay attributable to it. */
async function scanCity(city: string, signal: AbortSignal) {
  // Five domains per city; the budget only guards against surprises.
  const recorder = new QlooRecorder(undefined, 0, { budget: 15, signal });
  // scanMarket only sends the city as a location signal; venue coordinates are never used.
  const ctx = new TasteContext(recorder, city, { name: city, city, lat: 0, lon: 0 });
  const scan = await scanMarket(ctx, [...DNA_KINDS], DNA_DEPTH, 0.8);
  return { scan, logs: recorder.logs };
}

const seq = (id: string) => Number(id.replace(/^Q/, "")) || 0;

/** Both recorders count from Q1; shift B's ids past A's so every receipt id in the response is unique. */
function shiftIds(scan: MarketScan, logs: QlooRequestLog[], offset: number) {
  const shift = (id: string) => `Q${seq(id) + offset}`;
  return {
    scan: { ...scan, domains: scan.domains.map((d) => ({ ...d, evidence: shift(d.evidence) })) },
    logs: logs.map((log) => ({ ...log, id: shift(log.id) })),
  };
}

const side = (scan: MarketScan): MarketSide => ({
  city: scan.city,
  resolvedAs: scan.resolvedAs,
  domains: scan.domains,
  unavailable: scan.unavailable,
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({ a: url.searchParams.get("a") ?? "", b: url.searchParams.get("b") ?? "" });
  if (!parsed.success) {
    return Response.json({ error: [...new Set(parsed.error.issues.map((i) => i.message))].join(" ") }, { status: 400 });
  }
  const rate = checkRate(`dna:${clientKey(request)}`, 20);
  if (!rate.ok) return tooMany("You've hit the demo limit for market comparisons. Try again in a few minutes.", rate.retryAfter);

  const started = Date.now();
  try {
    const [left, scannedRight] = await Promise.all([scanCity(parsed.data.a, request.signal), scanCity(parsed.data.b, request.signal)]);
    const right = shiftIds(scannedRight.scan, scannedRight.logs, Math.max(0, ...left.logs.map((l) => seq(l.id))));

    for (const { scan } of [left, right]) {
      if (!scan.domains.length) {
        return Response.json({ error: [`Qloo returned no taste data for ${scan.city}.`] }, { status: 502 });
      }
    }

    const body: MarketDnaResult = {
      a: side(left.scan),
      b: side(right.scan),
      overlap: compareMarkets(left.scan, right.scan),
      requests: [...left.logs, ...right.logs].sort((x, y) => seq(x.id) - seq(y.id)),
      simulated: !qlooIsLive(),
      elapsedMs: Date.now() - started,
    };
    return Response.json(body);
  } catch (error) {
    return Response.json({ error: [publicError(error, "The market comparison failed. Try again in a minute.")] }, { status: 502 });
  }
}
