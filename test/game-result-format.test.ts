import { beforeEach, describe, expect, test } from "bun:test";
import {
  bestConfigForGame,
  bestSummaryText,
  formatDuration,
  formatOutcome,
  resultDetails,
} from "@features/results/game-result-format";
import { recordGameResult } from "@features/results/game-results";

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

describe("game result formatting", () => {
  test("formats durations, outcomes, and detail rows", () => {
    expect(formatDuration(-1)).toBe("0s");
    expect(formatDuration(61_000)).toBe("1m 1s");
    expect(formatOutcome("completed")).toBe("Completed");
    expect(
      resultDetails({
        id: "result-a",
        runId: "run-a",
        gameId: "tetris",
        finishedAt: "now",
        outcome: "lost",
        score: 40,
        moves: 12,
        level: 3,
        streak: 2,
        durationMs: 61_000,
        difficulty: "Hard",
        metadata: { mode: "bot" },
      }),
    ).toEqual(["Score 40", "12 moves", "Level 3", "Streak 2 wins", "1m 1s", "Hard", "Vs bot"]);
  });

  test("selects best-result metrics by game", () => {
    expect(bestConfigForGame("memory")).toEqual({
      metric: "moves",
      direction: "min",
      label: "moves",
    });
    expect(bestConfigForGame("minesweeper")).toEqual({
      metric: "durationMs",
      direction: "min",
      label: "time",
    });
    expect(bestConfigForGame("tictactoe")).toEqual({
      metric: "streak",
      direction: "max",
      label: "streak",
    });
    expect(bestConfigForGame("tetris")).toEqual({
      metric: "score",
      direction: "max",
      label: "score",
    });
  });

  test("summarizes best stored result", () => {
    recordGameResult({ runId: "run-a", gameId: "memory", outcome: "completed", moves: 18 });
    recordGameResult({ runId: "run-b", gameId: "memory", outcome: "completed", moves: 12 });
    recordGameResult({ runId: "run-c", gameId: "minesweeper", outcome: "won", durationMs: 91_000 });

    recordGameResult({ runId: "run-d", gameId: "tictactoe", outcome: "won", streak: 3 });

    expect(bestSummaryText("memory")).toBe("Best moves: 12");
    expect(bestSummaryText("minesweeper")).toBe("Best time: 1m 31s");
    expect(bestSummaryText("tictactoe")).toBe("Best streak: 3 wins");
    expect(bestSummaryText("unknown")).toBeNull();
  });
});
