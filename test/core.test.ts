import { describe, expect, test } from "bun:test";
import {
  createDelayedAction,
  createMountScope,
  directionFromSwipeDelta,
  durationSince,
  isFiniteNumber,
  isIntegerInRange,
  moveGridIndex,
  moveGridPoint,
  nextDifficulty,
  parseArray,
  parseFixedArray,
  parseFixedGrid,
  parseJsonSafely,
  parseNonEmptyArray,
  parseOneOf,
  parseStartedAt,
  pauseGameOnRequest,
  pauseOnFocusLoss,
  previousDifficulty,
  requestGamePause,
  shuffleInPlace,
  takeGroupedItems,
} from "@shared/core";

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

describe("touch gestures", () => {
  test("classifies dominant swipe direction after threshold", () => {
    expect(directionFromSwipeDelta(40, 8)).toBe("right");
    expect(directionFromSwipeDelta(-40, 8)).toBe("left");
    expect(directionFromSwipeDelta(6, 40)).toBe("down");
    expect(directionFromSwipeDelta(6, -40)).toBe("up");
    expect(directionFromSwipeDelta(10, 10)).toBeNull();
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

  test("parses one-of values without widening invalid input", () => {
    expect(parseOneOf("playing", ["ready", "playing"] as const)).toBe("playing");
    expect(parseOneOf("lost", ["ready", "playing"] as const)).toBeNull();
    expect(parseOneOf(2, [1, 2, 3] as const)).toBe(2);
  });

  test("parses JSON without throwing", () => {
    expect(parseJsonSafely('{"ok":true}')).toEqual({ ok: true, value: { ok: true } });
    expect(parseJsonSafely("{")).toEqual({ ok: false });
  });

  test("parses nullable start times and elapsed durations", () => {
    expect(parseStartedAt(null)).toBeNull();
    expect(parseStartedAt(100)).toBe(100);
    expect(parseStartedAt(Number.NaN)).toBeUndefined();
    expect(durationSince(null, 150)).toBeUndefined();
    expect(durationSince(100, 150)).toBe(50);
    expect(durationSince(200, 150)).toBe(0);
  });

  test("parses arrays only when every item is valid", () => {
    expect(parseArray([1, 2, 3], parseNumber)).toEqual([1, 2, 3]);
    expect(parseArray([1, "2", 3], parseNumber)).toBeNull();
    expect(parseArray("not-array", parseNumber)).toBeNull();
    expect(parseNonEmptyArray([1], parseNumber)).toEqual([1]);
    expect(parseNonEmptyArray([], parseNumber)).toBeNull();
  });

  test("enforces fixed arrays and grid dimensions", () => {
    expect(parseFixedArray([1, 2], 2, parseNumber)).toEqual([1, 2]);
    expect(parseFixedArray([1], 2, parseNumber)).toBeNull();
    expect(
      parseFixedGrid(
        [
          [1, 2],
          [3, 4],
        ],
        2,
        2,
        parseNumber,
      ),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(parseFixedGrid([[1], [2]], 2, 2, parseNumber)).toBeNull();
  });
});

test("shuffleInPlace preserves items", () => {
  const items = [1, 2, 3, 4];
  expect(shuffleInPlace([...items]).sort()).toEqual(items);
});

test("takeGroupedItems preserves order while enforcing total and per-group limits", () => {
  const items = [
    { id: "a1", gameId: "a" },
    { id: "a2", gameId: "a" },
    { id: "a3", gameId: "a" },
    { id: "b1", gameId: "b" },
    { id: "c1", gameId: "c" },
  ];

  expect(
    takeGroupedItems(items, {
      maxTotal: 3,
      maxPerGroup: 2,
      groupKey: (item) => item.gameId,
    }).map((item) => item.id),
  ).toEqual(["a1", "a2", "b1"]);
});

test("pauses active games on focus loss and tab hide", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = new EventTarget();
  let hidden = false;
  Object.defineProperty(fakeDocument, "hidden", { get: () => hidden });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: fakeDocument,
  });

  try {
    const scope = createMountScope();
    let active = false;
    let pauses = 0;
    pauseOnFocusLoss(scope, {
      isActive: () => active,
      pause: () => {
        active = false;
        pauses += 1;
      },
    });

    fakeWindow.dispatchEvent(new Event("blur"));
    expect(pauses).toBe(0);

    active = true;
    fakeWindow.dispatchEvent(new Event("blur"));
    expect(pauses).toBe(1);

    active = true;
    hidden = false;
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    expect(pauses).toBe(1);

    hidden = true;
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    expect(pauses).toBe(2);

    active = true;
    scope.cleanup();
    fakeWindow.dispatchEvent(new Event("blur"));
    expect(pauses).toBe(2);
  } finally {
    restoreGlobal("window", previousWindow);
    restoreGlobal("document", previousDocument);
  }
});

test("pause requests pause active pausable games", () => {
  const shell = new EventTarget() as HTMLElement;
  const scope = createMountScope();
  let mode: "ready" | "playing" | "paused" = "ready";
  let pauses = 0;

  pauseGameOnRequest(shell, scope, {
    canPause: () => mode === "playing",
    isPaused: () => mode === "paused",
    pause: () => {
      mode = "paused";
      pauses += 1;
    },
  });

  expect(requestGamePause(shell)).toBe(false);
  mode = "playing";
  expect(requestGamePause(shell)).toBe(true);
  expect(pauses).toBe(1);
  expect(mode).toBe("paused");
  expect(requestGamePause(shell)).toBe(true);
  expect(pauses).toBe(1);

  mode = "playing";
  scope.cleanup();
  expect(requestGamePause(shell)).toBe(false);
  expect(pauses).toBe(1);
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

function parseNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function restoreGlobal(
  name: "window" | "document",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
