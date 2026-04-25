import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
} from "drizzle-orm";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { parseJsonSafely } from "@shared/json";
import {
  createLeaderboardId,
  rowToLeaderboardEntry,
  type LeaderboardEntry,
  type LeaderboardInsert,
  type LeaderboardListOptions,
} from "@server/leaderboard";
import {
  databaseSchema,
  devices,
  leaderboardScores,
  preferences,
  resultClears,
  results,
  saves,
  type ResultPruneRow,
  type ResultRow,
} from "@server/db-schema";
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
const drizzleMigrationsFolder = "migrations/drizzle";

type GameDrizzle = BunSQLiteDatabase<typeof databaseSchema>;
type LeaderboardRankOptions = {
  gameId: string;
  metric: LeaderboardListOptions["metric"];
  direction: LeaderboardListOptions["direction"];
  difficulty?: LeaderboardListOptions["difficulty"];
  metricValue: number;
  createdAt: string;
  id: string;
};

export class GameDatabase {
  private readonly sqlite: Database;
  private readonly db: GameDrizzle;

  constructor(path = defaultDatabasePath()) {
    ensureDatabaseParent(path);
    this.sqlite = new Database(path, { create: true, strict: true });
    this.db = drizzle(this.sqlite, { schema: databaseSchema });
    this.sqlite.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA temp_store = MEMORY;
    `);
    migrate(this.db, { migrationsFolder: drizzleMigrationsFolder });
    this.sqlite.exec("PRAGMA optimize;");
  }

  close(): void {
    this.sqlite.close();
  }

  snapshot(deviceId: string): SyncSnapshot {
    const readSnapshot = this.sqlite.transaction(() => {
      this.touchDevice(deviceId);
      return {
        preferences: this.listPreferences(deviceId),
        saves: this.listSaves(deviceId),
        deletedSaves: this.listDeletedSaves(deviceId),
        results: this.listResults(deviceId),
        resultClears: this.listResultClears(deviceId),
      };
    });
    return readSnapshot();
  }

  applySync(push: SyncPush): SyncSnapshot {
    this.touchDevice(push.deviceId);
    const apply = this.sqlite.transaction(() => {
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
    const submit = this.sqlite.transaction(() => {
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
    });
    return submit();
  }

  listLeaderboardScores(options: LeaderboardListOptions): LeaderboardEntry[] {
    const metricOrder =
      options.direction === "min"
        ? asc(leaderboardScores.metric_value)
        : desc(leaderboardScores.metric_value);
    const rows = this.db
      .select()
      .from(leaderboardScores)
      .where(leaderboardListWhere(options))
      .orderBy(metricOrder, asc(leaderboardScores.created_at), asc(leaderboardScores.id))
      .limit(options.limit)
      .all();
    return rows.map((row, index) => {
      const entry = rowToLeaderboardEntry(row);
      entry.rank = index + 1;
      return entry;
    });
  }

  private touchDevice(deviceId: string): void {
    const now = new Date().toISOString();
    this.db
      .insert(devices)
      .values({ id: deviceId, created_at: now, last_seen_at: now })
      .onConflictDoUpdate({ target: devices.id, set: { last_seen_at: now } })
      .run();
  }

  private upsertPreference(deviceId: string, preference: SyncPreference): void {
    this.db
      .insert(preferences)
      .values({
        device_id: deviceId,
        game_id: preference.gameId,
        data_json: jsonString(preference.data),
        updated_at: preference.updatedAt,
      })
      .onConflictDoUpdate({
        target: [preferences.device_id, preferences.game_id],
        set: {
          data_json: jsonString(preference.data),
          updated_at: preference.updatedAt,
        },
        setWhere: sql`excluded.updated_at > ${preferences.updated_at}`,
      })
      .run();
  }

  private upsertSave(deviceId: string, save: SyncSave): void {
    this.db
      .insert(saves)
      .values({
        device_id: deviceId,
        game_id: save.gameId,
        data_json: jsonString(save.data),
        updated_at: save.updatedAt,
        deleted_at: null,
      })
      .onConflictDoUpdate({
        target: [saves.device_id, saves.game_id],
        set: {
          data_json: jsonString(save.data),
          updated_at: save.updatedAt,
          deleted_at: null,
        },
        setWhere: sql`excluded.updated_at > ${saves.updated_at}`,
      })
      .run();
  }

  private deleteSave(deviceId: string, tombstone: SyncSaveTombstone): void {
    this.db
      .insert(saves)
      .values({
        device_id: deviceId,
        game_id: tombstone.gameId,
        data_json: null,
        updated_at: tombstone.deletedAt,
        deleted_at: tombstone.deletedAt,
      })
      .onConflictDoUpdate({
        target: [saves.device_id, saves.game_id],
        set: {
          data_json: null,
          updated_at: tombstone.deletedAt,
          deleted_at: tombstone.deletedAt,
        },
        setWhere: sql`excluded.updated_at > ${saves.updated_at}`,
      })
      .run();
  }

  private upsertResult(deviceId: string, result: SyncResult): void {
    if (this.isResultCleared(deviceId, result)) return;
    this.db
      .insert(results)
      .values({
        device_id: deviceId,
        id: result.id,
        run_id: result.runId,
        game_id: result.gameId,
        finished_at: result.finishedAt,
        difficulty: result.difficulty ?? null,
        outcome: result.outcome,
        score: result.score ?? null,
        moves: result.moves ?? null,
        duration_ms: result.durationMs ?? null,
        level: result.level ?? null,
        streak: result.streak ?? null,
        metadata_json: jsonString(result.metadata ?? {}),
      })
      .onConflictDoNothing({ target: [results.device_id, results.run_id] })
      .run();
  }

  private clearResults(deviceId: string, clear: SyncResultClear): void {
    const gameKey = clear.gameId ?? allResultsClearKey;
    this.db
      .insert(resultClears)
      .values({ device_id: deviceId, game_id: gameKey, cleared_at: clear.clearedAt })
      .onConflictDoUpdate({
        target: [resultClears.device_id, resultClears.game_id],
        set: { cleared_at: clear.clearedAt },
        setWhere: sql`excluded.cleared_at > ${resultClears.cleared_at}`,
      })
      .run();

    const resultFilter = clear.gameId
      ? and(
          eq(results.device_id, deviceId),
          eq(results.game_id, clear.gameId),
          lte(results.finished_at, clear.clearedAt),
        )
      : and(eq(results.device_id, deviceId), lte(results.finished_at, clear.clearedAt));
    this.db.delete(results).where(resultFilter).run();
  }

  private isResultCleared(deviceId: string, result: SyncResult): boolean {
    const row = this.db
      .select({ cleared_at: max(resultClears.cleared_at) })
      .from(resultClears)
      .where(
        and(
          eq(resultClears.device_id, deviceId),
          inArray(resultClears.game_id, [result.gameId, allResultsClearKey]),
        ),
      )
      .get();
    return Boolean(row?.cleared_at && result.finishedAt <= row.cleared_at);
  }

  private listPreferences(deviceId: string): SyncPreference[] {
    const rows = this.db
      .select()
      .from(preferences)
      .where(eq(preferences.device_id, deviceId))
      .orderBy(asc(preferences.game_id))
      .all();
    return rows.map((row) => ({
      gameId: row.game_id,
      updatedAt: row.updated_at,
      data: parseJson(row.data_json),
    }));
  }

  private listSaves(deviceId: string): SyncSave[] {
    const rows = this.db
      .select()
      .from(saves)
      .where(
        and(eq(saves.device_id, deviceId), isNotNull(saves.data_json), isNull(saves.deleted_at)),
      )
      .orderBy(asc(saves.game_id))
      .all();
    return rows.map((row) => ({
      gameId: row.game_id,
      updatedAt: row.updated_at,
      data: parseJson(row.data_json ?? "{}"),
    }));
  }

  private listDeletedSaves(deviceId: string): SyncSaveTombstone[] {
    const rows = this.db
      .select()
      .from(saves)
      .where(and(eq(saves.device_id, deviceId), isNotNull(saves.deleted_at)))
      .orderBy(asc(saves.game_id))
      .all();
    return rows.map((row) => ({
      gameId: row.game_id,
      deletedAt: row.deleted_at ?? row.updated_at,
    }));
  }

  private listResults(deviceId: string): SyncResult[] {
    const rows = this.db
      .select()
      .from(results)
      .where(eq(results.device_id, deviceId))
      .orderBy(desc(results.finished_at))
      .limit(maxTotalResults)
      .all();
    return rows.map(rowToResult);
  }

  private listResultClears(deviceId: string): SyncResultClear[] {
    const rows = this.db
      .select()
      .from(resultClears)
      .where(eq(resultClears.device_id, deviceId))
      .orderBy(desc(resultClears.cleared_at))
      .all();
    return rows.map((row) =>
      row.game_id === allResultsClearKey
        ? { clearedAt: row.cleared_at }
        : { gameId: row.game_id, clearedAt: row.cleared_at },
    );
  }

  private pruneResults(deviceId: string): void {
    const rows: ResultPruneRow[] = this.db
      .select({ id: results.id, game_id: results.game_id, finished_at: results.finished_at })
      .from(results)
      .where(eq(results.device_id, deviceId))
      .orderBy(desc(results.finished_at))
      .all();
    const keep = new Set<string>();
    const perGameCounts = new Map<string, number>();

    for (const row of rows) {
      const gameCount = perGameCounts.get(row.game_id) ?? 0;
      if (keep.size < maxTotalResults && gameCount < maxResultsPerGame) {
        keep.add(row.id);
        perGameCounts.set(row.game_id, gameCount + 1);
      }
    }

    const deleteIds = rows.filter((row) => !keep.has(row.id)).map((row) => row.id);
    if (deleteIds.length === 0) return;
    this.db
      .delete(results)
      .where(and(eq(results.device_id, deviceId), inArray(results.id, deleteIds)))
      .run();
  }

  private findLeaderboardDuplicate(deviceId?: string, runId?: string): LeaderboardEntry | null {
    if (!deviceId || !runId) return null;
    const row = this.db
      .select()
      .from(leaderboardScores)
      .where(and(eq(leaderboardScores.device_id, deviceId), eq(leaderboardScores.run_id, runId)))
      .get();
    return row ? rowToLeaderboardEntry(row) : null;
  }

  private insertLeaderboardScore(score: LeaderboardInsert): LeaderboardEntry {
    const id = score.id ?? createLeaderboardId();
    const createdAt = score.createdAt ?? new Date().toISOString();
    const row = this.db
      .insert(leaderboardScores)
      .values({
        id,
        run_id: score.runId ?? null,
        device_id: score.deviceId ?? null,
        game_id: score.gameId,
        username: score.username,
        normalized_username: score.normalizedUsername,
        difficulty: score.difficulty ?? null,
        outcome: score.outcome,
        metric: score.metric,
        metric_value: score.metricValue,
        score: score.score ?? null,
        moves: score.moves ?? null,
        duration_ms: score.durationMs ?? null,
        level: score.level ?? null,
        streak: score.streak ?? null,
        metadata_json: jsonString(score.metadata),
        created_at: createdAt,
      })
      .returning()
      .get();
    if (!row) throw new Error("Leaderboard insert failed");
    return rowToLeaderboardEntry(row);
  }

  private leaderboardRank(options: LeaderboardRankOptions): number {
    const row = this.db
      .select({ count: count() })
      .from(leaderboardScores)
      .where(leaderboardRankWhere(options))
      .get();
    return (row?.count ?? 0) + 1;
  }
}

function leaderboardListWhere(options: LeaderboardListOptions) {
  return and(
    eq(leaderboardScores.game_id, options.gameId),
    eq(leaderboardScores.metric, options.metric),
    options.difficulty ? eq(leaderboardScores.difficulty, options.difficulty) : undefined,
  );
}

function leaderboardRankWhere(options: LeaderboardRankOptions) {
  const betterMetric =
    options.direction === "min"
      ? lt(leaderboardScores.metric_value, options.metricValue)
      : gt(leaderboardScores.metric_value, options.metricValue);
  const sameMetricEarlier = and(
    eq(leaderboardScores.metric_value, options.metricValue),
    or(
      lt(leaderboardScores.created_at, options.createdAt),
      and(
        eq(leaderboardScores.created_at, options.createdAt),
        lt(leaderboardScores.id, options.id),
      ),
    ),
  );

  return and(
    eq(leaderboardScores.game_id, options.gameId),
    eq(leaderboardScores.metric, options.metric),
    or(betterMetric, sameMetricEarlier),
    options.difficulty ? eq(leaderboardScores.difficulty, options.difficulty) : undefined,
  );
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

function parseJson(value: string): unknown | null {
  const parsedJson = parseJsonSafely(value);
  return parsedJson.ok ? parsedJson.value : null;
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
