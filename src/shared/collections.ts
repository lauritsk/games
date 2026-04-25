import type { RandomSource } from "@shared/types";

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

type GroupLimitOptions<T> = {
  maxTotal: number;
  maxPerGroup: number;
  groupKey: (item: T) => string;
};

export function takeGroupedItems<T>(items: Iterable<T>, options: GroupLimitOptions<T>): T[] {
  if (options.maxTotal <= 0 || options.maxPerGroup <= 0) return [];
  const counts = new Map<string, number>();
  const selected: T[] = [];

  for (const item of items) {
    const key = options.groupKey(item);
    const count = counts.get(key) ?? 0;
    if (count >= options.maxPerGroup) continue;
    counts.set(key, count + 1);
    selected.push(item);
    if (selected.length >= options.maxTotal) break;
  }

  return selected;
}
