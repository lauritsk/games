import type {
  LeaderboardDirection,
  LeaderboardMetric,
} from "@features/leaderboard/leaderboard-config";
import { parseJsonSafely } from "@shared/json";
import type { Difficulty } from "@shared/types";

export type LeaderboardEntry = {
  id: string;
  gameId: string;
  username: string;
  difficulty?: Difficulty;
  outcome: string;
  metric: LeaderboardMetric;
  metricValue: number;
  score?: number;
  moves?: number;
  durationMs?: number;
  level?: number;
  streak?: number;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
  rank?: number;
};

export type LeaderboardInsert = {
  id?: string;
  runId?: string;
  deviceId?: string;
  gameId: string;
  username: string;
  normalizedUsername: string;
  difficulty?: Difficulty;
  outcome: string;
  metric: LeaderboardMetric;
  metricValue: number;
  score?: number;
  moves?: number;
  durationMs?: number;
  level?: number;
  streak?: number;
  metadata: Record<string, string | number | boolean>;
  createdAt?: string;
};

export type LeaderboardListOptions = {
  gameId: string;
  metric: LeaderboardMetric;
  direction: LeaderboardDirection;
  difficulty?: Difficulty;
  limit: number;
};

export type LeaderboardRow = {
  id: string;
  game_id: string;
  username: string;
  difficulty: string | null;
  outcome: string;
  metric: LeaderboardMetric;
  metric_value: number;
  score: number | null;
  moves: number | null;
  duration_ms: number | null;
  level: number | null;
  streak: number | null;
  metadata_json: string;
  created_at: string;
};

export function createLeaderboardId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return `leaderboard-${crypto.randomUUID()}`;
  return `leaderboard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function rowToLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  const entry: LeaderboardEntry = {
    id: row.id,
    gameId: row.game_id,
    username: row.username,
    outcome: row.outcome,
    metric: row.metric,
    metricValue: row.metric_value,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
  };
  if (row.difficulty === "Easy" || row.difficulty === "Medium" || row.difficulty === "Hard") {
    entry.difficulty = row.difficulty;
  }
  if (row.score !== null) entry.score = row.score;
  if (row.moves !== null) entry.moves = row.moves;
  if (row.duration_ms !== null) entry.durationMs = row.duration_ms;
  if (row.level !== null) entry.level = row.level;
  if (row.streak !== null) entry.streak = row.streak;
  return entry;
}

function parseMetadata(value: string): Record<string, string | number | boolean> {
  const parsedJson = parseJsonSafely(value);
  if (!parsedJson.ok || !parsedJson.value || typeof parsedJson.value !== "object") return {};
  if (Array.isArray(parsedJson.value)) return {};

  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(parsedJson.value)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      metadata[key] = entry;
    }
  }
  return metadata;
}
