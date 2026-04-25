import type { Direction, GridPoint } from "@shared/types";

export const Keys = {
  previous: ["arrowleft", "arrowup", "h", "k"],
  next: ["arrowright", "arrowdown", "l", "j"],
  left: ["arrowleft", "h"],
  right: ["arrowright", "l"],
  up: ["arrowup", "k"],
  down: ["arrowdown", "j"],
  activate: [" ", "enter"],
  nextDifficulty: ["+", "=", ">"],
  previousDifficulty: ["-", "_", "<"],
} as const;

const directionKeyMap: ReadonlyArray<readonly [Direction, readonly string[]]> = [
  ["up", [...Keys.up, "w"]],
  ["right", [...Keys.right, "d"]],
  ["down", [...Keys.down, "s"]],
  ["left", [...Keys.left, "a"]],
];

export function matchesKey(event: KeyboardEvent, keys: readonly string[]): boolean {
  const key = event.key.toLowerCase();
  return keys.some((candidate) => candidate.toLowerCase() === key);
}

export function directionFromKey(event: KeyboardEvent): Direction | null {
  const key = event.key.toLowerCase();
  return directionKeyMap.find(([, keys]) => keys.includes(key))?.[0] ?? null;
}

export function moveGridIndex(
  index: number,
  direction: Direction,
  columns: number,
  length: number,
): number {
  if (direction === "up") return Math.max(0, index - columns);
  if (direction === "right") return Math.min(length - 1, index + 1);
  if (direction === "down") return Math.min(length - 1, index + columns);
  return Math.max(0, index - 1);
}

export function moveGridPoint(
  point: GridPoint,
  direction: Direction,
  rows: number,
  columns: number,
): GridPoint {
  if (direction === "up") return { ...point, row: Math.max(0, point.row - 1) };
  if (direction === "right") return { ...point, column: Math.min(columns - 1, point.column + 1) };
  if (direction === "down") return { ...point, row: Math.min(rows - 1, point.row + 1) };
  return { ...point, column: Math.max(0, point.column - 1) };
}
