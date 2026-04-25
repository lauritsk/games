import type { MetricDirection, ResultMetric } from "@features/results/result-metrics";

export type LeaderboardMetric = ResultMetric;
export type LeaderboardDirection = MetricDirection;

export type LeaderboardGameConfig = {
  gameId: string;
  metric: LeaderboardMetric;
  direction: LeaderboardDirection;
  label: string;
  maxMetricValue: number;
  allowedOutcomes?: readonly string[];
  requireDifficulty?: boolean;
  requiredMetadata?: Readonly<Record<string, string | number | boolean>>;
};

export const leaderboardGameConfigs = {
  "2048": {
    gameId: "2048",
    metric: "score",
    direction: "max",
    label: "score",
    maxMetricValue: 100_000_000,
    allowedOutcomes: ["lost", "completed", "won"],
  },
  tetris: {
    gameId: "tetris",
    metric: "score",
    direction: "max",
    label: "score",
    maxMetricValue: 100_000_000,
    allowedOutcomes: ["lost"],
  },
  snake: {
    gameId: "snake",
    metric: "score",
    direction: "max",
    label: "score",
    maxMetricValue: 1_000_000,
    allowedOutcomes: ["won", "lost"],
  },
  minesweeper: {
    gameId: "minesweeper",
    metric: "durationMs",
    direction: "min",
    label: "time",
    maxMetricValue: 86_400_000,
    allowedOutcomes: ["won"],
  },
  memory: {
    gameId: "memory",
    metric: "durationMs",
    direction: "min",
    label: "time",
    maxMetricValue: 86_400_000,
    allowedOutcomes: ["completed"],
  },
  breakout: {
    gameId: "breakout",
    metric: "score",
    direction: "max",
    label: "score",
    maxMetricValue: 100_000_000,
    allowedOutcomes: ["won", "lost"],
  },
  "space-invaders": {
    gameId: "space-invaders",
    metric: "score",
    direction: "max",
    label: "score",
    maxMetricValue: 100_000_000,
    allowedOutcomes: ["lost"],
  },
  tictactoe: {
    gameId: "tictactoe",
    metric: "streak",
    direction: "max",
    label: "streak",
    maxMetricValue: 10_000,
    allowedOutcomes: ["won"],
    requireDifficulty: true,
    requiredMetadata: { mode: "bot" },
  },
  connect4: {
    gameId: "connect4",
    metric: "streak",
    direction: "max",
    label: "streak",
    maxMetricValue: 10_000,
    allowedOutcomes: ["won"],
    requireDifficulty: true,
    requiredMetadata: { mode: "bot" },
  },
} as const satisfies Record<string, LeaderboardGameConfig>;

export type LeaderboardGameId = keyof typeof leaderboardGameConfigs;

export function leaderboardConfigForGame(gameId: string): LeaderboardGameConfig | null {
  return (leaderboardGameConfigs as Record<string, LeaderboardGameConfig>)[gameId] ?? null;
}

export function leaderboardGameIds(): string[] {
  return Object.keys(leaderboardGameConfigs);
}
