import * as v from "valibot";
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
import {
  finiteNumberSchema,
  parseWithSchema,
  picklistSchema,
  primitiveValueSchema,
  unknownRecordSchema,
} from "@shared/validation";

const syncIdPattern = /^[A-Za-z0-9._:-]+$/;
const outcomes = ["won", "lost", "draw", "completed"] as const;
const numericFields = ["durationMs", "score", "moves", "level", "streak"] as const;

const syncIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(128), v.regex(syncIdPattern));
const timestampSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(64));
const outcomeSchema = picklistSchema(outcomes);
const syncMetadataValueSchema = primitiveValueSchema;
const syncPreferenceSchema = v.object({
  gameId: syncIdSchema,
  updatedAt: timestampSchema,
  data: v.unknown(),
});
const syncSaveSchema = v.object({
  gameId: syncIdSchema,
  updatedAt: timestampSchema,
  data: v.unknown(),
});
const syncSaveTombstoneSchema = v.object({
  gameId: syncIdSchema,
  deletedAt: timestampSchema,
});
const syncResultClearSchema = v.object({
  gameId: v.optional(syncIdSchema),
  clearedAt: timestampSchema,
});
const syncResultBaseSchema = v.looseObject({
  id: syncIdSchema,
  runId: syncIdSchema,
  gameId: syncIdSchema,
  finishedAt: timestampSchema,
  outcome: outcomeSchema,
});
const syncResultSchema = v.pipe(
  syncResultBaseSchema,
  v.transform((value): SyncResult => {
    const result: SyncResult = {
      id: value.id,
      runId: value.runId,
      gameId: value.gameId,
      finishedAt: value.finishedAt,
      outcome: value.outcome,
    };
    const difficulty = parseDifficulty(value.difficulty);
    if (difficulty) result.difficulty = difficulty;
    for (const field of numericFields) {
      const parsed = parseWithSchema(finiteNumberSchema, value[field]);
      if (parsed !== null) result[field] = parsed;
    }
    const metadata = parseMetadata(value.metadata);
    if (metadata) result.metadata = metadata;
    return result;
  }),
);
const syncPushBaseSchema = v.looseObject({ deviceId: syncIdSchema });
const syncSnapshotSchema = v.object({
  preferences: v.optional(filteredArraySchema(syncPreferenceSchema), []),
  saves: v.optional(filteredArraySchema(syncSaveSchema), []),
  deletedSaves: v.optional(filteredArraySchema(syncSaveTombstoneSchema), []),
  results: v.optional(filteredArraySchema(syncResultSchema), []),
  resultClears: v.optional(filteredArraySchema(syncResultClearSchema), []),
});

export function isSyncId(value: unknown): value is string {
  return v.is(syncIdSchema, value);
}

export function parseSyncSnapshot(value: unknown): SyncSnapshot | null {
  return parseWithSchema(syncSnapshotSchema, value);
}

export function parseSyncPush(value: unknown): SyncPush | null {
  const base = parseWithSchema(syncPushBaseSchema, value);
  if (!base) return null;
  const snapshot = parseSyncSnapshot(value);
  if (!snapshot) return null;
  return { deviceId: base.deviceId, ...snapshot };
}

export function parseSyncPreference(value: unknown): SyncPreference | null {
  return parseWithSchema(syncPreferenceSchema, value);
}

export function parseSyncSave(value: unknown): SyncSave | null {
  return parseWithSchema(syncSaveSchema, value);
}

export function parseSyncSaveTombstone(value: unknown): SyncSaveTombstone | null {
  return parseWithSchema(syncSaveTombstoneSchema, value);
}

export function parseSyncResultClear(value: unknown): SyncResultClear | null {
  return parseWithSchema(syncResultClearSchema, value);
}

export function parseSyncResult(value: unknown): SyncResult | null {
  return parseWithSchema(syncResultSchema, value);
}

export function emptySyncSnapshot(): SyncSnapshot {
  return { preferences: [], saves: [], deletedSaves: [], results: [], resultClears: [] };
}

function filteredArraySchema<const TSchema extends v.GenericSchema>(schema: TSchema) {
  return v.pipe(
    v.unknown(),
    v.transform((value): v.InferOutput<TSchema>[] => {
      if (!Array.isArray(value)) return [];
      const entries: v.InferOutput<TSchema>[] = [];
      for (const item of value) {
        const parsed = parseWithSchema(schema, item);
        if (parsed !== null) entries.push(parsed);
      }
      return entries;
    }),
  );
}

function parseMetadata(value: unknown): SyncResult["metadata"] | undefined {
  if (!v.is(unknownRecordSchema, value)) return undefined;
  const metadata: NonNullable<SyncResult["metadata"]> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseWithSchema(syncMetadataValueSchema, entry);
    if (parsed !== null) metadata[key] = parsed;
  }
  return Object.keys(metadata).length ? metadata : undefined;
}
