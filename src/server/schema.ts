export const SYNC_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
  device_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, game_id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS saves (
  device_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  data_json TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (device_id, game_id),
  CHECK (data_json IS NOT NULL OR deleted_at IS NOT NULL),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS results (
  device_id TEXT NOT NULL,
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  difficulty TEXT,
  outcome TEXT NOT NULL,
  score INTEGER,
  moves INTEGER,
  duration_ms INTEGER,
  level INTEGER,
  streak INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (device_id, id),
  UNIQUE (device_id, run_id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS result_clears (
  device_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  cleared_at TEXT NOT NULL,
  PRIMARY KEY (device_id, game_id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS results_device_finished_idx
  ON results (device_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS results_device_game_finished_idx
  ON results (device_id, game_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS leaderboard_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  device_id TEXT,
  game_id TEXT NOT NULL,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL,
  difficulty TEXT,
  outcome TEXT NOT NULL,
  metric TEXT NOT NULL,
  metric_value INTEGER NOT NULL,
  score INTEGER,
  moves INTEGER,
  duration_ms INTEGER,
  level INTEGER,
  streak INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS leaderboard_scores_game_metric_idx
  ON leaderboard_scores (game_id, metric, metric_value DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS leaderboard_scores_game_created_idx
  ON leaderboard_scores (game_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_scores_device_run_idx
  ON leaderboard_scores (device_id, run_id)
  WHERE device_id IS NOT NULL AND run_id IS NOT NULL;
`;
