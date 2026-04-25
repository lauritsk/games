PRAGMA foreign_keys = ON;

-- Run only against databases created before the streak metric was added.
-- New databases already include these columns through src/server/schema.ts.
ALTER TABLE results ADD COLUMN streak INTEGER;
ALTER TABLE leaderboard_scores ADD COLUMN streak INTEGER;
