import * as v from "valibot";
import type { Difficulty } from "@shared/types";
import type { GameOutcome } from "@features/results/game-results";
import { readStored, storageKey, writeStored } from "@shared/storage";
import { integerBetweenSchema, parseWithSchema, unknownRecordSchema } from "@shared/validation";

export type BotStreak = {
  current: number;
  best: number;
};

const STREAK_SCHEMA_VERSION = 1;
const streaksKey = storageKey("bot-streaks");
const countSchema = integerBetweenSchema(0, 10_000);
const streakSchema = v.object({ current: countSchema, best: countSchema });

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
  const record = parseWithSchema(unknownRecordSchema, value);
  if (!record) return null;
  const streaks: StoredStreaks = {};
  for (const [key, entry] of Object.entries(record)) {
    const parsed = parseWithSchema(streakSchema, entry);
    if (parsed)
      streaks[key] = { current: parsed.current, best: Math.max(parsed.best, parsed.current) };
  }
  return streaks;
}

function streakKey(gameId: string, difficulty: Difficulty): string {
  return `${gameId}:${difficulty}`;
}
