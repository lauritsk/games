import { parseDifficulty } from "../game-preferences";
import { leaderboardConfigForGame, type LeaderboardMetric } from "../leaderboard-config";
import { isSyncId } from "../sync-schema";
import type { Difficulty } from "../types";
import { isInteger, isRecord } from "../validation";
import { usernameError, validateUsername } from "./username";

const outcomes = new Set(["won", "lost", "draw", "completed"]);
const maxLimit = 50;
const defaultLimit = 10;
const maxMetadataJsonBytes = 2_000;
const maxMetadataKeys = 20;
const maxMetadataStringLength = 128;

type Outcome = "won" | "lost" | "draw" | "completed";

export type LeaderboardSubmission = {
  deviceId?: string;
  runId?: string;
  gameId: string;
  username: string;
  normalizedUsername: string;
  difficulty?: Difficulty;
  outcome: Outcome;
  metric: LeaderboardMetric;
  metricValue: number;
  score?: number;
  moves?: number;
  durationMs?: number;
  level?: number;
  streak?: number;
  metadata: Record<string, string | number | boolean>;
};

export type LeaderboardQuery = {
  gameId: string;
  difficulty?: Difficulty;
  limit: number;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseLeaderboardQuery(url: URL): ParseResult<LeaderboardQuery> {
  const gameId = url.searchParams.get("gameId") ?? "";
  if (!leaderboardConfigForGame(gameId)) return invalid("Invalid leaderboard query");

  const difficultyValue = url.searchParams.get("difficulty");
  const difficulty = difficultyValue ? parseDifficulty(difficultyValue) : undefined;
  if (difficultyValue && !difficulty) return invalid("Invalid leaderboard query");

  const limitValue = url.searchParams.get("limit");
  const limit = limitValue === null ? defaultLimit : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    return invalid("Invalid leaderboard query");
  }

  return { ok: true, value: difficulty ? { gameId, difficulty, limit } : { gameId, limit } };
}

export function parseLeaderboardSubmission(value: unknown): ParseResult<LeaderboardSubmission> {
  if (!isRecord(value) || typeof value.gameId !== "string") return invalid("Invalid score");
  const config = leaderboardConfigForGame(value.gameId);
  if (!config) return invalid("Invalid score");

  const username = validateUsername(value.username);
  if (!username.ok) return invalid(usernameError);

  const difficulty = value.difficulty === undefined ? undefined : parseDifficulty(value.difficulty);
  if (value.difficulty !== undefined && !difficulty) return invalid("Invalid score");
  if (config.requireDifficulty && !difficulty) return invalid("Invalid score");

  if (typeof value.outcome !== "string" || !outcomes.has(value.outcome))
    return invalid("Invalid score");
  if (config.allowedOutcomes && !config.allowedOutcomes.includes(value.outcome)) {
    return invalid("Invalid score");
  }

  const metricValue = parseIntegerField(value[config.metric], config.maxMetricValue);
  if (metricValue === null) return invalid("Invalid score");

  const score = optionalIntegerField(value.score, 0, 100_000_000);
  const moves = optionalIntegerField(value.moves, 0, 1_000_000);
  const durationMs = optionalIntegerField(value.durationMs, 0, 86_400_000);
  const level = optionalIntegerField(value.level, 0, 10_000);
  const streak = optionalIntegerField(value.streak, 0, 10_000);
  if (
    score === null ||
    moves === null ||
    durationMs === null ||
    level === null ||
    streak === null
  ) {
    return invalid("Invalid score");
  }

  const metadata = parseMetadata(value.metadata);
  if (metadata === null || !hasRequiredMetadata(metadata, config.requiredMetadata)) {
    return invalid("Invalid score");
  }

  const deviceId = value.deviceId === undefined ? undefined : optionalSyncId(value.deviceId);
  const runId = value.runId === undefined ? undefined : optionalSyncId(value.runId);
  if (deviceId === null || runId === null) return invalid("Invalid score");

  return {
    ok: true,
    value: {
      ...(deviceId ? { deviceId } : {}),
      ...(runId ? { runId } : {}),
      gameId: value.gameId,
      username: username.username,
      normalizedUsername: username.normalizedUsername,
      ...(difficulty ? { difficulty } : {}),
      outcome: value.outcome as Outcome,
      metric: config.metric,
      metricValue,
      ...(score === undefined ? {} : { score }),
      ...(moves === undefined ? {} : { moves }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(level === undefined ? {} : { level }),
      ...(streak === undefined ? {} : { streak }),
      metadata,
    },
  };
}

function hasRequiredMetadata(
  metadata: Record<string, string | number | boolean>,
  required: Readonly<Record<string, string | number | boolean>> | undefined,
): boolean {
  if (!required) return true;
  return Object.entries(required).every(([key, value]) => metadata[key] === value);
}

function parseIntegerField(value: unknown, max: number): number | null {
  return isInteger(value) && value >= 0 && value <= max ? value : null;
}

function optionalIntegerField(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined) return undefined;
  return isInteger(value) && value >= min && value <= max ? value : null;
}

function optionalSyncId(value: unknown): string | undefined | null {
  if (value === null || value === "") return undefined;
  return isSyncId(value) ? value : null;
}

function parseMetadata(value: unknown): Record<string, string | number | boolean> | null {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > maxMetadataKeys) return null;

  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length < 1 || key.length > 40) return null;
    if (typeof entry === "string") {
      if (entry.length > maxMetadataStringLength) return null;
      metadata[key] = entry;
    } else if (typeof entry === "number") {
      if (!Number.isFinite(entry)) return null;
      metadata[key] = entry;
    } else if (typeof entry === "boolean") metadata[key] = entry;
    else return null;
  }

  return JSON.stringify(metadata).length <= maxMetadataJsonBytes ? metadata : null;
}

function invalid(error: string): ParseResult<never> {
  return { ok: false, error };
}
