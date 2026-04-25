import type { Difficulty } from "./types";
import { readStored, storageKey, writeStored } from "./storage";

export type GamePreferences = {
  difficulty?: Difficulty;
  options?: Record<string, string | number | boolean>;
};

type PreferencesByGame = Record<string, GamePreferences>;

const PREFERENCES_SCHEMA_VERSION = 1;
const preferencesKey = storageKey("preferences");
const difficulties = new Set<Difficulty>(["Easy", "Medium", "Hard"]);

export function loadGamePreferences(gameId: string): GamePreferences {
  return loadPreferences()[gameId] ?? {};
}

export function saveGamePreferences(gameId: string, preferences: GamePreferences): void {
  const all = loadPreferences();
  all[gameId] = sanitizePreferences(preferences);
  writeStored(preferencesKey, PREFERENCES_SCHEMA_VERSION, all);
}

export function updateGamePreferences(
  gameId: string,
  updater: (current: GamePreferences) => GamePreferences,
): void {
  saveGamePreferences(gameId, updater(loadGamePreferences(gameId)));
}

export function parseDifficulty(value: unknown): Difficulty | null {
  return difficulties.has(value as Difficulty) ? (value as Difficulty) : null;
}

function loadPreferences(): PreferencesByGame {
  return readStored(preferencesKey, PREFERENCES_SCHEMA_VERSION, parsePreferencesByGame) ?? {};
}

function parsePreferencesByGame(value: unknown): PreferencesByGame | null {
  if (!isRecord(value)) return null;
  const next: PreferencesByGame = {};
  for (const [gameId, preferences] of Object.entries(value)) {
    if (!isRecord(preferences)) continue;
    next[gameId] = sanitizePreferences(preferences);
  }
  return next;
}

function sanitizePreferences(value: unknown): GamePreferences {
  if (!isRecord(value)) return {};
  const preferences: GamePreferences = {};
  const difficulty = parseDifficulty(value.difficulty);
  if (difficulty) preferences.difficulty = difficulty;
  const options = parseOptions(value.options);
  if (options) preferences.options = options;
  return preferences;
}

function parseOptions(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const options: Record<string, string | number | boolean> = {};
  for (const [key, option] of Object.entries(value)) {
    if (typeof option === "string" || typeof option === "number" || typeof option === "boolean") {
      options[key] = option;
    }
  }
  return Object.keys(options).length ? options : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
