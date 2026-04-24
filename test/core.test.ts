import { describe, expect, test } from "bun:test";
import {
  moveGridIndex,
  moveGridPoint,
  nextDifficulty,
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

test("shuffleInPlace preserves items", () => {
  const items = [1, 2, 3, 4];
  expect(shuffleInPlace([...items]).sort()).toEqual(items);
});
