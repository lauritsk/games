import { describe, expect, test } from "bun:test";
import {
  circleIntersectsRect,
  clamp,
  pointInRect,
  rectsOverlap,
  vectorAdd,
  vectorScale,
  wrap,
} from "../src/arcade";

describe("arcade helpers", () => {
  test("checks rectangle and circle collisions", () => {
    expect(
      rectsOverlap({ x: 0, y: 0, width: 4, height: 4 }, { x: 3, y: 3, width: 4, height: 4 }),
    ).toBe(true);
    expect(
      rectsOverlap({ x: 0, y: 0, width: 2, height: 2 }, { x: 2, y: 2, width: 2, height: 2 }),
    ).toBe(false);
    expect(
      circleIntersectsRect({ x: 5, y: 5, radius: 2 }, { x: 6, y: 6, width: 5, height: 5 }),
    ).toBe(true);
    expect(pointInRect(3, 3, { x: 1, y: 1, width: 2, height: 2 })).toBe(true);
  });

  test("clamps, wraps, and moves vectors", () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(wrap(-1, 0, 10)).toBe(9);
    expect(wrap(12, 0, 10)).toBe(2);
    expect(vectorAdd({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(vectorScale({ x: 3, y: -2 }, 2)).toEqual({ x: 6, y: -4 });
  });
});
