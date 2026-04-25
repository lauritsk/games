import {
  leaderboardConfigForGame,
  type LeaderboardMetric,
} from "@features/leaderboard/leaderboard-config";
import { formatMetric } from "@features/results/game-result-format";
import type { GameResult } from "@features/results/game-results";
import type { Difficulty } from "@shared/types";
import { getDeviceId } from "@features/sync/sync";
import { requestApiJson } from "@shared/api-client";
import { integerBetweenSchema, parseWithSchema } from "@shared/validation";

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
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
  rank?: number;
};

export type LeaderboardListResponse = { ok: true; entries: LeaderboardEntry[] } | ApiError;
export type LeaderboardSubmitResponse =
  | { ok: true; rank: number; entry: LeaderboardEntry }
  | ApiError;

type ApiError = { ok: false; error: string };

export function hasLeaderboard(gameId: string): boolean {
  return leaderboardConfigForGame(gameId) !== null;
}

export function isLeaderboardEligible(result: GameResult): boolean {
  const config = leaderboardConfigForGame(result.gameId);
  if (!config) return false;
  const value = result[config.metric];
  if (parseWithSchema(integerBetweenSchema(0, config.maxMetricValue), value) === null) return false;
  if (config.requireDifficulty && !result.difficulty) return false;
  if (config.allowedOutcomes && !config.allowedOutcomes.includes(result.outcome)) return false;
  return hasRequiredMetadata(result.metadata, config.requiredMetadata);
}

export function leaderboardMetricText(entry: LeaderboardEntry): string {
  return formatMetric(entry.metric, entry.metricValue);
}

export function leaderboardResultMetricText(result: GameResult): string {
  const config = leaderboardConfigForGame(result.gameId);
  if (!config) return "Metric unavailable";
  const value = result[config.metric];
  return typeof value === "number"
    ? `${config.label[0]?.toLocaleUpperCase()}${config.label.slice(1)} ${formatMetric(config.metric, value)}`
    : "Metric unavailable";
}

function hasRequiredMetadata(
  metadata: GameResult["metadata"] | undefined,
  required: Readonly<Record<string, string | number | boolean>> | undefined,
): boolean {
  if (!required) return true;
  if (!metadata) return false;
  return Object.entries(required).every(([key, value]) => metadata[key] === value);
}

export async function fetchLeaderboard(
  gameId: string,
  options: { difficulty?: Difficulty; limit?: number } = {},
): Promise<LeaderboardListResponse> {
  const params = new URLSearchParams({ gameId, limit: String(options.limit ?? 10) });
  if (options.difficulty) params.set("difficulty", options.difficulty);
  return requestApiJson<LeaderboardListResponse>(
    `/api/leaderboard?${params.toString()}`,
    "Leaderboard unavailable.",
  );
}

export async function submitLeaderboardScore(
  result: GameResult,
  username: string,
): Promise<LeaderboardSubmitResponse> {
  const config = leaderboardConfigForGame(result.gameId);
  if (!config) return { ok: false, error: "Result cannot be submitted." };
  const body: Record<string, unknown> = {
    deviceId: getDeviceId(),
    runId: result.runId,
    gameId: result.gameId,
    username,
    difficulty: result.difficulty,
    outcome: result.outcome,
    score: result.score,
    moves: result.moves,
    durationMs: result.durationMs,
    level: result.level,
    streak: result.streak,
    metadata: result.metadata ?? {},
  };
  return requestApiJson<LeaderboardSubmitResponse>("/api/leaderboard", "Leaderboard unavailable.", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
