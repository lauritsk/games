import type { MountScope } from "./lifecycle";
import { readStored, removeStored, storageKey, writeStored } from "./storage";
import { isRecord } from "./validation";

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
const saveStatuses = new Set<SaveStatus>(["ready", "playing", "paused"]);

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
  writeStored(saveKey(gameId), SAVE_SCHEMA_VERSION, {
    gameId,
    payloadVersion,
    runId: save.runId,
    savedAt: new Date().toISOString(),
    status: save.status,
    payload: save.payload,
  } satisfies GameSave<T>);
}

export function clearGameSave(gameId: string): void {
  removeStored(saveKey(gameId));
}

export function hasGameSave(gameId: string): boolean {
  return (
    readStored(saveKey(gameId), SAVE_SCHEMA_VERSION, (value) =>
      isRecord(value) && value.gameId === gameId ? true : null,
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
  if (!isRecord(value)) return null;
  if (value.gameId !== gameId || value.payloadVersion !== payloadVersion) return null;
  if (typeof value.runId !== "string" || typeof value.savedAt !== "string") return null;
  if (!saveStatuses.has(value.status as SaveStatus)) return null;
  const payload = parse(value.payload);
  if (payload === null) return null;
  return {
    gameId,
    payloadVersion,
    runId: value.runId,
    savedAt: value.savedAt,
    status: value.status as SaveStatus,
    payload,
  };
}
