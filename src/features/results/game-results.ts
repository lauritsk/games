import * as v from "valibot";
import type { Difficulty } from "@shared/types";
import { readStored, storageKey, writeStored } from "@shared/storage";
import { parseDifficulty } from "@games/shared/game-preferences";
import { notifySyncChanged, recordResultsClearedForSync } from "@features/sync/sync-local";
import {
  numericResultFields,
  type ResultMetric,
  type MetricDirection,
} from "@features/results/result-metrics";
import {
  finiteNumberSchema,
  parseWithSchema,
  picklistSchema,
  primitiveValueSchema,
  unknownRecordSchema,
} from "@shared/validation";

export type GameOutcome = "won" | "lost" | "draw" | "completed";
export type GameMetadata = Record<string, string | number | boolean>;

export type GameResult = {
  id: string;
  runId: string;
  gameId: string;
  finishedAt: string;
  durationMs?: number;
  difficulty?: Difficulty;
  outcome: GameOutcome;
  score?: number;
  moves?: number;
  level?: number;
  streak?: number;
  metadata?: GameMetadata;
};

type OptionalResultDetails = Pick<
  GameResult,
  "difficulty" | "durationMs" | "score" | "moves" | "level" | "streak" | "metadata"
>;

const RESULTS_SCHEMA_VERSION = 1;
const resultsKey = storageKey("results");
const outcomes = ["won", "lost", "draw", "completed"] as const satisfies readonly GameOutcome[];
const maxTotalResults = 250;
const maxResultsPerGame = 50;
const resultBaseSchema = v.looseObject({
  id: v.string(),
  runId: v.string(),
  gameId: v.string(),
  finishedAt: v.string(),
  outcome: picklistSchema(outcomes),
});

export function recordGameResult(result: Omit<GameResult, "id" | "finishedAt">): void {
  const current = listGameResults();
  if (current.some((item) => item.runId === result.runId)) return;
  const next: GameResult = {
    ...sanitizeResult(result),
    id: createResultId(),
    finishedAt: new Date().toISOString(),
  };
  if (writeStored(resultsKey, RESULTS_SCHEMA_VERSION, pruneResults([next, ...current]))) {
    notifySyncChanged();
  }
  dispatchResultRecorded(next);
}

export function listGameResults(gameId?: string): GameResult[] {
  const results = readStored(resultsKey, RESULTS_SCHEMA_VERSION, parseResults) ?? [];
  return gameId ? results.filter((result) => result.gameId === gameId) : results;
}

export function clearGameResults(gameId?: string): void {
  const written = !gameId
    ? writeStored(resultsKey, RESULTS_SCHEMA_VERSION, [])
    : writeStored(
        resultsKey,
        RESULTS_SCHEMA_VERSION,
        listGameResults().filter((result) => result.gameId !== gameId),
      );
  if (!written) return;
  recordResultsClearedForSync(gameId);
}

export function bestGameResult(
  gameId: string,
  metric: ResultMetric,
  direction: MetricDirection,
): GameResult | null {
  const results = listGameResults(gameId).filter((result) => typeof result[metric] === "number");
  if (results.length === 0) return null;
  return results.reduce((best, result) => {
    const bestValue = best[metric] as number;
    const resultValue = result[metric] as number;
    return direction === "max"
      ? resultValue > bestValue
        ? result
        : best
      : resultValue < bestValue
        ? result
        : best;
  });
}

function parseResults(value: unknown): GameResult[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(parseResult).filter((result): result is GameResult => result !== null);
}

function parseResult(value: unknown): GameResult | null {
  const base = parseWithSchema(resultBaseSchema, value);
  if (!base) return null;
  const result: GameResult = {
    id: base.id,
    runId: base.runId,
    gameId: base.gameId,
    finishedAt: base.finishedAt,
    outcome: base.outcome,
  };
  copyOptionalResultDetails(result, base as Partial<Record<keyof OptionalResultDetails, unknown>>);
  return result;
}

function sanitizeResult(
  result: Omit<GameResult, "id" | "finishedAt">,
): Omit<GameResult, "id" | "finishedAt"> {
  const next: Omit<GameResult, "id" | "finishedAt"> = {
    runId: result.runId,
    gameId: result.gameId,
    outcome: result.outcome,
  };
  copyOptionalResultDetails(next, result);
  return next;
}

function pruneResults(results: GameResult[]): GameResult[] {
  const sorted = [...results].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  const perGameCounts = new Map<string, number>();
  const pruned: GameResult[] = [];

  for (const result of sorted) {
    const gameCount = perGameCounts.get(result.gameId) ?? 0;
    if (gameCount >= maxResultsPerGame) continue;
    perGameCounts.set(result.gameId, gameCount + 1);
    pruned.push(result);
    if (pruned.length >= maxTotalResults) break;
  }

  return pruned;
}

function copyOptionalResultDetails(
  target: Partial<OptionalResultDetails>,
  source: { [Key in keyof OptionalResultDetails]?: unknown },
): void {
  const difficulty = parseDifficulty(source.difficulty);
  if (difficulty) target.difficulty = difficulty;
  for (const field of numericResultFields) {
    const value = parseWithSchema(finiteNumberSchema, source[field]);
    if (value !== null) target[field] = value;
  }
  const metadata = parseMetadata(source.metadata);
  if (metadata) target.metadata = metadata;
}

function parseMetadata(value: unknown): GameMetadata | undefined {
  const record = parseWithSchema(unknownRecordSchema, value);
  if (!record) return undefined;
  const metadata: GameMetadata = {};
  for (const [key, entry] of Object.entries(record)) {
    const parsed = parseWithSchema(primitiveValueSchema, entry);
    if (parsed !== null) metadata[key] = parsed;
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function createResultId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return `result-${crypto.randomUUID()}`;
  return `result-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function dispatchResultRecorded(result: GameResult): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent<GameResult>("games:result-recorded", { detail: result }));
}
