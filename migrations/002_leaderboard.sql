PRAGMA foreign_keys = ON;

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
