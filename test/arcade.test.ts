import { describe, expect, test } from "bun:test";
import {
  circleIntersectsRect,
  clamp,
  createArcadeModeController,
  parseRect,
  pointInRect,
  rectsOverlap,
  vectorAdd,
  vectorScale,
  wrap,
} from "@games/shared/arcade";

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
    expect(parseRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(parseRect({ x: 1, y: 2, width: Number.NaN, height: 4 })).toBeNull();
  });

  test("clamps, wraps, and moves vectors", () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(wrap(-1, 0, 10)).toBe(9);
    expect(wrap(12, 0, 10)).toBe(2);
    expect(vectorAdd({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(vectorScale({ x: 3, y: -2 }, 2)).toEqual({ x: 6, y: -4 });
  });

  test("controls shared arcade start and pause modes", () => {
    type Mode = "ready" | "playing" | "paused" | "lost";
    let mode: Mode = "ready";
    const calls: string[] = [];
    const controller = createArcadeModeController<Mode>({
      getMode: () => mode,
      setMode: (next) => {
        mode = next;
      },
      blockedStart: ["lost"],
      blockedPause: ["lost"],
      ready: "ready",
      playing: "playing",
      paused: "paused",
      onBlockedStart: () => calls.push("blocked"),
      onFirstStart: () => calls.push("first"),
      onPlaying: () => calls.push("play"),
      onPause: () => calls.push("pause"),
      afterChange: () => calls.push(`render:${mode}`),
    });

    controller.start();
    expect(mode).toBe("playing");
    expect(calls).toEqual(["first", "play", "render:playing"]);

    controller.togglePause();
    expect(mode).toBe("paused");
    expect(calls.at(-2)).toBe("pause");
    expect(calls.at(-1)).toBe("render:paused");

    controller.togglePause();
    expect(mode).toBe("playing");
    expect(calls.at(-2)).toBe("play");
    expect(calls.at(-1)).toBe("render:playing");

    mode = "lost";
    controller.start();
    expect(mode).toBe("lost");
    expect(calls.at(-1)).toBe("blocked");
  });
});
