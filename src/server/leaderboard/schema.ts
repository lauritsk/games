import * as v from "valibot";
import { parseDifficulty } from "@games/shared/game-preferences";
import {
  leaderboardConfigForGame,
  type LeaderboardMetric,
} from "@features/leaderboard/leaderboard-config";
import { isSyncId } from "@features/sync/sync-schema";
import type { Difficulty } from "@shared/types";
import {
  finiteNumberSchema,
  integerBetweenSchema,
  parseWithSchema,
  picklistSchema,
} from "@shared/validation";
import { usernameError, validateUsername } from "@server/username";

const outcomes = ["won", "lost", "draw", "completed"] as const;
const maxLimit = 50;
const defaultLimit = 10;
const maxMetadataJsonBytes = 2_000;
const maxMetadataKeys = 20;
const maxMetadataStringLength = 128;

const outcomeSchema = picklistSchema(outcomes);
const queryLimitSchema = integerBetweenSchema(1, maxLimit);
const submissionBaseSchema = v.looseObject({ gameId: v.string() });
const metadataEntrySchema = v.union([
  v.pipe(v.string(), v.maxLength(maxMetadataStringLength)),
  finiteNumberSchema,
  v.boolean(),
]);
const metadataSchema = v.pipe(
  v.record(v.pipe(v.string(), v.minLength(1), v.maxLength(40)), metadataEntrySchema),
  v.check((metadata) => Object.keys(metadata).length <= maxMetadataKeys),
  v.check((metadata) => JSON.stringify(metadata).length <= maxMetadataJsonBytes),
);

type Outcome = (typeof outcomes)[number];
type OptionalMetricField = "score" | "moves" | "durationMs" | "level" | "streak";
type OptionalMetricValues = Partial<Record<OptionalMetricField, number>>;
type IntegerRange = { min: number; max: number };

const optionalMetricRanges = {
  score: { min: 0, max: 100_000_000 },
  moves: { min: 0, max: 1_000_000 },
  durationMs: { min: 0, max: 86_400_000 },
  level: { min: 0, max: 10_000 },
  streak: { min: 0, max: 10_000 },
} satisfies Record<OptionalMetricField, IntegerRange>;

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
  const parsedLimit = parseWithSchema(queryLimitSchema, limit);
  if (parsedLimit === null) return invalid("Invalid leaderboard query");

  return {
    ok: true,
    value: difficulty ? { gameId, difficulty, limit: parsedLimit } : { gameId, limit: parsedLimit },
  };
}

export function parseLeaderboardSubmission(value: unknown): ParseResult<LeaderboardSubmission> {
  const base = parseWithSchema(submissionBaseSchema, value);
  if (!base) return invalid("Invalid score");
  const config = leaderboardConfigForGame(base.gameId);
  if (!config) return invalid("Invalid score");

  const username = validateUsername(base.username);
  if (!username.ok) return invalid(usernameError);

  const difficulty = base.difficulty === undefined ? undefined : parseDifficulty(base.difficulty);
  if (base.difficulty !== undefined && !difficulty) return invalid("Invalid score");
  if (config.requireDifficulty && !difficulty) return invalid("Invalid score");

  const outcome = parseWithSchema(outcomeSchema, base.outcome);
  if (!outcome) return invalid("Invalid score");
  if (config.allowedOutcomes && !config.allowedOutcomes.includes(outcome)) {
    return invalid("Invalid score");
  }

  const metricValue = parseIntegerField(base[config.metric], config.maxMetricValue);
  if (metricValue === null) return invalid("Invalid score");

  const optionalMetrics = parseOptionalMetrics(base);
  if (!optionalMetrics) return invalid("Invalid score");

  const metadata = parseMetadata(base.metadata);
  if (metadata === null || !hasRequiredMetadata(metadata, config.requiredMetadata)) {
    return invalid("Invalid score");
  }

  const deviceId = base.deviceId === undefined ? undefined : optionalSyncId(base.deviceId);
  const runId = base.runId === undefined ? undefined : optionalSyncId(base.runId);
  if (deviceId === null || runId === null) return invalid("Invalid score");

  return {
    ok: true,
    value: {
      ...(deviceId ? { deviceId } : {}),
      ...(runId ? { runId } : {}),
      gameId: base.gameId,
      username: username.username,
      normalizedUsername: username.normalizedUsername,
      ...(difficulty ? { difficulty } : {}),
      outcome,
      metric: config.metric,
      metricValue,
      ...optionalMetrics,
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
  return parseWithSchema(integerBetweenSchema(0, max), value);
}

function optionalIntegerField(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined) return undefined;
  return parseWithSchema(integerBetweenSchema(min, max), value);
}

function parseOptionalMetrics(value: Record<string, unknown>): OptionalMetricValues | null {
  const metrics: OptionalMetricValues = {};
  for (const [field, range] of Object.entries(optionalMetricRanges) as Array<
    [OptionalMetricField, IntegerRange]
  >) {
    const metricValue = optionalIntegerField(value[field], range.min, range.max);
    if (metricValue === null) return null;
    if (metricValue !== undefined) metrics[field] = metricValue;
  }
  return metrics;
}

function optionalSyncId(value: unknown): string | undefined | null {
  if (value === null || value === "") return undefined;
  return isSyncId(value) ? value : null;
}

function parseMetadata(value: unknown): Record<string, string | number | boolean> | null {
  if (value === undefined) return {};
  return parseWithSchema(metadataSchema, value);
}

function invalid(error: string): ParseResult<never> {
  return { ok: false, error };
}
