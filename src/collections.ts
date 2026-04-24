import type { RandomSource } from "./types";

export function required<T>(value: T | null | undefined, message = "Missing required value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

export function gridCell<T>(
  grid: T[][],
  row: number,
  column: number,
  message = "Missing grid cell",
): T {
  return required(grid[row]?.[column], message);
}

export function shuffleInPlace<T>(items: T[], rng: RandomSource = Math.random): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [items[index], items[swap]] = [required(items[swap]), required(items[index])];
  }
  return items;
}
