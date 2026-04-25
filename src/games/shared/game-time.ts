import { isFiniteNumber } from "@shared/validation";

export function durationSince(startedAt: number | null, now = Date.now()): number | undefined {
  return startedAt === null ? undefined : Math.max(0, now - startedAt);
}

export function parseStartedAt(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isFiniteNumber(value) ? value : undefined;
}
