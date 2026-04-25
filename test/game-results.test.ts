import { beforeEach, describe, expect, test } from "bun:test";
import {
  bestGameResult,
  clearGameResults,
  listGameResults,
  recordGameResult,
} from "../src/game-results";
import { storageKey } from "../src/storage";

class FakeStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

const storage = new FakeStorage();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
});

describe("game results", () => {
  test("records, lists, and filters results", () => {
    recordGameResult({ runId: "run-a", gameId: "2048", outcome: "lost", score: 100 });
    recordGameResult({ runId: "run-b", gameId: "memory", outcome: "completed", moves: 22 });

    expect(listGameResults()).toHaveLength(2);
    expect(listGameResults("2048")).toHaveLength(1);
    expect(listGameResults("2048")[0]?.score).toBe(100);
  });

  test("dedupes by runId", () => {
    recordGameResult({ runId: "same-run", gameId: "2048", outcome: "lost", score: 100 });
    recordGameResult({ runId: "same-run", gameId: "2048", outcome: "lost", score: 200 });

    expect(listGameResults("2048")).toHaveLength(1);
    expect(listGameResults("2048")[0]?.score).toBe(100);
  });

  test("finds best result by explicit metric direction", () => {
    recordGameResult({ runId: "run-a", gameId: "tetris", outcome: "lost", score: 100, level: 2 });
    recordGameResult({ runId: "run-b", gameId: "tetris", outcome: "lost", score: 300, level: 1 });

    recordGameResult({ runId: "run-c", gameId: "tictactoe", outcome: "won", streak: 4 });
    recordGameResult({ runId: "run-d", gameId: "tictactoe", outcome: "won", streak: 2 });

    expect(bestGameResult("tetris", "score", "max")?.score).toBe(300);
    expect(bestGameResult("tetris", "level", "min")?.level).toBe(1);
    expect(bestGameResult("tictactoe", "streak", "max")?.streak).toBe(4);
  });

  test("prunes to 50 results per game", () => {
    for (let index = 0; index < 55; index += 1) {
      recordGameResult({ runId: `run-${index}`, gameId: "snake", outcome: "lost", score: index });
    }

    expect(listGameResults("snake")).toHaveLength(50);
  });

  test("corrupt history is ignored", () => {
    storage.setItem(storageKey("results"), "{");
    expect(listGameResults()).toEqual([]);
  });

  test("clears all or one game's results", () => {
    recordGameResult({ runId: "run-a", gameId: "2048", outcome: "lost" });
    recordGameResult({ runId: "run-b", gameId: "memory", outcome: "completed" });
    clearGameResults("2048");
    expect(listGameResults("2048")).toEqual([]);
    expect(listGameResults()).toHaveLength(1);
    clearGameResults();
    expect(listGameResults()).toEqual([]);
  });
});
