import type { Difficulty } from "./types";
import type { GameOutcome } from "./game-results";
import { readStored, storageKey, writeStored } from "./storage";
import { isRecord } from "./validation";

export type BotStreak = {
  current: number;
  best: number;
};

const STREAK_SCHEMA_VERSION = 1;
const streaksKey = storageKey("bot-streaks");

type StoredStreaks = Record<string, BotStreak>;

export function getBotStreak(gameId: string, difficulty: Difficulty): BotStreak {
  return readStreaks()[streakKey(gameId, difficulty)] ?? { current: 0, best: 0 };
}

export function recordBotStreakOutcome(
  gameId: string,
  difficulty: Difficulty,
  outcome: Extract<GameOutcome, "won" | "lost" | "draw">,
): BotStreak {
  const streaks = readStreaks();
  const key = streakKey(gameId, difficulty);
  const previous = streaks[key] ?? { current: 0, best: 0 };
  const current = outcome === "won" ? previous.current + 1 : 0;
  const next = { current, best: Math.max(previous.best, current) };
  streaks[key] = next;
  writeStored(streaksKey, STREAK_SCHEMA_VERSION, streaks);
  return next;
}

export function resetBotStreak(gameId: string, difficulty: Difficulty): BotStreak {
  const streaks = readStreaks();
  const key = streakKey(gameId, difficulty);
  const previous = streaks[key] ?? { current: 0, best: 0 };
  const next = { current: 0, best: previous.best };
  streaks[key] = next;
  writeStored(streaksKey, STREAK_SCHEMA_VERSION, streaks);
  return next;
}

function readStreaks(): StoredStreaks {
  return readStored(streaksKey, STREAK_SCHEMA_VERSION, parseStreaks) ?? {};
}

function parseStreaks(value: unknown): StoredStreaks | null {
  if (!isRecord(value)) return null;
  const streaks: StoredStreaks = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const current = parseCount(entry.current);
    const best = parseCount(entry.best);
    if (current === null || best === null) continue;
    streaks[key] = { current, best: Math.max(best, current) };
  }
  return streaks;
}

function parseCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000
    ? value
    : null;
}

function streakKey(gameId: string, difficulty: Difficulty): string {
  return `${gameId}:${difficulty}`;
}
