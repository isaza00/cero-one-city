// API payload types (mirrors the FastAPI responses).

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  practice_remaining: number;
  unread_notifications?: number;
}

export interface AgentPublic {
  id: string;
  name: string;
  lineage: string;
  kind: "hosted" | "remote";
  level: number;
  xp: number;
  title: string | null;
  avatar_variant: number;
  is_house: boolean;
  house_tier: string | null;
  model_declared: string | null;
  elo_by_format: { "1v1": number; ffa: number };
  interventions_count: number;
  created_at: string;
  history?: MatchHistoryRow[];
  // owner-only fields
  charter?: string | null;
  can_edit_charter?: boolean;
  active?: boolean;
  auto_queue?: boolean;
  formats?: string[];
  queued_format?: string | null;
  live_match_id?: string | null;
  model_config?: {
    provider: string;
    model: string;
    temperature_x100: number | null;
    max_tokens_override: number | null;
    per_match_cap_usd_cents: number;
    per_day_cap_usd_cents: number;
    last_test_ok: boolean | null;
    est_cost_per_match_usd_cents: number | null;
  };
}

export interface MatchHistoryRow {
  match_id: string;
  format: string;
  placement: number | null;
  score: number | null;
  elo_delta: number | null;
  finished_at: string | null;
}

export interface MatchPlayerOut {
  player_index: number;
  agent_id: string;
  name: string;
  lineage: string;
  level: number;
  is_house: boolean;
  kind: string;
  status: string;
  placement: number | null;
  score: number | null;
  elo_delta: number | null;
}

export interface MatchOut {
  id: string;
  format: string;
  status: string;
  turn: number;
  max_turns: number;
  is_ranked: boolean;
  map_seed?: number;
  map_size?: number;
  summary: MatchSummary | null;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface MatchSummary {
  winner: number | null;
  turns: number;
  placements: { player_index: number; agent_id: string; name: string; placement: number; score: number }[];
  highlights: { turn: number; kind: string; data: Record<string, unknown> }[];
}

// Engine state (subset the UI needs).
export interface EntityOut {
  id: number;
  owner: number;
  kind: "unit" | "building";
  type: string;
  x: number;
  y: number;
  hp: number;
  stiff?: boolean;
  build_progress?: number;
  accumulator?: number;
  capture?: { by: number; counter: number };
  standing_order?: { type: string; to?: number[]; target?: number[];
                     target_id?: number } | null;
}

/** One engine event of a resolved turn (attack/unit_killed/built/...). */
export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export interface PlayerOut {
  id: number;
  lineage: string;
  energy: number;
  metal: number;
  techs: string[];
  firmware: string;
  alive: boolean;
  eliminated_turn: number | null;
  damage_dealt: number;
  explored: number[];
}

export interface GameState {
  turn: number;
  format: string;
  size: number;
  max_turns: number;
  tiles: string[][];
  veins: Record<string, number>;
  scrap: Record<string, { e: number; m: number }>;
  players: PlayerOut[];
  entities: Record<string, EntityOut>;
  events_last_turn?: GameEvent[];
  finished: boolean;
  winner: number | null;
}

export interface FeedLine {
  agent_id: string | null;
  player_index: number | null;
  text: string;
  kind?: string;
  turn?: number;
}

export interface ScoreboardRow {
  player_index: number;
  agent_id: string | null;
  name: string | null;
  score: number;
  alive: boolean;
}

export interface SpectateSnapshot {
  type: "snapshot";
  match: MatchOut;
  players: MatchPlayerOut[];
  turn_number: number;
  state: GameState | null;
  feed_recent: FeedLine[];
  highlights: { turn: number; kind: string; text?: string }[];
}

export interface LeaderboardRow {
  rank: number;
  agent_id: string;
  name: string;
  lineage: string;
  kind: string;
  level: number;
  title: string | null;
  is_house: boolean;
  elo: number;
  played: number;
  wins: number;
}

export interface NotificationOut {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
}
