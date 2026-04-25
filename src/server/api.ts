import { GameDatabase } from "./db";
import { emptySyncSnapshot, isSyncId, parseSyncPush } from "../sync-schema";
import type { SyncSnapshot } from "../sync-types";

const maxRequestBytes = 1_000_000;

export type SyncApiHandler = (request: Request) => Promise<Response | null>;

export function createSyncApiHandler(database = new GameDatabase()): SyncApiHandler {
  return async function handleSyncApi(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return null;

    try {
      if (url.pathname === "/api/sync/status" && request.method === "GET") {
        return json({ ok: true, storage: "bun:sqlite" });
      }
      if (url.pathname === "/api/sync" && request.method === "GET") {
        const deviceId = url.searchParams.get("deviceId");
        if (!isSyncId(deviceId)) return json({ ok: false, error: "Invalid deviceId" }, 400);
        return json({ ok: true, snapshot: database.snapshot(deviceId) });
      }
      if (url.pathname === "/api/sync" && request.method === "POST") {
        const length = Number(request.headers.get("content-length") ?? "0");
        if (length > maxRequestBytes) return json({ ok: false, error: "Request too large" }, 413);
        const body = await readJson(request);
        const push = parseSyncPush(body);
        if (!push) return json({ ok: false, error: "Invalid sync payload" }, 400);
        return json({ ok: true, snapshot: database.applySync(push) });
      }
      if (url.pathname.startsWith("/api/sync")) {
        return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "GET, POST" });
      }
      return json({ ok: false, error: "Not found" }, 404);
    } catch {
      return json({ ok: false, error: "Sync failed", snapshot: emptySyncSnapshot() }, 500);
    }
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export type { SyncSnapshot };
