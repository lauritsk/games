import { buildLocalSyncSnapshot, mergeRemoteSyncSnapshot } from "./sync-local";
import { emptySyncSnapshot, parseSyncSnapshot } from "./sync-schema";
import type { SyncPush } from "./sync-types";
import { readStored, storageKey, writeStored } from "./storage";

const DEVICE_SCHEMA_VERSION = 1;
const deviceKey = storageKey("sync", "device");
const syncDelayMs = 1500;
const retryDelayMs = 15_000;
const requestTimeoutMs = 8_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let pending = false;
let disabled = false;

export function initializeSync(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("games:sync-requested", () => scheduleSync());
  window.addEventListener("games:result-recorded", () => scheduleSync());
  window.addEventListener("games:sync-merged", () => scheduleSync(5_000));
  window.addEventListener("online", () => scheduleSync(100));
  window.addEventListener("pagehide", () => {
    void syncNow({ keepalive: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void syncNow({ keepalive: true });
    else scheduleSync(100);
  });

  scheduleSync(500);
}

export function scheduleSync(delayMs = syncDelayMs): void {
  if (disabled || typeof window === "undefined") return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
}

async function syncNow(options: { keepalive?: boolean } = {}): Promise<void> {
  if (disabled || typeof fetch === "undefined") return;
  if (inFlight) {
    pending = true;
    return;
  }
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  inFlight = true;
  pending = false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const push: SyncPush = {
      deviceId: getDeviceId(),
      ...buildLocalSyncSnapshot(),
    };
    const body = JSON.stringify(push);
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
      keepalive: options.keepalive === true && body.length < 60_000,
      signal: controller.signal,
    });

    if (response.status === 404 || response.status === 405) {
      disabled = true;
      return;
    }
    if (!response.ok) {
      scheduleSync(retryDelayMs);
      return;
    }

    const value = (await response.json()) as unknown;
    const snapshot = parseSyncResponse(value);
    if (snapshot) mergeRemoteSyncSnapshot(snapshot);
  } catch {
    if (!options.keepalive) scheduleSync(retryDelayMs);
  } finally {
    clearTimeout(timeout);
    inFlight = false;
    if (pending) scheduleSync(100);
  }
}

function parseSyncResponse(value: unknown) {
  if (value && typeof value === "object" && "snapshot" in value) {
    return parseSyncSnapshot((value as { snapshot: unknown }).snapshot);
  }
  return parseSyncSnapshot(value) ?? emptySyncSnapshot();
}

export function getDeviceId(): string {
  const stored = readStored(deviceKey, DEVICE_SCHEMA_VERSION, (value) =>
    typeof value === "string" ? value : null,
  );
  if (stored) return stored;
  const next = createDeviceId();
  writeStored(deviceKey, DEVICE_SCHEMA_VERSION, next);
  return next;
}

function createDeviceId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
