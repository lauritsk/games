import { isRecord } from "./validation";

export type StoredEnvelope<T> = {
  schemaVersion: number;
  updatedAt: string;
  data: T;
};

export type StoredParser<T> = (value: unknown) => T | null;

const STORAGE_NAMESPACE = "games:v1";

export function storageKey(...parts: string[]): string {
  return [STORAGE_NAMESPACE, ...parts].join(":");
}

export function readStored<T>(
  key: string,
  schemaVersion: number,
  parse: StoredParser<T>,
): T | null {
  return readStoredEnvelope(key, schemaVersion, parse)?.data ?? null;
}

export function readStoredEnvelope<T>(
  key: string,
  schemaVersion: number,
  parse: StoredParser<T>,
): StoredEnvelope<T> | null {
  const storage = getLocalStorage();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const envelope = JSON.parse(raw) as Partial<StoredEnvelope<unknown>>;
    if (!isRecord(envelope) || envelope.schemaVersion !== schemaVersion) return null;
    if (typeof envelope.updatedAt !== "string" || !("data" in envelope)) return null;
    const data = parse(envelope.data);
    if (data === null) return null;
    return { schemaVersion, updatedAt: envelope.updatedAt, data };
  } catch {
    removeStored(key);
    return null;
  }
}

export function writeStored<T>(key: string, schemaVersion: number, data: T): boolean {
  return writeStoredEnvelope(key, {
    schemaVersion,
    updatedAt: new Date().toISOString(),
    data,
  });
}

export function writeStoredEnvelope<T>(key: string, envelope: StoredEnvelope<T>): boolean {
  const storage = getLocalStorage();
  if (!storage) return false;

  try {
    storage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function removeStored(key: string): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore unavailable or throwing storage.
  }
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
