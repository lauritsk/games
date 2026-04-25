import { takeGroupedItems } from "@shared/collections";
import {
  readStored,
  readStoredEnvelope,
  removeStored,
  storageKey,
  writeStored,
  writeStoredEnvelope,
} from "@shared/storage";
import { emptySyncSnapshot, parseSyncResult } from "@features/sync/sync-schema";
import * as v from "valibot";
import type {
  SyncResult,
  SyncResultClear,
  SyncSaveTombstone,
  SyncSnapshot,
} from "@features/sync/sync-types";
import { parseWithSchema, unknownRecordSchema } from "@shared/validation";

const timestampMapValueSchema = v.string();

const PREFERENCES_SCHEMA_VERSION = 1;
const SAVE_SCHEMA_VERSION = 1;
const RESULTS_SCHEMA_VERSION = 1;
const SYNC_STATE_SCHEMA_VERSION = 1;
const preferencesKey = storageKey("preferences");
const resultsKey = storageKey("results");
const syncStateKey = storageKey("sync", "state");
const saveKeyPrefix = `${storageKey("saves")}:`;
const allResultsClearKey = "*";
const maxTotalResults = 250;
const maxResultsPerGame = 50;

type SyncLocalState = {
  saveDeletes: Record<string, string>;
  resultClears: Record<string, string>;
};

export function buildLocalSyncSnapshot(): SyncSnapshot {
  const snapshot = emptySyncSnapshot();
  const preferences = readStoredEnvelope<Record<string, unknown>>(
    preferencesKey,
    PREFERENCES_SCHEMA_VERSION,
    parseRecordValue,
  );
  if (preferences) {
    for (const [gameId, data] of Object.entries(preferences.data)) {
      snapshot.preferences.push({ gameId, updatedAt: preferences.updatedAt, data });
    }
  }

  for (const key of localStorageKeys(saveKeyPrefix)) {
    const save = readStoredEnvelope<Record<string, unknown>>(
      key,
      SAVE_SCHEMA_VERSION,
      parseRecordValue,
    );
    if (!save) continue;
    const gameId =
      typeof save.data.gameId === "string" ? save.data.gameId : key.slice(saveKeyPrefix.length);
    snapshot.saves.push({ gameId, updatedAt: save.updatedAt, data: save.data });
  }

  const results = readStoredEnvelope<SyncResult[]>(
    resultsKey,
    RESULTS_SCHEMA_VERSION,
    parseResults,
  );
  if (results) snapshot.results.push(...results.data);

  const state = loadSyncLocalState();
  for (const [gameId, deletedAt] of Object.entries(state.saveDeletes)) {
    snapshot.deletedSaves.push({ gameId, deletedAt });
  }
  for (const [gameKey, clearedAt] of Object.entries(state.resultClears)) {
    snapshot.resultClears.push(
      gameKey === allResultsClearKey ? { clearedAt } : { gameId: gameKey, clearedAt },
    );
  }

  return snapshot;
}

export function mergeRemoteSyncSnapshot(snapshot: SyncSnapshot): boolean {
  let changed = false;

  changed = mergePreferences(snapshot) || changed;
  changed = mergeSaveDeletes(snapshot.deletedSaves) || changed;
  changed = mergeSaves(snapshot) || changed;
  changed = mergeResultClears(snapshot.resultClears) || changed;
  changed = mergeResults(snapshot.results) || changed;

  if (changed) notifySyncMerged();
  return changed;
}

export function recordSaveDeletedForSync(
  gameId: string,
  deletedAt = new Date().toISOString(),
): void {
  const state = loadSyncLocalState();
  const current = state.saveDeletes[gameId];
  if (!current || deletedAt > current) state.saveDeletes[gameId] = deletedAt;
  saveSyncLocalState(state);
  notifySyncChanged();
}

export function recordSaveWrittenForSync(gameId: string): void {
  const state = loadSyncLocalState();
  if (!(gameId in state.saveDeletes)) return;
  delete state.saveDeletes[gameId];
  saveSyncLocalState(state);
}

export function recordResultsClearedForSync(
  gameId?: string,
  clearedAt = new Date().toISOString(),
): void {
  const state = loadSyncLocalState();
  const key = gameId ?? allResultsClearKey;
  const current = state.resultClears[key];
  if (!current || clearedAt > current) state.resultClears[key] = clearedAt;
  saveSyncLocalState(state);
  notifySyncChanged();
}

export function notifySyncChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("games:sync-requested"));
}

function mergePreferences(snapshot: SyncSnapshot): boolean {
  if (snapshot.preferences.length === 0) return false;
  const envelope = readStoredEnvelope<Record<string, unknown>>(
    preferencesKey,
    PREFERENCES_SCHEMA_VERSION,
    parseRecordValue,
  );
  const data = envelope ? { ...envelope.data } : {};
  const localUpdatedAt = envelope?.updatedAt ?? "";
  let changed = false;

  for (const preference of snapshot.preferences) {
    if (preference.gameId in data && preference.updatedAt <= localUpdatedAt) continue;
    data[preference.gameId] = preference.data;
    changed = true;
  }

  if (changed) writeStored(preferencesKey, PREFERENCES_SCHEMA_VERSION, data);
  return changed;
}

function mergeSaves(snapshot: SyncSnapshot): boolean {
  let changed = false;
  const state = loadSyncLocalState();

  for (const save of snapshot.saves) {
    const tombstone = state.saveDeletes[save.gameId];
    if (tombstone && tombstone >= save.updatedAt) continue;
    const key = storageKey("saves", save.gameId);
    const local = readStoredEnvelope<unknown>(key, SAVE_SCHEMA_VERSION, parseAnyValue);
    if (local && local.updatedAt >= save.updatedAt) continue;
    changed =
      writeStoredEnvelope(key, {
        schemaVersion: SAVE_SCHEMA_VERSION,
        updatedAt: save.updatedAt,
        data: save.data,
      }) || changed;
  }

  return changed;
}

function mergeSaveDeletes(deletedSaves: SyncSaveTombstone[]): boolean {
  if (deletedSaves.length === 0) return false;
  const state = loadSyncLocalState();
  let changed = false;

  for (const tombstone of deletedSaves) {
    const current = state.saveDeletes[tombstone.gameId];
    if (!current || tombstone.deletedAt > current) {
      state.saveDeletes[tombstone.gameId] = tombstone.deletedAt;
      changed = true;
    }
    const key = storageKey("saves", tombstone.gameId);
    const local = readStoredEnvelope<unknown>(key, SAVE_SCHEMA_VERSION, parseAnyValue);
    if (!local || local.updatedAt > tombstone.deletedAt) continue;
    removeStored(key);
    changed = true;
  }

  if (changed) saveSyncLocalState(state);
  return changed;
}

function mergeResultClears(clears: SyncResultClear[]): boolean {
  if (clears.length === 0) return false;
  const state = loadSyncLocalState();
  let stateChanged = false;
  let resultsChanged = false;
  let results = loadResults();

  for (const clear of clears) {
    const key = clear.gameId ?? allResultsClearKey;
    const current = state.resultClears[key];
    if (!current || clear.clearedAt > current) {
      state.resultClears[key] = clear.clearedAt;
      stateChanged = true;
    }
    const next = results.filter((result) => !resultMatchesClear(result, clear));
    if (next.length !== results.length) {
      results = next;
      resultsChanged = true;
    }
  }

  if (stateChanged) saveSyncLocalState(state);
  if (resultsChanged) saveResults(results);
  return stateChanged || resultsChanged;
}

function mergeResults(remoteResults: SyncResult[]): boolean {
  if (remoteResults.length === 0) return false;
  const state = loadSyncLocalState();
  const results = loadResults();
  const runIds = new Set(results.map((result) => result.runId));
  let changed = false;

  for (const result of remoteResults) {
    if (runIds.has(result.runId) || isResultLocallyCleared(result, state)) continue;
    results.push(result);
    runIds.add(result.runId);
    changed = true;
  }

  if (changed) saveResults(pruneResults(results));
  return changed;
}

function resultMatchesClear(result: SyncResult, clear: SyncResultClear): boolean {
  return (
    (clear.gameId === undefined || clear.gameId === result.gameId) &&
    result.finishedAt <= clear.clearedAt
  );
}

function isResultLocallyCleared(result: SyncResult, state: SyncLocalState): boolean {
  const globalClear = state.resultClears[allResultsClearKey];
  const gameClear = state.resultClears[result.gameId];
  return Boolean(
    (globalClear && result.finishedAt <= globalClear) ||
    (gameClear && result.finishedAt <= gameClear),
  );
}

function loadResults(): SyncResult[] {
  return readStored(resultsKey, RESULTS_SCHEMA_VERSION, parseResults) ?? [];
}

function saveResults(results: SyncResult[]): void {
  writeStored(resultsKey, RESULTS_SCHEMA_VERSION, pruneResults(results));
}

function pruneResults(results: SyncResult[]): SyncResult[] {
  const sorted = [...results].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  return takeGroupedItems(sorted, {
    maxTotal: maxTotalResults,
    maxPerGroup: maxResultsPerGame,
    groupKey: (result) => result.gameId,
  });
}

function parseResults(value: unknown): SyncResult[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(parseSyncResult).filter((result): result is SyncResult => result !== null);
}

function loadSyncLocalState(): SyncLocalState {
  return (
    readStored(syncStateKey, SYNC_STATE_SCHEMA_VERSION, parseSyncLocalState) ?? {
      saveDeletes: {},
      resultClears: {},
    }
  );
}

function saveSyncLocalState(state: SyncLocalState): void {
  writeStored(syncStateKey, SYNC_STATE_SCHEMA_VERSION, {
    saveDeletes: state.saveDeletes,
    resultClears: state.resultClears,
  });
}

function parseSyncLocalState(value: unknown): SyncLocalState | null {
  const record = parseWithSchema(unknownRecordSchema, value);
  if (!record) return null;
  return {
    saveDeletes: parseTimestampMap(record.saveDeletes),
    resultClears: parseTimestampMap(record.resultClears),
  };
}

function parseTimestampMap(value: unknown): Record<string, string> {
  const record = parseWithSchema(unknownRecordSchema, value);
  if (!record) return {};
  const map: Record<string, string> = {};
  for (const [key, timestamp] of Object.entries(record)) {
    const parsed = parseWithSchema(timestampMapValueSchema, timestamp);
    if (parsed !== null) map[key] = parsed;
  }
  return map;
}

function parseRecordValue(value: unknown): Record<string, unknown> | null {
  return parseWithSchema(unknownRecordSchema, value);
}

function parseAnyValue<T>(value: T): T {
  return value;
}

function localStorageKeys(prefix: string): string[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function notifySyncMerged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("games:sync-merged"));
}
