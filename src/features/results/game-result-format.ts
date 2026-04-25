import { bestGameResult, type GameResult } from "@features/results/game-results";
import type { MetricDirection, ResultMetric } from "@features/results/result-metrics";

export type BestResultDirection = MetricDirection;

export type BestResultConfig = {
  metric: ResultMetric;
  direction: BestResultDirection;
  label: string;
};

export function bestSummaryText(gameId: string): string | null {
  const config = bestConfigForGame(gameId);
  const result = bestGameResult(gameId, config.metric, config.direction);
  const value = result?.[config.metric];
  return typeof value === "number"
    ? `Best ${config.label}: ${formatMetric(config.metric, value)}`
    : null;
}

export function bestConfigForGame(gameId: string): BestResultConfig {
  if (gameId === "memory") return { metric: "moves", direction: "min", label: "moves" };
  if (gameId === "minesweeper") return { metric: "durationMs", direction: "min", label: "time" };
  if (gameId === "connect4" || gameId === "tictactoe") {
    return { metric: "streak", direction: "max", label: "streak" };
  }
  return { metric: "score", direction: "max", label: "score" };
}

export function resultDetails(result: GameResult): string[] {
  const details: string[] = [];
  if (typeof result.score === "number") {
    details.push(`Score ${formatMetric("score", result.score)}`);
  }
  if (typeof result.moves === "number") {
    details.push(`${formatMetric("moves", result.moves)} moves`);
  }
  if (typeof result.level === "number") {
    details.push(`Level ${formatMetric("level", result.level)}`);
  }
  if (typeof result.streak === "number") {
    details.push(`Streak ${formatMetric("streak", result.streak)}`);
  }
  if (typeof result.durationMs === "number") {
    details.push(formatMetric("durationMs", result.durationMs));
  }
  if (result.difficulty) details.push(result.difficulty);
  const mode = result.metadata?.mode;
  if (mode === "bot") details.push("Vs bot");
  else if (mode === "local") details.push("2 players");
  return details;
}

export function formatMetric(metric: ResultMetric, value: number): string {
  if (metric === "durationMs") return formatDuration(value);
  if (metric === "streak")
    return `${new Intl.NumberFormat().format(value)} win${value === 1 ? "" : "s"}`;
  return new Intl.NumberFormat().format(value);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatOutcome(outcome: GameResult["outcome"]): string {
  if (outcome === "won") return "Won";
  if (outcome === "lost") return "Lost";
  if (outcome === "draw") return "Draw";
  return "Completed";
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(
    date,
  );
}
