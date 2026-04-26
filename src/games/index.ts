import type { GameDefinition, GameTheme } from "@shared/core";

export type GameSummary = Omit<GameDefinition, "mount">;

export type GameEntry = GameSummary & {
  load(): Promise<GameDefinition>;
};

function entry(
  summary: GameSummary,
  load: () => Promise<Record<string, unknown>>,
  exportName: string,
): GameEntry {
  return {
    ...summary,
    async load() {
      const game = (await load())[exportName];
      if (isGameDefinition(game)) return game;
      return missingGameExport(summary.id, exportName);
    },
  };
}

function isGameDefinition(value: unknown): value is GameDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "theme" in value &&
    "mount" in value &&
    typeof value.mount === "function"
  );
}

function missingGameExport(id: string, exportName: string): never {
  throw new Error(`Game ${id} did not export ${exportName}`);
}

function summary(
  id: string,
  name: string,
  tagline: string,
  players: string,
  theme: GameTheme,
): GameSummary {
  return { id, name, tagline, players, theme };
}

export const games = [
  entry(
    summary(
      "connect4",
      "Connect 4",
      "Drop discs. Stack four. Keep it light.",
      "Solo, local, or online",
      "deep-ocean",
    ),
    () => import("@games/connect4"),
    "connect4",
  ),
  entry(
    summary("minesweeper", "Minesweeper", "Clear the field. Mark the danger.", "Solo", "deep-cave"),
    () => import("@games/minesweeper"),
    "minesweeper",
  ),
  entry(
    summary("2048", "2048", "Slide tiles. Merge numbers.", "Solo", "outer-space"),
    () => import("@games/2048"),
    "game2048",
  ),
  entry(
    summary("tictactoe", "Tic-Tac-Toe", "Three in a row.", "Solo, local, or online", "deep-forest"),
    () => import("@games/tictactoe"),
    "tictactoe",
  ),
  entry(
    summary("snake", "Snake", "Eat, grow, do not crash.", "Solo or online (2-4)", "deep-forest"),
    () => import("@games/snake"),
    "snake",
  ),
  entry(
    summary("memory", "Memory", "Flip cards. Match pairs.", "Solo, local, or online", "deep-ocean"),
    () => import("@games/memory"),
    "memory",
  ),
  entry(
    summary("tetris", "Tetris", "Stack, rotate, clear lines.", "Solo", "outer-space"),
    () => import("@games/tetris"),
    "tetris",
  ),
  entry(
    summary("breakout", "Breakout", "Bounce, smash bricks, survive.", "Solo", "deep-cave"),
    () => import("@games/breakout"),
    "breakout",
  ),
  entry(
    summary("ballz", "Ballz", "Aim the volley. Break the numbers.", "Solo", "deep-cave"),
    () => import("@games/ballz"),
    "ballz",
  ),
  entry(
    summary(
      "space-invaders",
      "Space Invaders",
      "Hold the line against descending waves.",
      "Solo or online co-op",
      "outer-space",
    ),
    () => import("@games/space-invaders"),
    "spaceInvaders",
  ),
  entry(
    summary("asteroids", "Asteroids", "Drift, dodge, split the rocks.", "Solo", "outer-space"),
    () => import("@games/asteroids"),
    "asteroids",
  ),
  entry(
    summary("frogger", "Frogger", "Hop lanes. Ride logs. Reach home.", "Solo", "deep-forest"),
    () => import("@games/frogger"),
    "frogger",
  ),
] satisfies GameEntry[];

export function gameById(id: string): GameEntry | null {
  return games.find((game) => game.id === id) ?? null;
}
