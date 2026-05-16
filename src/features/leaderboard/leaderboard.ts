import {
  leaderboardConfigForGame,
  type LeaderboardMetric,
} from "@features/leaderboard/leaderboard-config";
import { formatMetric } from "@features/results/game-result-format";
import type { GameResult } from "@features/results/game-results";
import type { Difficulty } from "@shared/types";
import { readStored, storageKey, writeStored } from "@shared/storage";
import {
  finiteNumberSchema,
  integerBetweenSchema,
  parseWithSchema,
  primitiveValueSchema,
  unknownRecordSchema,
} from "@shared/validation";

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

const LEADERBOARD_SCHEMA_VERSION = 1;
const leaderboardKey = storageKey("leaderboard");
const maxEntriesPerGame = 50;

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
  const config = leaderboardConfigForGame(gameId);
  if (!config) return { ok: false, error: "Leaderboard unavailable." };
  const limit = Math.max(1, Math.min(50, options.limit ?? 10));
  const entries = rankedEntries(loadEntries(), gameId, options.difficulty).slice(0, limit);
  return { ok: true, entries };
}

export async function submitLeaderboardScore(
  result: GameResult,
  username: string,
): Promise<LeaderboardSubmitResponse> {
  const config = leaderboardConfigForGame(result.gameId);
  if (!config || !isLeaderboardEligible(result))
    return { ok: false, error: "Result cannot be submitted." };
  const metricValue = result[config.metric];
  if (typeof metricValue !== "number") return { ok: false, error: "Result cannot be submitted." };

  const entries = loadEntries();
  const existing = entries.find((entry) => entry.id === result.runId);
  if (existing) {
    const ranked = rankedEntries(entries, existing.gameId, existing.difficulty);
    return {
      ok: true,
      rank: existingRank(ranked, existing),
      entry: ranked.find((entry) => entry.id === existing.id) ?? existing,
    };
  }

  const entry: LeaderboardEntry = {
    id: result.runId,
    gameId: result.gameId,
    username: sanitizeUsername(username),
    difficulty: result.difficulty,
    outcome: result.outcome,
    metric: config.metric,
    metricValue,
    score: result.score,
    moves: result.moves,
    durationMs: result.durationMs,
    level: result.level,
    streak: result.streak,
    metadata: result.metadata,
    createdAt: new Date().toISOString(),
  };

  const next = pruneEntries([...entries, entry]);
  writeStored(leaderboardKey, LEADERBOARD_SCHEMA_VERSION, next);
  const ranked = rankedEntries(next, entry.gameId, entry.difficulty);
  return {
    ok: true,
    rank: existingRank(ranked, entry),
    entry: ranked.find((item) => item.id === entry.id) ?? entry,
  };
}

function rankedEntries(
  entries: LeaderboardEntry[],
  gameId: string,
  difficulty?: Difficulty,
): LeaderboardEntry[] {
  const config = leaderboardConfigForGame(gameId);
  if (!config) return [];
  return entries
    .filter((entry) => entry.gameId === gameId && (!difficulty || entry.difficulty === difficulty))
    .sort((a, b) => {
      const metricDiff =
        config.direction === "max" ? b.metricValue - a.metricValue : a.metricValue - b.metricValue;
      return metricDiff || a.createdAt.localeCompare(b.createdAt);
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function existingRank(entries: LeaderboardEntry[], entry: LeaderboardEntry): number {
  return entries.find((item) => item.id === entry.id)?.rank ?? entries.length + 1;
}

function pruneEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const groups = new Map<string, LeaderboardEntry[]>();
  for (const entry of entries) {
    const key = `${entry.gameId}:${entry.difficulty ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].flatMap((group) =>
    rankedEntries(group, group[0]?.gameId ?? "", group[0]?.difficulty).slice(0, maxEntriesPerGame),
  );
}

function loadEntries(): LeaderboardEntry[] {
  return readStored(leaderboardKey, LEADERBOARD_SCHEMA_VERSION, parseEntries) ?? [];
}

function parseEntries(value: unknown): LeaderboardEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(parseEntry).filter((entry): entry is LeaderboardEntry => entry !== null);
}

function parseEntry(value: unknown): LeaderboardEntry | null {
  const record = parseWithSchema(unknownRecordSchema, value);
  if (!record) return null;
  const id = typeof record.id === "string" ? record.id : null;
  const gameId = typeof record.gameId === "string" ? record.gameId : null;
  const username = typeof record.username === "string" ? record.username : null;
  const outcome = typeof record.outcome === "string" ? record.outcome : null;
  const metric = typeof record.metric === "string" ? (record.metric as LeaderboardMetric) : null;
  const metricValue = parseWithSchema(finiteNumberSchema, record.metricValue);
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : null;
  if (!id || !gameId || !username || !outcome || !metric || metricValue === null || !createdAt)
    return null;
  return {
    id,
    gameId,
    username,
    difficulty: parseDifficulty(record.difficulty),
    outcome,
    metric,
    metricValue,
    score: optionalNumber(record.score),
    moves: optionalNumber(record.moves),
    durationMs: optionalNumber(record.durationMs),
    level: optionalNumber(record.level),
    streak: optionalNumber(record.streak),
    metadata: parseMetadata(record.metadata),
    createdAt,
  };
}

function optionalNumber(value: unknown): number | undefined {
  return parseWithSchema(finiteNumberSchema, value) ?? undefined;
}

function parseDifficulty(value: unknown): Difficulty | undefined {
  return value === "Easy" || value === "Medium" || value === "Hard" ? value : undefined;
}

function parseMetadata(value: unknown): Record<string, string | number | boolean> | undefined {
  const record = parseWithSchema(unknownRecordSchema, value);
  if (!record) return undefined;
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(record)) {
    const parsed = parseWithSchema(primitiveValueSchema, entry);
    if (parsed !== null) metadata[key] = parsed;
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function sanitizeUsername(username: string): string {
  const trimmed = username.trim().replace(/\s+/g, " ").slice(0, 16);
  return trimmed || "Player";
}
