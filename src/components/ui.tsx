"use client";

import { useState } from "react";
import { cleanModelText } from "@/lib/text";
import { clsx, type ClassValue } from "clsx";
import {
  BookOpen,
  Clapperboard,
  Gamepad2,
  Mic,
  Music2,
  ShoppingBag,
  Store,
  Tv,
  User,
  type LucideIcon,
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import type { EntityCard, EntityKind } from "@/lib/types";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const KIND_META: Record<EntityKind, { label: string; plural: string; icon: LucideIcon; color: string }> = {
  movie: { label: "Movie", plural: "Movies", icon: Clapperboard, color: "#ffb547" },
  tv_show: { label: "TV", plural: "TV shows", icon: Tv, color: "#6c9bff" },
  artist: { label: "Artist", plural: "Artists", icon: Music2, color: "#ff6b8b" },
  videogame: { label: "Game", plural: "Video games", icon: Gamepad2, color: "#3ddc97" },
  podcast: { label: "Podcast", plural: "Podcasts", icon: Mic, color: "#b18cff" },
  book: { label: "Book", plural: "Books", icon: BookOpen, color: "#f2d16b" },
  brand: { label: "Brand", plural: "Brands", icon: ShoppingBag, color: "#5fd4e8" },
  place: { label: "Place", plural: "Places", icon: Store, color: "#ff9b6b" },
  person: { label: "Person", plural: "People", icon: User, color: "#c9d1e3" },
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline"; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        variant === "primary" && "bg-amber text-amber-ink hover:bg-[#ffc56e]",
        variant === "outline" && "border border-line-strong bg-surface text-text hover:border-amber/60 hover:text-amber",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-text",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber" | "turf" | "sky" | "rose" | "violet";
  className?: string;
  title?: string;
}) {
  const tones = {
    neutral: "border-line-strong bg-surface-2 text-muted",
    amber: "border-amber/30 bg-amber/10 text-amber",
    turf: "border-turf/30 bg-turf/10 text-turf",
    sky: "border-sky/30 bg-sky/10 text-sky",
    rose: "border-rose/30 bg-rose/10 text-rose",
    violet: "border-violet/30 bg-violet/10 text-violet",
  };
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none", tones[tone], className)}
    >
      {children}
    </span>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-surface", className)} {...props} />;
}

export function ScoreRing({ value, size = 56, stroke = 5 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 75 ? "var(--turf)" : value >= 60 ? "var(--amber)" : "var(--rose)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Taste Fit Score ${value}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-display font-bold" style={{ fontSize: size * 0.36, color }}>
        {value}
      </span>
    </div>
  );
}

export function EntityAvatar({ entity, size = 40, className }: { entity: Pick<EntityCard, "name" | "kind" | "image">; size?: number; className?: string }) {
  const meta = KIND_META[entity.kind] ?? KIND_META.brand;
  const Icon = meta.icon;
  const [failed, setFailed] = useState<string>();
  if (entity.image && failed !== entity.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={entity.image}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(entity.image)}
        className={cn("shrink-0 rounded-lg border border-line object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={cn("grid shrink-0 place-items-center rounded-lg border", className)}
      style={{
        width: size,
        height: size,
        borderColor: `${meta.color}40`,
        background: `linear-gradient(135deg, ${meta.color}26, ${meta.color}0a)`,
        color: meta.color,
      }}
    >
      <Icon size={size * 0.45} />
    </div>
  );
}

export function KindBadge({ kind }: { kind: EntityKind }) {
  const meta = KIND_META[kind] ?? KIND_META.brand;
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: meta.color, background: `${meta.color}14` }}
    >
      <Icon size={11} />
      {meta.label}
    </span>
  );
}

/**
 * Text the model wrote for people: **bold** and *italic* render, code ticks are dropped, and internal
 * entity IDs (meant for tool arguments only) are removed. Everything else stays plain text, never HTML.
 */
export function ModelText({ text }: { text: string }) {
  const clean = cleanModelText(text);
  return (
    <>
      {clean.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) =>
        part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : part.length > 2 && part.startsWith("*") && part.endsWith("*") ? (
          <em key={i}>{part.slice(1, -1)}</em>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function Meter({ value, color = "var(--amber)", className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      <div className="h-full rounded-full" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color, transition: "width 500ms ease" }} />
    </div>
  );
}

export function SectionTitle({ eyebrow, title, className }: { eyebrow?: string; title: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      {eyebrow && <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">{eyebrow}</div>}
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-text md:text-3xl">{title}</h2>
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber font-display text-lg font-extrabold text-amber-ink">GM</span>
      <span className="font-display text-xl font-bold uppercase tracking-wide">
        Theme Night <span className="text-amber">GM</span>
      </span>
    </span>
  );
}
