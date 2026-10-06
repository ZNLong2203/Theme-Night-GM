// Shared types used by the server (agent, Qloo workflows) and the client (studio UI).

export type Sport = "baseball" | "basketball" | "hockey" | "soccer" | "football";

/** Audience segments a promotions team typically programs a night for. */
export type SegmentId = "families" | "gen_z" | "young_pros" | "boomers";

export type EntityKind =
  | "movie"
  | "tv_show"
  | "artist"
  | "videogame"
  | "podcast"
  | "book"
  | "brand"
  | "place"
  | "person";

export interface Venue {
  name: string;
  city: string;
  lat: number;
  lon: number;
}

export interface GameDate {
  date: string; // YYYY-MM-DD
  weekday: string; // Mon, Tue, ...
  time: "day" | "night";
  opponent?: string;
  /** Selected as a weak date that the agent should program a theme night for. */
  target: boolean;
  segment: SegmentId;
}

export interface TeamConfig {
  teamName: string;
  sport: Sport;
  league: string;
  venue: Venue;
  dates: GameDate[];
  ipPolicy: "licensed_ok" | "ip_light";
  sponsorCategories: string[];
  notes?: string;
}

/** A Qloo entity reduced to what the UI and the agent need. */
export interface EntityCard {
  id: string;
  name: string;
  kind: EntityKind;
  image?: string;
  popularity?: number;
  affinity?: number;
  year?: number;
  subtitle?: string;
  tags?: string[];
  industries?: string[];
  address?: string;
  lat?: number;
  lon?: number;
  /** Ownership hints (production companies, publisher, developer) used for IP-licensing checks. */
  owners?: string[];
  /** Market scan only: rank by local affinity vs rank by national popularity in the same result set. */
  localRank?: number;
  nationalRank?: number;
  lift?: number;
  /** Rank percentile (0..1) inside the city's pool for this domain — comparable within a domain. */
  localPct?: number;
  /** Sponsor prospects: the sales category (resolved to a Qloo tag) this brand matched. */
  category?: string;
  /** feature.explainability: how much the anchor fandom drove this recommendation (0..1). */
  explain?: number;
}

export type AgeBucket =
  | "24_and_younger"
  | "25_to_29"
  | "30_to_34"
  | "35_to_44"
  | "45_to_54"
  | "55_and_older";

export interface Demographics {
  age: Partial<Record<AgeBucket, number>>;
  gender: { male?: number; female?: number };
}

export interface TrendSeries {
  points: { date: string; percentile: number }[];
  direction: "rising" | "steady" | "cooling" | "unknown";
  changePct: number;
  /** The Qloo trending window actually used (the hackathon dataset ends in 2025). */
  window?: { start: string; end: string };
}

export interface HeatPoint {
  lat: number;
  lon: number;
  affinity: number;
  popularity?: number;
}

export interface HeatSummary {
  points: HeatPoint[];
  /** 0..1 — the catchment's share of the fandom's metro hotspots vs its share of cells (0.5 = fair share). Absent when too few cells. */
  nearVenueIndex?: number;
  catchmentKm: number;
}

export interface EntityProfile {
  entity: EntityCard;
  demographics?: Demographics;
  trend?: TrendSeries;
  heat?: HeatSummary;
  tasteTags?: string[];
  segmentFit?: Partial<Record<SegmentId, number>>;
  evidence: string[];
  /** Measurements that failed, e.g. "Trend: Qloo request failed (429)" — shown instead of "no data". */
  unavailable?: string[];
}

/** One request made to Qloo, recorded for the provenance ("receipts") panel. */
export interface QlooRequestLog {
  id: string; // Q1, Q2, ...
  endpoint: string;
  params: Record<string, string>;
  status: number;
  ms: number;
  resultCount: number;
  cached: boolean;
  simulated: boolean;
  purpose: string;
  /** Agent tool call that issued the request. */
  callId?: string;
}

export interface ScoreBreakdown {
  total: number; // 0..100
  localAffinity: number; // 0..1
  nearVenue: number; // 0..1
  segmentFit: number; // 0..1
  momentum: number; // 0..1
  newFanReach: number; // 0..1
  /** Components Qloo couldn't measure for this fandom, scored at the neutral 0.5 instead. */
  estimated?: ScoreComponent[];
}

export type ScoreComponent = "localAffinity" | "segmentFit" | "nearVenue" | "momentum" | "newFanReach";

export interface Night {
  date: string;
  weekday: string;
  time: "day" | "night";
  segment: SegmentId;
  title: string;
  tagline: string;
  anchor: EntityCard;
  supporting: EntityCard[];
  score: ScoreBreakdown;
  why: string;
  sponsors: { brand: EntityCard; angle: string }[];
  giveaway: string;
  activations: string[];
  playlist: EntityCard[];
  localPartners: { place: EntityCard; idea: string }[];
  mediaPartner?: { podcast: EntityCard; idea: string };
  promo: { headline: string; social: string; emailSubject: string };
  licensing: { risk: "low" | "medium" | "high"; note: string };
  evidence: string[];
}

export interface SeasonPlan {
  id: string;
  createdAt: string;
  team: TeamConfig;
  marketSummary: string;
  nights: Night[];
  profiles: EntityProfile[];
  requests: QlooRequestLog[];
  mode: RunMode;
  /** LLM-only control plan for the same dates, fact-checked with Qloo (added on demand). */
  baseline?: BaselineResult;
  /** "Ask the GM" changes applied after the original run. */
  revisions?: { at: string; request: string; summary: string; changedDates: string[] }[];
}

export interface RunMode {
  qloo: "live" | "simulated";
  llm: "gemini" | "autopilot";
  model?: string;
  /** Where plans and run logs are kept: Redis (shareable links) or this server's memory. */
  store?: "redis" | "memory";
}

export interface MarketScan {
  city: string;
  /** How Qloo resolved the location signal, e.g. "Durham County, North Carolina, United States". */
  resolvedAs?: string;
  domains: { kind: EntityKind; entities: EntityCard[]; evidence: string }[];
  /** Domains Qloo couldn't answer for this market (kept so the agent can adapt instead of failing). */
  unavailable?: { kind: EntityKind; reason: string }[];
}

/** UI payloads attached to tool results so the canvas can render rich evidence. */
export type ToolUIData =
  | { kind: "market_scan"; scan: MarketScan }
  | { kind: "profiles"; profiles: EntityProfile[] }
  | { kind: "fit_matrix"; rows: { entity: EntityCard; fit: Partial<Record<SegmentId, number>> }[] }
  | { kind: "sponsors"; anchor: string; brands: EntityCard[] }
  | {
      kind: "experience";
      anchor: string;
      artists: EntityCard[];
      places: EntityCard[];
      podcasts: EntityCard[];
    }
  | { kind: "crossover"; a: string; b: string; tags: { name: string; score: number }[] }
  | { kind: "search"; results: EntityCard[] };

export type AgentEvent =
  | { type: "run_started"; runId: string; mode: RunMode; at: string }
  | { type: "thought"; text: string }
  | { type: "llm_step"; step: number; status: "started" | "finished"; ms?: number; inputTokens?: number; outputTokens?: number }
  | { type: "message"; text: string }
  | { type: "tool_call"; callId: string; name: string; label: string; args: Record<string, unknown> }
  | { type: "qloo_request"; request: QlooRequestLog }
  | {
      type: "tool_result";
      callId: string;
      name: string;
      ok: boolean;
      summary: string;
      ui?: ToolUIData;
    }
  | { type: "plan"; plan: SeasonPlan }
  | { type: "error"; message: string }
  | { type: "done"; elapsedMs: number; qlooCalls: number; llmSteps: number };

/** The control group: an LLM-only plan for the same dates, fact-checked with Qloo. */
export interface BaselineNight {
  date: string;
  segment: SegmentId;
  title: string;
  anchorName: string;
  why: string;
  found: boolean;
  /** The Qloo lookup itself failed, so "not found" says nothing about the pick (excluded from averages). */
  lookupFailed?: boolean;
  match?: EntityCard;
  score?: ScoreBreakdown;
  evidence?: string[];
}

export interface BaselineResult {
  nights: BaselineNight[];
  requests: QlooRequestLog[];
  mode: RunMode;
}
