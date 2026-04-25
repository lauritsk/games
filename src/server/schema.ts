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
`;
