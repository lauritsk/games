import { describe, expect, test } from "bun:test";
import { createSyncApiHandler } from "../src/server/api";
import { GameDatabase } from "../src/server/db";
import { parseLeaderboardSubmission } from "../src/server/leaderboard-schema";
import { normalizeUsername, usernameError, validateUsername } from "../src/server/username";

function validSubmission(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: "device-test",
    runId: "run-test",
    gameId: "tetris",
    username: "KARL",
    difficulty: "Hard",
    outcome: "lost",
    score: 12000,
    level: 7,
    metadata: { lines: 62 },
    ...overrides,
  };
}

describe("leaderboard usernames", () => {
  test("normalizes allowed display names", () => {
    expect(normalizeUsername("  ＫＡＲＬ   42  ")).toBe("KARL 42");
    expect(validateUsername("AAA")).toEqual({
      ok: true,
      username: "AAA",
      normalizedUsername: "aaa",
    });
  });

  test("rejects reserved, URL, control, and offensive names with generic error", () => {
    for (const name of ["admin", "www.bad.test", "ab\ncd", "shit"]) {
      expect(validateUsername(name)).toEqual({ ok: false, error: usernameError });
    }
  });

  test("allows repeated usernames by validation", () => {
    expect(validateUsername("PLAYER").ok).toBe(true);
    expect(validateUsername("PLAYER").ok).toBe(true);
  });
});

describe("leaderboard submission parsing", () => {
  test("accepts a valid score payload", () => {
    const parsed = parseLeaderboardSubmission(validSubmission());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.metric).toBe("score");
      expect(parsed.value.metricValue).toBe(12000);
      expect(parsed.value.metadata).toEqual({ lines: 62 });
    }
  });

  test("accepts Minesweeper wins as fastest-time payloads", () => {
    const parsed = parseLeaderboardSubmission(
      validSubmission({
        gameId: "minesweeper",
        outcome: "won",
        score: undefined,
        durationMs: 61_000,
        metadata: { flags: 10, revealed: 71 },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.metric).toBe("durationMs");
      expect(parsed.value.metricValue).toBe(61_000);
      expect(parsed.value.durationMs).toBe(61_000);
      expect(parsed.value.metadata).toEqual({ flags: 10, revealed: 71 });
    }
  });

  test("accepts Memory completions as fastest-time payloads", () => {
    const parsed = parseLeaderboardSubmission(
      validSubmission({
        gameId: "memory",
        outcome: "completed",
        score: undefined,
        moves: 18,
        durationMs: 42_000,
        level: undefined,
        metadata: {},
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.metric).toBe("durationMs");
      expect(parsed.value.metricValue).toBe(42_000);
      expect(parsed.value.durationMs).toBe(42_000);
      expect(parsed.value.moves).toBe(18);
    }
  });

  test("accepts bot win streak payloads and rejects local streaks", () => {
    const parsed = parseLeaderboardSubmission(
      validSubmission({
        gameId: "tictactoe",
        outcome: "won",
        score: undefined,
        level: undefined,
        moves: 5,
        streak: 4,
        metadata: { mode: "bot", winner: "X" },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.metric).toBe("streak");
      expect(parsed.value.metricValue).toBe(4);
      expect(parsed.value.streak).toBe(4);
    }

    expect(
      parseLeaderboardSubmission(
        validSubmission({
          gameId: "connect4",
          outcome: "won",
          score: undefined,
          level: undefined,
          streak: 3,
          metadata: { mode: "local" },
        }),
      ).ok,
    ).toBe(false);
  });

  test("rejects bad usernames and impossible values", () => {
    expect(parseLeaderboardSubmission(validSubmission({ username: "root" }))).toEqual({
      ok: false,
      error: usernameError,
    });
    expect(parseLeaderboardSubmission(validSubmission({ score: 1.5 })).ok).toBe(false);
    expect(parseLeaderboardSubmission(validSubmission({ score: 999_999_999 })).ok).toBe(false);
    expect(
      parseLeaderboardSubmission(
        validSubmission({ gameId: "minesweeper", outcome: "lost", durationMs: 1_000 }),
      ).ok,
    ).toBe(false);
    expect(
      parseLeaderboardSubmission(
        validSubmission({ gameId: "memory", outcome: "won", durationMs: 1_000 }),
      ).ok,
    ).toBe(false);
  });
});

describe("leaderboard API", () => {
  test("posts scores and returns top entries", async () => {
    const db = new GameDatabase(":memory:");
    const handler = createSyncApiHandler(db);
    const post = await handler(
      new Request("http://local/api/leaderboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validSubmission({ deviceId: "device-api", runId: "run-api" })),
      }),
    );
    expect(post?.status).toBe(200);
    const postBody = (await post?.json()) as { ok: boolean; rank?: number };
    expect(postBody).toMatchObject({ ok: true, rank: 1 });

    const get = await handler(new Request("http://local/api/leaderboard?gameId=tetris&limit=10"));
    expect(get?.status).toBe(200);
    const getBody = (await get?.json()) as { ok: boolean; entries?: unknown[] };
    expect(getBody.ok).toBe(true);
    expect(getBody.entries).toHaveLength(1);
    db.close();
  });

  test("invalid score payloads return 400", async () => {
    const db = new GameDatabase(":memory:");
    const handler = createSyncApiHandler(db);
    const response = await handler(
      new Request("http://local/api/leaderboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validSubmission({ username: "admin" })),
      }),
    );
    expect(response?.status).toBe(400);
    const body = (await response?.json()) as { ok: boolean; error?: string };
    expect(body).toEqual({ ok: false, error: usernameError });
    db.close();
  });

  test("duplicate leaderboard submissions return the original entry", async () => {
    const db = new GameDatabase(":memory:");
    const handler = createSyncApiHandler(db);
    const first = await handler(
      new Request("http://local/api/leaderboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validSubmission({ deviceId: "device-dupe", runId: "run-dupe" })),
      }),
    );
    const duplicate = await handler(
      new Request("http://local/api/leaderboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          validSubmission({
            deviceId: "device-dupe",
            runId: "run-dupe",
            username: "DIFF",
            score: 999_000,
          }),
        ),
      }),
    );

    expect(first?.status).toBe(200);
    expect(duplicate?.status).toBe(200);
    const firstBody = (await first?.json()) as { entry?: { id: string; username: string } };
    const duplicateBody = (await duplicate?.json()) as { entry?: { id: string; username: string } };
    expect(duplicateBody.entry?.id).toBe(firstBody.entry?.id);
    expect(duplicateBody.entry?.username).toBe("KARL");
    db.close();
  });
});

describe("leaderboard database", () => {
  test("inserts, ranks, and lists top scores", () => {
    const db = new GameDatabase(":memory:");
    const first = db.submitLeaderboardScore(
      {
        deviceId: "device-1",
        runId: "run-1",
        gameId: "tetris",
        username: "AAA",
        normalizedUsername: "aaa",
        difficulty: "Hard",
        outcome: "lost",
        metric: "score",
        metricValue: 100,
        score: 100,
        metadata: {},
        createdAt: "2026-04-25T00:00:00.000Z",
      },
      "max",
    );
    const second = db.submitLeaderboardScore(
      {
        deviceId: "device-2",
        runId: "run-2",
        gameId: "tetris",
        username: "AAA",
        normalizedUsername: "aaa",
        difficulty: "Hard",
        outcome: "lost",
        metric: "score",
        metricValue: 200,
        score: 200,
        metadata: {},
        createdAt: "2026-04-25T00:01:00.000Z",
      },
      "max",
    );

    expect(first.rank).toBe(1);
    expect(second.rank).toBe(1);
    const list = db.listLeaderboardScores({
      gameId: "tetris",
      metric: "score",
      direction: "max",
      difficulty: "Hard",
      limit: 10,
    });
    expect(list.map((entry) => entry.score)).toEqual([200, 100]);
    expect(list.map((entry) => entry.rank)).toEqual([1, 2]);
    db.close();
  });

  test("ranks Memory fastest times with lower values first", () => {
    const db = new GameDatabase(":memory:");
    db.submitLeaderboardScore(
      {
        deviceId: "device-slow",
        runId: "run-slow",
        gameId: "memory",
        username: "SLO",
        normalizedUsername: "slo",
        difficulty: "Medium",
        outcome: "completed",
        metric: "durationMs",
        metricValue: 90_000,
        moves: 24,
        durationMs: 90_000,
        metadata: {},
        createdAt: "2026-04-25T00:00:00.000Z",
      },
      "min",
    );
    const fast = db.submitLeaderboardScore(
      {
        deviceId: "device-fast",
        runId: "run-fast",
        gameId: "memory",
        username: "FST",
        normalizedUsername: "fst",
        difficulty: "Medium",
        outcome: "completed",
        metric: "durationMs",
        metricValue: 45_000,
        moves: 18,
        durationMs: 45_000,
        metadata: {},
        createdAt: "2026-04-25T00:01:00.000Z",
      },
      "min",
    );

    expect(fast.rank).toBe(1);
    const list = db.listLeaderboardScores({
      gameId: "memory",
      metric: "durationMs",
      direction: "min",
      difficulty: "Medium",
      limit: 10,
    });
    expect(list.map((entry) => entry.durationMs)).toEqual([45_000, 90_000]);
    expect(list.map((entry) => entry.moves)).toEqual([18, 24]);
    expect(list.map((entry) => entry.rank)).toEqual([1, 2]);
    db.close();
  });

  test("ranks bot win streaks with higher values first", () => {
    const db = new GameDatabase(":memory:");
    db.submitLeaderboardScore(
      {
        deviceId: "device-short",
        runId: "run-short",
        gameId: "connect4",
        username: "AAA",
        normalizedUsername: "aaa",
        difficulty: "Hard",
        outcome: "won",
        metric: "streak",
        metricValue: 2,
        streak: 2,
        metadata: { mode: "bot" },
        createdAt: "2026-04-25T00:00:00.000Z",
      },
      "max",
    );
    const long = db.submitLeaderboardScore(
      {
        deviceId: "device-long",
        runId: "run-long",
        gameId: "connect4",
        username: "BBB",
        normalizedUsername: "bbb",
        difficulty: "Hard",
        outcome: "won",
        metric: "streak",
        metricValue: 5,
        streak: 5,
        metadata: { mode: "bot" },
        createdAt: "2026-04-25T00:01:00.000Z",
      },
      "max",
    );

    expect(long.rank).toBe(1);
    const list = db.listLeaderboardScores({
      gameId: "connect4",
      metric: "streak",
      direction: "max",
      difficulty: "Hard",
      limit: 10,
    });
    expect(list.map((entry) => entry.streak)).toEqual([5, 2]);
    expect(list.map((entry) => entry.rank)).toEqual([1, 2]);
    db.close();
  });

  test("duplicate device/run returns existing entry", () => {
    const db = new GameDatabase(":memory:");
    const first = db.submitLeaderboardScore(
      {
        deviceId: "device-1",
        runId: "run-1",
        gameId: "snake",
        username: "AAA",
        normalizedUsername: "aaa",
        outcome: "lost",
        metric: "score",
        metricValue: 10,
        score: 10,
        metadata: {},
      },
      "max",
    );
    const duplicate = db.submitLeaderboardScore(
      {
        deviceId: "device-1",
        runId: "run-1",
        gameId: "snake",
        username: "BBB",
        normalizedUsername: "bbb",
        outcome: "lost",
        metric: "score",
        metricValue: 999,
        score: 999,
        metadata: {},
      },
      "max",
    );

    expect(duplicate.id).toBe(first.id);
    expect(duplicate.username).toBe("AAA");
    expect(
      db.listLeaderboardScores({ gameId: "snake", metric: "score", direction: "max", limit: 10 }),
    ).toHaveLength(1);
    db.close();
  });
});
