import { beforeEach, describe, expect, test } from "bun:test";
import { getBotStreak, recordBotStreakOutcome, resetBotStreak } from "@features/bot-streaks";

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

describe("bot streaks", () => {
  test("increments wins, preserves best, and resets current streak", () => {
    expect(getBotStreak("tictactoe", "Hard")).toEqual({ current: 0, best: 0 });
    expect(recordBotStreakOutcome("tictactoe", "Hard", "won")).toEqual({
      current: 1,
      best: 1,
    });
    expect(recordBotStreakOutcome("tictactoe", "Hard", "won")).toEqual({
      current: 2,
      best: 2,
    });
    expect(recordBotStreakOutcome("tictactoe", "Hard", "draw")).toEqual({
      current: 0,
      best: 2,
    });
    expect(recordBotStreakOutcome("tictactoe", "Hard", "won")).toEqual({
      current: 1,
      best: 2,
    });
    expect(resetBotStreak("tictactoe", "Hard")).toEqual({ current: 0, best: 2 });
  });

  test("tracks games and difficulties independently", () => {
    recordBotStreakOutcome("tictactoe", "Easy", "won");
    recordBotStreakOutcome("tictactoe", "Hard", "won");
    recordBotStreakOutcome("tictactoe", "Hard", "won");
    recordBotStreakOutcome("connect4", "Hard", "won");

    expect(getBotStreak("tictactoe", "Easy").current).toBe(1);
    expect(getBotStreak("tictactoe", "Hard").current).toBe(2);
    expect(getBotStreak("connect4", "Hard").current).toBe(1);
  });
});
