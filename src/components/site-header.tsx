"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RunMode } from "@/lib/types";
import { REPO_URL } from "@/lib/config";
import { Badge, Logo } from "./ui";

export function ModeBadges({ mode }: { mode?: RunMode }) {
  if (!mode) return null;
  return (
    <span className="flex items-center gap-1.5">
      <Badge tone={mode.qloo === "live" ? "turf" : "violet"} title={mode.qloo === "live" ? "Calling the Qloo hackathon API" : "No Qloo key configured: deterministic simulated data"}>
        <span className={mode.qloo === "live" ? "pulse-dot h-1.5 w-1.5 rounded-full bg-turf" : "h-1.5 w-1.5 rounded-full bg-violet"} />
        Qloo {mode.qloo}
      </Badge>
      <Badge tone={mode.llm === "gemini" ? "sky" : "neutral"} title={mode.llm === "gemini" ? "LLM agent with function calling" : "No LLM key: deterministic planner drives the same tools"}>
        {mode.llm === "gemini" ? mode.model : "autopilot"}
      </Badge>
    </span>
  );
}

export function SiteHeader({ mode }: { mode?: RunMode }) {
  const [status, setStatus] = useState<RunMode | undefined>(mode);
  useEffect(() => {
    if (mode) return;
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => undefined);
  }, [mode]);
  return (
    <header className="no-print sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
        <Link href="/">
          <Logo />
        </Link>
        <nav className="flex items-center gap-3 text-sm text-muted">
          <span className="hidden sm:block">
            <ModeBadges mode={mode ?? status} />
          </span>
          <Link href="/studio" className="hover:text-text">
            Studio
          </Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hidden hover:text-text sm:block">
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
