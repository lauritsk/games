import { beforeEach, describe, expect, test } from "bun:test";
import { GameDatabase } from "../src/server/db";
import { buildLocalSyncSnapshot, mergeRemoteSyncSnapshot } from "../src/sync-local";
import { storageKey, writeStored } from "../src/storage";

class FakeStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new FakeStorage();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
});

describe("Bun SQLite sync", () => {
  test("stores preferences, saves, results, and tombstones", () => {
    const db = new GameDatabase(":memory:");
    const snapshot = db.applySync({
      deviceId: "device-test",
      preferences: [
        { gameId: "snake", updatedAt: "2026-04-25T00:00:00.000Z", data: { difficulty: "Hard" } },
      ],
      saves: [
        {
          gameId: "2048",
          updatedAt: "2026-04-25T00:00:01.000Z",
          data: { gameId: "2048", payloadVersion: 1, runId: "run-1", savedAt: "now" },
        },
      ],
      deletedSaves: [],
      results: [
        {
          id: "result-1",
          runId: "run-1",
          gameId: "2048",
          finishedAt: "2026-04-25T00:01:00.000Z",
          outcome: "lost",
          score: 128,
          streak: 2,
        },
      ],
      resultClears: [],
    });

    expect(snapshot.preferences).toHaveLength(1);
    expect(snapshot.saves).toHaveLength(1);
    expect(snapshot.results).toHaveLength(1);
    expect(snapshot.results[0]?.streak).toBe(2);

    const afterDelete = db.applySync({
      deviceId: "device-test",
      preferences: [],
      saves: [],
      deletedSaves: [{ gameId: "2048", deletedAt: "2026-04-25T00:02:00.000Z" }],
      results: [],
      resultClears: [],
    });

    expect(afterDelete.saves).toHaveLength(0);
    expect(afterDelete.deletedSaves).toEqual([
      { gameId: "2048", deletedAt: "2026-04-25T00:02:00.000Z" },
    ]);
    db.close();
  });

  test("result clears reject older results", () => {
    const db = new GameDatabase(":memory:");
    const snapshot = db.applySync({
      deviceId: "device-test",
      preferences: [],
      saves: [],
      deletedSaves: [],
      resultClears: [{ gameId: "tetris", clearedAt: "2026-04-25T00:02:00.000Z" }],
      results: [
        {
          id: "result-old",
          runId: "run-old",
          gameId: "tetris",
          finishedAt: "2026-04-25T00:01:00.000Z",
          outcome: "lost",
        },
        {
          id: "result-new",
          runId: "run-new",
          gameId: "tetris",
          finishedAt: "2026-04-25T00:03:00.000Z",
          outcome: "lost",
        },
      ],
    });

    expect(snapshot.results.map((result) => result.id)).toEqual(["result-new"]);
    db.close();
  });
});

describe("local sync snapshot", () => {
  test("reads and merges localStorage-backed sync data", () => {
    writeStored(storageKey("preferences"), 1, { snake: { difficulty: "Hard" } });
    writeStored(storageKey("saves", "snake"), 1, {
      gameId: "snake",
      payloadVersion: 1,
      runId: "run-snake",
      savedAt: "2026-04-25T00:00:00.000Z",
      status: "paused",
      payload: { score: 4 },
    });

    const snapshot = buildLocalSyncSnapshot();
    expect(snapshot.preferences).toHaveLength(1);
    expect(snapshot.saves).toHaveLength(1);

    expect(
      mergeRemoteSyncSnapshot({
        preferences: [
          {
            gameId: "tetris",
            updatedAt: "2099-01-01T00:00:00.000Z",
            data: { difficulty: "Easy" },
          },
        ],
        saves: [],
        deletedSaves: [],
        results: [
          {
            id: "result-remote",
            runId: "run-remote",
            gameId: "tetris",
            finishedAt: "2099-01-01T00:00:00.000Z",
            outcome: "lost",
            score: 10,
          },
        ],
        resultClears: [],
      }),
    ).toBe(true);

    const merged = buildLocalSyncSnapshot();
    expect(merged.preferences.map((preference) => preference.gameId).sort()).toEqual([
      "snake",
      "tetris",
    ]);
    expect(merged.results).toHaveLength(1);
  });
});
