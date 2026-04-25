export type ResultMetric = "score" | "moves" | "durationMs" | "level" | "streak";
export type MetricDirection = "max" | "min";

export const numericResultFields = ["durationMs", "score", "moves", "level", "streak"] as const;
