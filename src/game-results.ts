import type { Difficulty } from "./types";
import { readStored, storageKey, writeStored } from "./storage";
import { parseDifficulty } from "./game-preferences";

export type GameOutcome = "won" | "lost" | "draw" | "completed";

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
  metadata?: Record<string, string | number | boolean>;
};

const RESULTS_SCHEMA_VERSION = 1;
const resultsKey = storageKey("results");
const outcomes = new Set<GameOutcome>(["won", "lost", "draw", "completed"]);
const maxTotalResults = 250;
const maxResultsPerGame = 50;

export function recordGameResult(result: Omit<GameResult, "id" | "finishedAt">): void {
  const current = listGameResults();
  if (current.some((item) => item.runId === result.runId)) return;
  const next: GameResult = {
    ...sanitizeResult(result),
    id: createResultId(),
    finishedAt: new Date().toISOString(),
  };
  writeStored(resultsKey, RESULTS_SCHEMA_VERSION, pruneResults([next, ...current]));
  dispatchResultRecorded(next);
}

export function listGameResults(gameId?: string): GameResult[] {
  const results = readStored(resultsKey, RESULTS_SCHEMA_VERSION, parseResults) ?? [];
  return gameId ? results.filter((result) => result.gameId === gameId) : results;
}

export function clearGameResults(gameId?: string): void {
  if (!gameId) {
    writeStored(resultsKey, RESULTS_SCHEMA_VERSION, []);
    return;
  }
  writeStored(
    resultsKey,
    RESULTS_SCHEMA_VERSION,
    listGameResults().filter((result) => result.gameId !== gameId),
  );
}

export function bestGameResult(
  gameId: string,
  metric: "score" | "moves" | "durationMs" | "level",
  direction: "max" | "min",
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
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.gameId !== "string" ||
    typeof value.finishedAt !== "string" ||
    !outcomes.has(value.outcome as GameOutcome)
  ) {
    return null;
  }

  const result: GameResult = {
    id: value.id,
    runId: value.runId,
    gameId: value.gameId,
    finishedAt: value.finishedAt,
    outcome: value.outcome as GameOutcome,
  };
  const difficulty = parseDifficulty(value.difficulty);
  if (difficulty) result.difficulty = difficulty;
  if (isFiniteNumber(value.durationMs)) result.durationMs = value.durationMs;
  if (isFiniteNumber(value.score)) result.score = value.score;
  if (isFiniteNumber(value.moves)) result.moves = value.moves;
  if (isFiniteNumber(value.level)) result.level = value.level;
  const metadata = parseMetadata(value.metadata);
  if (metadata) result.metadata = metadata;
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
  const difficulty = parseDifficulty(result.difficulty);
  if (difficulty) next.difficulty = difficulty;
  if (isFiniteNumber(result.durationMs)) next.durationMs = result.durationMs;
  if (isFiniteNumber(result.score)) next.score = result.score;
  if (isFiniteNumber(result.moves)) next.moves = result.moves;
  if (isFiniteNumber(result.level)) next.level = result.level;
  const metadata = parseMetadata(result.metadata);
  if (metadata) next.metadata = metadata;
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

function parseMetadata(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      metadata[key] = entry;
    }
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
