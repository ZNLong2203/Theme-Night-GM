"use client";

import { Check, Copy, Receipt } from "lucide-react";
import { useMemo, useState } from "react";
import type { QlooRequestLog } from "@/lib/types";
import { Badge, cn } from "../ui";

const BASE = "https://hackathon.api.qloo.com";

export function curlFor(r: QlooRequestLog) {
  const qs = new URLSearchParams(r.params).toString();
  return `curl -s -H "X-Api-Key: $QLOO_API_KEY" "${BASE}${r.endpoint}?${qs}"`;
}

/** Every Qloo request the agent made: the provenance behind each recommendation. */
export function Receipts({ requests, highlight, className }: { requests: QlooRequestLog[]; highlight?: string[]; className?: string }) {
  const [filter, setFilter] = useState<string>("all");
  const [copied, setCopied] = useState<string>();
  const endpoints = useMemo(() => [...new Set(requests.map((r) => r.endpoint))], [requests]);
  const highlighted = new Set(highlight ?? []);
  const list = requests.filter((r) => (filter === "all" ? true : filter === "cited" ? highlighted.has(r.id) : r.endpoint === filter));
  const typeOf = (r: QlooRequestLog) => r.params["filter.type"]?.replace("urn:", "") ?? "";

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Receipt size={14} className="text-amber" />
        {["all", ...(highlight?.length ? ["cited"] : []), ...endpoints].map((e) => (
          <button
            key={e}
            onClick={() => setFilter(e)}
            className={cn(
              "rounded-md border px-2 py-0.5 font-mono text-[11px]",
              filter === e ? "border-amber/50 bg-amber/10 text-amber" : "border-line text-muted hover:text-text",
            )}
          >
            {e === "all" ? `all (${requests.length})` : e === "cited" ? `cited here (${highlight?.length})` : e}
          </button>
        ))}
      </div>
      <div className="scroll-thin max-h-[440px] space-y-1.5 overflow-y-auto pr-1">
        {list.map((r) => (
          <details key={r.id} className={cn("group rounded-lg border bg-bg", highlighted.has(r.id) ? "border-amber/40" : "border-line")}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 font-mono text-[11px]">
              <span className="w-8 text-amber">{r.id}</span>
              <span className="text-sky">{r.endpoint}</span>
              {typeOf(r) && <span className="text-violet">{typeOf(r)}</span>}
              <span className="hidden truncate font-sans text-xs text-muted md:inline">{r.purpose}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {r.status !== 200 && <Badge tone="rose">{r.status}</Badge>}
                {r.simulated && <Badge tone="violet">simulated</Badge>}
                {r.cached && <Badge>cached</Badge>}
                <span className="text-faint">{r.resultCount} res</span>
              </span>
            </summary>
            <div className="border-t border-line px-2.5 py-2">
              <p className="mb-2 text-xs text-muted md:hidden">{r.purpose}</p>
              <table className="w-full font-mono text-[11px]">
                <tbody>
                  {Object.entries(r.params).map(([k, v]) => (
                    <tr key={k}>
                      <td className="w-56 py-0.5 pr-3 align-top text-faint">{k}</td>
                      <td className="break-all py-0.5 text-text">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:text-text"
                onClick={() => {
                  navigator.clipboard.writeText(curlFor(r));
                  setCopied(r.id);
                  setTimeout(() => setCopied(undefined), 1500);
                }}
              >
                {copied === r.id ? <Check size={12} /> : <Copy size={12} />} Copy as curl (your key stays in $QLOO_API_KEY)
              </button>
            </div>
          </details>
        ))}
        {!list.length && <p className="py-6 text-center text-xs text-faint">No requests yet.</p>}
      </div>
    </div>
  );
}
