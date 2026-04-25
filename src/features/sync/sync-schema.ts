import { parseDifficulty } from "@games/shared/game-preferences";
import type {
  SyncPreference,
  SyncPush,
  SyncResult,
  SyncResultClear,
  SyncSave,
  SyncSaveTombstone,
  SyncSnapshot,
} from "@features/sync/sync-types";
import { isFiniteNumber, isRecord } from "@shared/validation";

const syncIdPattern = /^[A-Za-z0-9._:-]+$/;
const outcomes = new Set(["won", "lost", "draw", "completed"]);
const numericFields = ["durationMs", "score", "moves", "level", "streak"] as const;

export function isSyncId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    syncIdPattern.test(value)
  );
}

export function parseSyncSnapshot(value: unknown): SyncSnapshot | null {
  if (!isRecord(value)) return null;
  return {
    preferences: parseArray(value.preferences, parseSyncPreference),
    saves: parseArray(value.saves, parseSyncSave),
    deletedSaves: parseArray(value.deletedSaves, parseSyncSaveTombstone),
    results: parseArray(value.results, parseSyncResult),
    resultClears: parseArray(value.resultClears, parseSyncResultClear),
  };
}

export function parseSyncPush(value: unknown): SyncPush | null {
  if (!isRecord(value) || !isSyncId(value.deviceId)) return null;
  const snapshot = parseSyncSnapshot(value);
  if (!snapshot) return null;
  return { deviceId: value.deviceId, ...snapshot };
}

export function parseSyncPreference(value: unknown): SyncPreference | null {
  if (!isRecord(value) || !isSyncId(value.gameId) || !isTimestamp(value.updatedAt)) return null;
  if (!("data" in value)) return null;
  return { gameId: value.gameId, updatedAt: value.updatedAt, data: value.data };
}

export function parseSyncSave(value: unknown): SyncSave | null {
  if (!isRecord(value) || !isSyncId(value.gameId) || !isTimestamp(value.updatedAt)) return null;
  if (!("data" in value)) return null;
  return { gameId: value.gameId, updatedAt: value.updatedAt, data: value.data };
}

export function parseSyncSaveTombstone(value: unknown): SyncSaveTombstone | null {
  if (!isRecord(value) || !isSyncId(value.gameId) || !isTimestamp(value.deletedAt)) return null;
  return { gameId: value.gameId, deletedAt: value.deletedAt };
}

export function parseSyncResultClear(value: unknown): SyncResultClear | null {
  if (!isRecord(value) || !isTimestamp(value.clearedAt)) return null;
  if (value.gameId !== undefined && !isSyncId(value.gameId)) return null;
  return typeof value.gameId === "string"
    ? { gameId: value.gameId, clearedAt: value.clearedAt }
    : { clearedAt: value.clearedAt };
}

export function parseSyncResult(value: unknown): SyncResult | null {
  if (
    !isRecord(value) ||
    !isSyncId(value.id) ||
    !isSyncId(value.runId) ||
    !isSyncId(value.gameId) ||
    !isTimestamp(value.finishedAt) ||
    typeof value.outcome !== "string" ||
    !outcomes.has(value.outcome)
  ) {
    return null;
  }

  const result: SyncResult = {
    id: value.id,
    runId: value.runId,
    gameId: value.gameId,
    finishedAt: value.finishedAt,
    outcome: value.outcome as SyncResult["outcome"],
  };
  const difficulty = parseDifficulty(value.difficulty);
  if (difficulty) result.difficulty = difficulty;
  for (const field of numericFields) {
    if (isFiniteNumber(value[field])) result[field] = value[field];
  }
  const metadata = parseMetadata(value.metadata);
  if (metadata) result.metadata = metadata;
  return result;
}

export function emptySyncSnapshot(): SyncSnapshot {
  return { preferences: [], saves: [], deletedSaves: [], results: [], resultClears: [] };
}

function parseArray<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(parse).filter((entry): entry is T => entry !== null);
}

function parseMetadata(value: unknown): SyncResult["metadata"] | undefined {
  if (!isRecord(value)) return undefined;
  const metadata: NonNullable<SyncResult["metadata"]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      metadata[key] = entry;
    }
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}
