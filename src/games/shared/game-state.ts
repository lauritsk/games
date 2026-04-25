import * as v from "valibot";
import type { MountScope } from "@shared/lifecycle";
import { readStored, removeStored, storageKey, writeStored } from "@shared/storage";
import {
  notifySyncChanged,
  recordSaveDeletedForSync,
  recordSaveWrittenForSync,
} from "@features/sync/sync-local";
import { integerSchema, parseWithSchema, picklistSchema } from "@shared/validation";

export type SaveStatus = "ready" | "playing" | "paused";

export type GameSave<T> = {
  gameId: string;
  payloadVersion: number;
  runId: string;
  savedAt: string;
  status: SaveStatus;
  payload: T;
};

const SAVE_SCHEMA_VERSION = 1;
const saveStatuses = ["ready", "playing", "paused"] as const satisfies readonly SaveStatus[];
const saveStatusSchema = picklistSchema(saveStatuses);
const gameSaveEnvelopeSchema = v.looseObject({
  gameId: v.string(),
  payloadVersion: integerSchema,
  runId: v.string(),
  savedAt: v.string(),
  status: saveStatusSchema,
  payload: v.unknown(),
});
const gameSaveIdentitySchema = v.looseObject({ gameId: v.string() });

export function loadGameSave<T>(
  gameId: string,
  payloadVersion: number,
  parse: (value: unknown) => T | null,
): GameSave<T> | null {
  return readStored(saveKey(gameId), SAVE_SCHEMA_VERSION, (value) =>
    parseGameSave(value, gameId, payloadVersion, parse),
  );
}

export function saveGameSave<T>(
  gameId: string,
  payloadVersion: number,
  save: Omit<GameSave<T>, "gameId" | "payloadVersion" | "savedAt">,
): void {
  if (
    writeStored(saveKey(gameId), SAVE_SCHEMA_VERSION, {
      gameId,
      payloadVersion,
      runId: save.runId,
      savedAt: new Date().toISOString(),
      status: save.status,
      payload: save.payload,
    } satisfies GameSave<T>)
  ) {
    recordSaveWrittenForSync(gameId);
    notifySyncChanged();
  }
}

export function clearGameSave(gameId: string): void {
  removeStored(saveKey(gameId));
  recordSaveDeletedForSync(gameId);
}

export function hasGameSave(gameId: string): boolean {
  return (
    readStored(saveKey(gameId), SAVE_SCHEMA_VERSION, (value) =>
      parseWithSchema(gameSaveIdentitySchema, value)?.gameId === gameId ? true : null,
    ) === true
  );
}

export function createAutosave(options: {
  gameId: string;
  intervalMs?: number;
  save(): void;
  scope: MountScope;
}): { request(): void; flush(): void } {
  const intervalMs = options.intervalMs ?? 750;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = (): void => {
    clearTimer();
    options.save();
  };

  const request = (): void => {
    if (timer !== null) return;
    timer = setTimeout(flush, intervalMs);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush, { signal: options.scope.signal });
  }
  if (typeof document !== "undefined") {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") flush();
      },
      { signal: options.scope.signal },
    );
  }
  options.scope.signal.addEventListener("abort", clearTimer, { once: true });

  return { request, flush };
}

export function createRunId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function saveKey(gameId: string): string {
  return storageKey("saves", gameId);
}

function parseGameSave<T>(
  value: unknown,
  gameId: string,
  payloadVersion: number,
  parse: (value: unknown) => T | null,
): GameSave<T> | null {
  const envelope = parseWithSchema(gameSaveEnvelopeSchema, value);
  if (!envelope) return null;
  if (envelope.gameId !== gameId || envelope.payloadVersion !== payloadVersion) return null;
  const payload = parse(envelope.payload);
  if (payload === null) return null;
  return {
    gameId,
    payloadVersion,
    runId: envelope.runId,
    savedAt: envelope.savedAt,
    status: envelope.status,
    payload,
  };
}
