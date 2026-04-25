import { GameDatabase } from "@server/db";
import { leaderboardConfigForGame } from "@features/leaderboard/leaderboard-config";
import { emptySyncSnapshot, isSyncId, parseSyncPush } from "@features/sync/sync-schema";
import type { SyncSnapshot } from "@features/sync/sync-types";
import { parseLeaderboardQuery, parseLeaderboardSubmission } from "@server/leaderboard/schema";
import { json, readJson, requestBodyTooLarge, tooManyRequestsJson } from "@server/http";
import { checkRequestRateLimit } from "@server/rate-limit";

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
        if (requestBodyTooLarge(request, maxRequestBytes)) {
          return json({ ok: false, error: "Request too large" }, 413);
        }
        const body = await readJson(request);
        const push = parseSyncPush(body);
        if (!push) return json({ ok: false, error: "Invalid sync payload" }, 400);
        return json({ ok: true, snapshot: database.applySync(push) });
      }
      if (url.pathname.startsWith("/api/sync")) {
        return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "GET, POST" });
      }
      if (url.pathname === "/api/leaderboard" && request.method === "GET") {
        if (!checkRequestRateLimit(request, "leaderboard-read", { windowMs: 60_000, max: 60 })) {
          return tooManyRequestsJson();
        }
        const query = parseLeaderboardQuery(url);
        if (!query.ok) return json({ ok: false, error: query.error }, 400);
        const config = leaderboardConfigForGame(query.value.gameId);
        if (!config) return json({ ok: false, error: "Invalid leaderboard query" }, 400);
        const entries = database.listLeaderboardScores({
          ...query.value,
          metric: config.metric,
          direction: config.direction,
        });
        return json({ ok: true, entries });
      }
      if (url.pathname === "/api/leaderboard" && request.method === "POST") {
        if (requestBodyTooLarge(request, maxRequestBytes)) {
          return json({ ok: false, error: "Request too large" }, 413);
        }
        const body = await readJson(request);
        const submission = parseLeaderboardSubmission(body);
        const deviceId = submission.ok ? submission.value.deviceId : null;
        if (
          !checkRequestRateLimit(
            request,
            "leaderboard-write",
            { windowMs: 5 * 60_000, max: 10 },
            deviceId,
          )
        ) {
          return tooManyRequestsJson();
        }
        if (!submission.ok) return json({ ok: false, error: submission.error }, 400);
        const config = leaderboardConfigForGame(submission.value.gameId);
        if (!config) return json({ ok: false, error: "Invalid score" }, 400);
        const entry = database.submitLeaderboardScore(submission.value, config.direction);
        return json({ ok: true, rank: entry.rank, entry });
      }
      if (url.pathname.startsWith("/api/leaderboard")) {
        return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "GET, POST" });
      }
      return json({ ok: false, error: "Not found" }, 404);
    } catch {
      return json({ ok: false, error: "Request failed", snapshot: emptySyncSnapshot() }, 500);
    }
  };
}

export type { SyncSnapshot };
