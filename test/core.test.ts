import { describe, expect, test } from "bun:test";
import {
  createDelayedAction,
  durationSince,
  isFiniteNumber,
  isIntegerInRange,
  moveGridIndex,
  moveGridPoint,
  nextDifficulty,
  parseStartedAt,
  previousDifficulty,
  shuffleInPlace,
} from "../src/core";

describe("difficulty cycling", () => {
  test("moves forward through difficulties and wraps", () => {
    expect(nextDifficulty("Easy")).toBe("Medium");
    expect(nextDifficulty("Medium")).toBe("Hard");
    expect(nextDifficulty("Hard")).toBe("Easy");
  });

  test("moves backward through difficulties and wraps", () => {
    expect(previousDifficulty("Hard")).toBe("Medium");
    expect(previousDifficulty("Medium")).toBe("Easy");
    expect(previousDifficulty("Easy")).toBe("Hard");
  });
});

describe("grid movement", () => {
  test("moves flat grid index without leaving board", () => {
    expect(moveGridIndex(4, "up", 3, 9)).toBe(1);
    expect(moveGridIndex(4, "right", 3, 9)).toBe(5);
    expect(moveGridIndex(4, "down", 3, 9)).toBe(7);
    expect(moveGridIndex(4, "left", 3, 9)).toBe(3);
    expect(moveGridIndex(0, "up", 3, 9)).toBe(0);
    expect(moveGridIndex(8, "down", 3, 9)).toBe(8);
  });

  test("moves grid point without leaving board", () => {
    expect(moveGridPoint({ row: 1, column: 1 }, "up", 3, 3)).toEqual({ row: 0, column: 1 });
    expect(moveGridPoint({ row: 1, column: 1 }, "right", 3, 3)).toEqual({ row: 1, column: 2 });
    expect(moveGridPoint({ row: 1, column: 1 }, "down", 3, 3)).toEqual({ row: 2, column: 1 });
    expect(moveGridPoint({ row: 1, column: 1 }, "left", 3, 3)).toEqual({ row: 1, column: 0 });
    expect(moveGridPoint({ row: 0, column: 0 }, "up", 3, 3)).toEqual({ row: 0, column: 0 });
    expect(moveGridPoint({ row: 2, column: 2 }, "right", 3, 3)).toEqual({ row: 2, column: 2 });
  });
});

describe("shared guards and clocks", () => {
  test("recognizes finite numbers and board indexes", () => {
    expect(isFiniteNumber(4)).toBe(true);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isIntegerInRange(2, 3)).toBe(true);
    expect(isIntegerInRange(3, 3)).toBe(false);
    expect(isIntegerInRange(1.5, 3)).toBe(false);
  });

  test("parses nullable start times and elapsed durations", () => {
    expect(parseStartedAt(null)).toBeNull();
    expect(parseStartedAt(100)).toBe(100);
    expect(parseStartedAt(Number.NaN)).toBeUndefined();
    expect(durationSince(null, 150)).toBeUndefined();
    expect(durationSince(100, 150)).toBe(50);
    expect(durationSince(200, 150)).toBe(0);
  });
});

test("shuffleInPlace preserves items", () => {
  const items = [1, 2, 3, 4];
  expect(shuffleInPlace([...items]).sort()).toEqual(items);
});

test("delayed actions can be rescheduled and cleared", async () => {
  let value = 0;
  const action = createDelayedAction();

  action.start(() => {
    value = 1;
  }, 20);
  action.start(() => {
    value = 2;
  }, 20);
  expect(action.pending).toBe(true);

  await sleep(40);
  expect(value).toBe(2);
  expect(action.pending).toBe(false);

  action.start(() => {
    value = 3;
  }, 20);
  action.clear();
  expect(action.pending).toBe(false);

  await sleep(40);
  expect(value).toBe(2);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
