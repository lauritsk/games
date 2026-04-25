import * as v from "valibot";
import type { Difficulty } from "@shared/types";
import { readStored, storageKey, writeStored } from "@shared/storage";
import { notifySyncChanged } from "@features/sync/sync-local";
import {
  parseWithSchema,
  picklistSchema,
  primitiveValueSchema,
  unknownRecordSchema,
} from "@shared/validation";

export type GamePreferences = {
  difficulty?: Difficulty;
  options?: Record<string, string | number | boolean>;
};

type PreferencesByGame = Record<string, GamePreferences>;

const PREFERENCES_SCHEMA_VERSION = 1;
const preferencesKey = storageKey("preferences");
const difficulties = ["Easy", "Medium", "Hard"] as const satisfies readonly Difficulty[];
const difficultySchema = picklistSchema(difficulties);
const preferenceBaseSchema = v.looseObject({
  difficulty: v.optional(v.unknown()),
  options: v.optional(v.unknown()),
});

export function loadGamePreferences(gameId: string): GamePreferences {
  return loadPreferences()[gameId] ?? {};
}

export function saveGamePreferences(gameId: string, preferences: GamePreferences): void {
  const all = loadPreferences();
  all[gameId] = sanitizePreferences(preferences);
  if (writeStored(preferencesKey, PREFERENCES_SCHEMA_VERSION, all)) notifySyncChanged();
}

export function updateGamePreferences(
  gameId: string,
  updater: (current: GamePreferences) => GamePreferences,
): void {
  saveGamePreferences(gameId, updater(loadGamePreferences(gameId)));
}

export function parseDifficulty(value: unknown): Difficulty | null {
  return parseWithSchema(difficultySchema, value);
}

function loadPreferences(): PreferencesByGame {
  return readStored(preferencesKey, PREFERENCES_SCHEMA_VERSION, parsePreferencesByGame) ?? {};
}

function parsePreferencesByGame(value: unknown): PreferencesByGame | null {
  const record = parseWithSchema(unknownRecordSchema, value);
  if (!record) return null;
  const next: PreferencesByGame = {};
  for (const [gameId, preferences] of Object.entries(record)) {
    const sanitized = sanitizePreferences(preferences);
    if (Object.keys(sanitized).length > 0) next[gameId] = sanitized;
  }
  return next;
}

function sanitizePreferences(value: unknown): GamePreferences {
  const base = parseWithSchema(preferenceBaseSchema, value);
  if (!base) return {};
  const preferences: GamePreferences = {};
  const difficulty = parseDifficulty(base.difficulty);
  if (difficulty) preferences.difficulty = difficulty;
  const options = parseOptions(base.options);
  if (options) preferences.options = options;
  return preferences;
}

function parseOptions(value: unknown): Record<string, string | number | boolean> | undefined {
  const record = parseWithSchema(unknownRecordSchema, value);
  if (!record) return undefined;
  const options: Record<string, string | number | boolean> = {};
  for (const [key, option] of Object.entries(record)) {
    const parsed = parseWithSchema(primitiveValueSchema, option);
    if (parsed !== null) options[key] = parsed;
  }
  return Object.keys(options).length ? options : undefined;
}
