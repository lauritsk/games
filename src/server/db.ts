import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
  createLeaderboardId,
  rowToLeaderboardEntry,
  type LeaderboardEntry,
  type LeaderboardInsert,
  type LeaderboardListOptions,
  type LeaderboardRow,
} from "@server/leaderboard";
import { SYNC_SCHEMA_SQL } from "@server/schema";
import type {
  SyncPreference,
  SyncPush,
  SyncResult,
  SyncResultClear,
  SyncSave,
  SyncSaveTombstone,
  SyncSnapshot,
} from "@features/sync/sync-types";

const maxTotalResults = 250;
const maxResultsPerGame = 50;
const allResultsClearKey = "*";

type PreferenceRow = { game_id: string; data_json: string; updated_at: string };
type SaveRow = {
  game_id: string;
  data_json: string | null;
  updated_at: string;
  deleted_at: string | null;
};
type ResultClearRow = { game_id: string; cleared_at: string };
type ResultRow = {
  id: string;
  run_id: string;
  game_id: string;
  finished_at: string;
  difficulty: string | null;
  outcome: SyncResult["outcome"];
  score: number | null;
  moves: number | null;
  duration_ms: number | null;
  level: number | null;
  streak: number | null;
  metadata_json: string;
};
type ResultPruneRow = { id: string; game_id: string; finished_at: string };
type MaxClearRow = { cleared_at: string | null };
type CountRow = { count: number };
type LeaderboardRankOptions = {
  gameId: string;
  metric: LeaderboardListOptions["metric"];
  direction: LeaderboardListOptions["direction"];
  difficulty?: string;
  metricValue: number;
  createdAt: string;
  id: string;
};
type SqlValue = number | string;

const leaderboardScoreColumns = [
  "id",
  "game_id",
  "username",
  "difficulty",
  "outcome",
  "metric",
  "metric_value",
  "score",
  "moves",
  "duration_ms",
  "level",
  "streak",
  "metadata_json",
  "created_at",
].join(", ");

export class GameDatabase {
  private readonly db: Database;

  constructor(path = defaultDatabasePath()) {
    ensureDatabaseParent(path);
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SYNC_SCHEMA_SQL);
    this.ensureColumn("results", "streak", "INTEGER");
    this.ensureColumn("leaderboard_scores", "streak", "INTEGER");
  }

  close(): void {
    this.db.close();
  }

  snapshot(deviceId: string): SyncSnapshot {
    this.touchDevice(deviceId);
    return {
      preferences: this.listPreferences(deviceId),
      saves: this.listSaves(deviceId),
      deletedSaves: this.listDeletedSaves(deviceId),
      results: this.listResults(deviceId),
      resultClears: this.listResultClears(deviceId),
    };
  }

  applySync(push: SyncPush): SyncSnapshot {
    this.touchDevice(push.deviceId);
    const apply = this.db.transaction(() => {
      for (const preference of push.preferences) this.upsertPreference(push.deviceId, preference);
      for (const save of push.saves) this.upsertSave(push.deviceId, save);
      for (const tombstone of push.deletedSaves) this.deleteSave(push.deviceId, tombstone);
      for (const clear of push.resultClears) this.clearResults(push.deviceId, clear);
      for (const result of push.results) this.upsertResult(push.deviceId, result);
      this.pruneResults(push.deviceId);
    });
    apply();
    return this.snapshot(push.deviceId);
  }

  submitLeaderboardScore(
    score: LeaderboardInsert,
    direction: LeaderboardListOptions["direction"],
  ): LeaderboardEntry {
    const existing = this.findLeaderboardDuplicate(score.deviceId, score.runId);
    const entry = existing ?? this.insertLeaderboardScore(score);
    entry.rank = this.leaderboardRank({
      gameId: entry.gameId,
      metric: entry.metric,
      direction,
      difficulty: entry.difficulty,
      metricValue: entry.metricValue,
      createdAt: entry.createdAt,
      id: entry.id,
    });
    return entry;
  }

  listLeaderboardScores(options: LeaderboardListOptions): LeaderboardEntry[] {
    const directionSql = options.direction === "min" ? "ASC" : "DESC";
    const query = leaderboardListQuery(options);
    const rows = this.db
      .query(
        `SELECT ${leaderboardScoreColumns}
         FROM leaderboard_scores
         WHERE game_id = ?1 AND metric = ?2${query.difficultyClause}
         ORDER BY metric_value ${directionSql}, created_at ASC, id ASC
         LIMIT ${query.limitPlaceholder}`,
      )
      .all(...query.parameters) as LeaderboardRow[];
    return rows.map((row, index) => {
      const entry = rowToLeaderboardEntry(row);
      entry.rank = index + 1;
      return entry;
    });
  }

  private ensureColumn(
    table: "results" | "leaderboard_scores",
    column: string,
    definition: string,
  ): void {
    const rows = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (rows.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private touchDevice(deviceId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO devices (id, created_at, last_seen_at)
         VALUES (?1, ?2, ?2)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      )
      .run(deviceId, now);
  }

  private upsertPreference(deviceId: string, preference: SyncPreference): void {
    this.db
      .prepare(
        `INSERT INTO preferences (device_id, game_id, data_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(device_id, game_id) DO UPDATE SET
           data_json = excluded.data_json,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > preferences.updated_at`,
      )
      .run(deviceId, preference.gameId, jsonString(preference.data), preference.updatedAt);
  }

  private upsertSave(deviceId: string, save: SyncSave): void {
    this.db
      .prepare(
        `INSERT INTO saves (device_id, game_id, data_json, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, NULL)
         ON CONFLICT(device_id, game_id) DO UPDATE SET
           data_json = excluded.data_json,
           updated_at = excluded.updated_at,
           deleted_at = NULL
         WHERE excluded.updated_at > saves.updated_at`,
      )
      .run(deviceId, save.gameId, jsonString(save.data), save.updatedAt);
  }

  private deleteSave(deviceId: string, tombstone: SyncSaveTombstone): void {
    this.db
      .prepare(
        `INSERT INTO saves (device_id, game_id, data_json, updated_at, deleted_at)
         VALUES (?1, ?2, NULL, ?3, ?3)
         ON CONFLICT(device_id, game_id) DO UPDATE SET
           data_json = NULL,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at
         WHERE excluded.updated_at > saves.updated_at`,
      )
      .run(deviceId, tombstone.gameId, tombstone.deletedAt);
  }

  private upsertResult(deviceId: string, result: SyncResult): void {
    if (this.isResultCleared(deviceId, result)) return;
    this.db
      .prepare(
        `INSERT INTO results (
           device_id, id, run_id, game_id, finished_at, difficulty, outcome,
           score, moves, duration_ms, level, streak, metadata_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(device_id, run_id) DO NOTHING`,
      )
      .run(
        deviceId,
        result.id,
        result.runId,
        result.gameId,
        result.finishedAt,
        result.difficulty ?? null,
        result.outcome,
        result.score ?? null,
        result.moves ?? null,
        result.durationMs ?? null,
        result.level ?? null,
        result.streak ?? null,
        jsonString(result.metadata ?? {}),
      );
  }

  private clearResults(deviceId: string, clear: SyncResultClear): void {
    const gameKey = clear.gameId ?? allResultsClearKey;
    this.db
      .prepare(
        `INSERT INTO result_clears (device_id, game_id, cleared_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(device_id, game_id) DO UPDATE SET cleared_at = excluded.cleared_at
         WHERE excluded.cleared_at > result_clears.cleared_at`,
      )
      .run(deviceId, gameKey, clear.clearedAt);

    if (clear.gameId) {
      this.db
        .prepare(
          `DELETE FROM results
           WHERE device_id = ?1 AND game_id = ?2 AND finished_at <= ?3`,
        )
        .run(deviceId, clear.gameId, clear.clearedAt);
      return;
    }

    this.db
      .prepare(`DELETE FROM results WHERE device_id = ?1 AND finished_at <= ?2`)
      .run(deviceId, clear.clearedAt);
  }

  private isResultCleared(deviceId: string, result: SyncResult): boolean {
    const row = this.db
      .query(
        `SELECT MAX(cleared_at) AS cleared_at
         FROM result_clears
         WHERE device_id = ?1 AND game_id IN (?2, ?3)`,
      )
      .get(deviceId, result.gameId, allResultsClearKey) as MaxClearRow | null;
    return Boolean(row?.cleared_at && result.finishedAt <= row.cleared_at);
  }

  private listPreferences(deviceId: string): SyncPreference[] {
    const rows = this.db
      .query(
        `SELECT game_id, data_json, updated_at
         FROM preferences
         WHERE device_id = ?1
         ORDER BY game_id`,
      )
      .all(deviceId) as PreferenceRow[];
    return rows.map((row) => ({
      gameId: row.game_id,
      updatedAt: row.updated_at,
      data: parseJson(row.data_json),
    }));
  }

  private listSaves(deviceId: string): SyncSave[] {
    const rows = this.db
      .query(
        `SELECT game_id, data_json, updated_at, deleted_at
         FROM saves
         WHERE device_id = ?1 AND data_json IS NOT NULL AND deleted_at IS NULL
         ORDER BY game_id`,
      )
      .all(deviceId) as SaveRow[];
    return rows.map((row) => ({
      gameId: row.game_id,
      updatedAt: row.updated_at,
      data: parseJson(row.data_json ?? "{}"),
    }));
  }

  private listDeletedSaves(deviceId: string): SyncSaveTombstone[] {
    const rows = this.db
      .query(
        `SELECT game_id, data_json, updated_at, deleted_at
         FROM saves
         WHERE device_id = ?1 AND deleted_at IS NOT NULL
         ORDER BY game_id`,
      )
      .all(deviceId) as SaveRow[];
    return rows.map((row) => ({
      gameId: row.game_id,
      deletedAt: row.deleted_at ?? row.updated_at,
    }));
  }

  private listResults(deviceId: string): SyncResult[] {
    const rows = this.db
      .query(
        `SELECT id, run_id, game_id, finished_at, difficulty, outcome, score, moves,
                duration_ms, level, streak, metadata_json
         FROM results
         WHERE device_id = ?1
         ORDER BY finished_at DESC
         LIMIT ?2`,
      )
      .all(deviceId, maxTotalResults) as ResultRow[];
    return rows.map(rowToResult);
  }

  private listResultClears(deviceId: string): SyncResultClear[] {
    const rows = this.db
      .query(
        `SELECT game_id, cleared_at
         FROM result_clears
         WHERE device_id = ?1
         ORDER BY cleared_at DESC`,
      )
      .all(deviceId) as ResultClearRow[];
    return rows.map((row) =>
      row.game_id === allResultsClearKey
        ? { clearedAt: row.cleared_at }
        : { gameId: row.game_id, clearedAt: row.cleared_at },
    );
  }

  private pruneResults(deviceId: string): void {
    const rows = this.db
      .query(
        `SELECT id, game_id, finished_at
         FROM results
         WHERE device_id = ?1
         ORDER BY finished_at DESC`,
      )
      .all(deviceId) as ResultPruneRow[];
    const keep = new Set<string>();
    const perGameCounts = new Map<string, number>();

    for (const row of rows) {
      const gameCount = perGameCounts.get(row.game_id) ?? 0;
      if (keep.size < maxTotalResults && gameCount < maxResultsPerGame) {
        keep.add(row.id);
        perGameCounts.set(row.game_id, gameCount + 1);
      }
    }

    for (const row of rows) {
      if (keep.has(row.id)) continue;
      this.db.prepare(`DELETE FROM results WHERE device_id = ?1 AND id = ?2`).run(deviceId, row.id);
    }
  }

  private findLeaderboardDuplicate(deviceId?: string, runId?: string): LeaderboardEntry | null {
    if (!deviceId || !runId) return null;
    const row = this.db
      .query(
        `SELECT ${leaderboardScoreColumns}
         FROM leaderboard_scores
         WHERE device_id = ?1 AND run_id = ?2`,
      )
      .get(deviceId, runId) as LeaderboardRow | null;
    return row ? rowToLeaderboardEntry(row) : null;
  }

  private insertLeaderboardScore(score: LeaderboardInsert): LeaderboardEntry {
    const id = score.id ?? createLeaderboardId();
    const createdAt = score.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO leaderboard_scores (
           id, run_id, device_id, game_id, username, normalized_username, difficulty, outcome,
           metric, metric_value, score, moves, duration_ms, level, streak, metadata_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
      )
      .run(
        id,
        score.runId ?? null,
        score.deviceId ?? null,
        score.gameId,
        score.username,
        score.normalizedUsername,
        score.difficulty ?? null,
        score.outcome,
        score.metric,
        score.metricValue,
        score.score ?? null,
        score.moves ?? null,
        score.durationMs ?? null,
        score.level ?? null,
        score.streak ?? null,
        jsonString(score.metadata),
        createdAt,
      );

    const row = this.db
      .query(
        `SELECT ${leaderboardScoreColumns}
         FROM leaderboard_scores
         WHERE id = ?1`,
      )
      .get(id) as LeaderboardRow | null;
    if (!row) throw new Error("Leaderboard insert failed");
    return rowToLeaderboardEntry(row);
  }

  private leaderboardRank(options: LeaderboardRankOptions): number {
    const comparator = options.direction === "min" ? "<" : ">";
    const rankWhere = `(metric_value ${comparator} ?3 OR (metric_value = ?3 AND (created_at < ?4 OR (created_at = ?4 AND id < ?5))))`;
    const query = leaderboardRankQuery(options);
    const row = this.db
      .query(
        `SELECT COUNT(*) AS count
         FROM leaderboard_scores
         WHERE game_id = ?1 AND metric = ?2 AND ${rankWhere}${query.difficultyClause}`,
      )
      .get(...query.parameters) as CountRow | null;
    return (row?.count ?? 0) + 1;
  }
}

function leaderboardListQuery(options: LeaderboardListOptions): {
  difficultyClause: string;
  limitPlaceholder: "?3" | "?4";
  parameters: SqlValue[];
} {
  if (options.difficulty) {
    return {
      difficultyClause: " AND difficulty = ?3",
      limitPlaceholder: "?4",
      parameters: [options.gameId, options.metric, options.difficulty, options.limit],
    };
  }

  return {
    difficultyClause: "",
    limitPlaceholder: "?3",
    parameters: [options.gameId, options.metric, options.limit],
  };
}

function leaderboardRankQuery(options: LeaderboardRankOptions): {
  difficultyClause: string;
  parameters: SqlValue[];
} {
  const parameters = [
    options.gameId,
    options.metric,
    options.metricValue,
    options.createdAt,
    options.id,
  ];
  if (!options.difficulty) return { difficultyClause: "", parameters };
  return {
    difficultyClause: " AND difficulty = ?6",
    parameters: [...parameters, options.difficulty],
  };
}

export function defaultDatabasePath(): string {
  return process.env.GAMES_DB_PATH ?? "data/games.sqlite";
}

function ensureDatabaseParent(path: string): void {
  if (path === ":memory:" || path.startsWith("file:")) return;
  mkdirSync(dirname(path), { recursive: true });
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function rowToResult(row: ResultRow): SyncResult {
  const result: SyncResult = {
    id: row.id,
    runId: row.run_id,
    gameId: row.game_id,
    finishedAt: row.finished_at,
    outcome: row.outcome,
  };
  if (row.difficulty === "Easy" || row.difficulty === "Medium" || row.difficulty === "Hard") {
    result.difficulty = row.difficulty;
  }
  if (row.score !== null) result.score = row.score;
  if (row.moves !== null) result.moves = row.moves;
  if (row.duration_ms !== null) result.durationMs = row.duration_ms;
  if (row.level !== null) result.level = row.level;
  if (row.streak !== null) result.streak = row.streak;
  const metadata = parseJson(row.metadata_json);
  if (metadata && typeof metadata === "object" && Object.keys(metadata).length > 0) {
    result.metadata = metadata as SyncResult["metadata"];
  }
  return result;
}
