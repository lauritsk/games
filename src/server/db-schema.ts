import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { SyncResult } from "../features/sync/sync-types";
import type { ResultMetric } from "../features/results/result-metrics";
import type { Difficulty } from "../shared/types";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  created_at: text("created_at").notNull(),
  last_seen_at: text("last_seen_at").notNull(),
});

export const preferences = sqliteTable(
  "preferences",
  {
    device_id: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    game_id: text("game_id").notNull(),
    data_json: text("data_json").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.device_id, table.game_id] })],
);

export const saves = sqliteTable(
  "saves",
  {
    device_id: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    game_id: text("game_id").notNull(),
    data_json: text("data_json"),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.device_id, table.game_id] }),
    check(
      "saves_data_or_deleted_check",
      sql`${table.data_json} IS NOT NULL OR ${table.deleted_at} IS NOT NULL`,
    ),
  ],
);

export const results = sqliteTable(
  "results",
  {
    device_id: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    run_id: text("run_id").notNull(),
    game_id: text("game_id").notNull(),
    finished_at: text("finished_at").notNull(),
    difficulty: text("difficulty").$type<Difficulty>(),
    outcome: text("outcome").$type<SyncResult["outcome"]>().notNull(),
    score: integer("score"),
    moves: integer("moves"),
    duration_ms: integer("duration_ms"),
    level: integer("level"),
    streak: integer("streak"),
    metadata_json: text("metadata_json").notNull().default("{}"),
  },
  (table) => [
    primaryKey({ columns: [table.device_id, table.id] }),
    unique().on(table.device_id, table.run_id),
    index("results_device_finished_idx").on(table.device_id, sql`${table.finished_at} DESC`),
    index("results_device_game_finished_idx").on(
      table.device_id,
      table.game_id,
      sql`${table.finished_at} DESC`,
    ),
  ],
);

export const resultClears = sqliteTable(
  "result_clears",
  {
    device_id: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    game_id: text("game_id").notNull(),
    cleared_at: text("cleared_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.device_id, table.game_id] })],
);

export const leaderboardScores = sqliteTable(
  "leaderboard_scores",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id"),
    device_id: text("device_id"),
    game_id: text("game_id").notNull(),
    username: text("username").notNull(),
    normalized_username: text("normalized_username").notNull(),
    difficulty: text("difficulty").$type<Difficulty>(),
    outcome: text("outcome").notNull(),
    metric: text("metric").$type<ResultMetric>().notNull(),
    metric_value: integer("metric_value").notNull(),
    score: integer("score"),
    moves: integer("moves"),
    duration_ms: integer("duration_ms"),
    level: integer("level"),
    streak: integer("streak"),
    metadata_json: text("metadata_json").notNull().default("{}"),
    created_at: text("created_at").notNull(),
  },
  (table) => [
    index("leaderboard_scores_game_metric_idx").on(
      table.game_id,
      table.metric,
      sql`${table.metric_value} DESC`,
      sql`${table.created_at} ASC`,
    ),
    index("leaderboard_scores_game_created_idx").on(table.game_id, sql`${table.created_at} DESC`),
    uniqueIndex("leaderboard_scores_device_run_idx")
      .on(table.device_id, table.run_id)
      .where(sql`${table.device_id} IS NOT NULL AND ${table.run_id} IS NOT NULL`),
  ],
);

export const databaseSchema = {
  devices,
  preferences,
  saves,
  results,
  resultClears,
  leaderboardScores,
};

export type ResultRow = typeof results.$inferSelect;
export type ResultPruneRow = Pick<ResultRow, "id" | "game_id" | "finished_at">;
