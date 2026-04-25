# PLAN — Current TODO Item Whiteboard

`PLAN.md` is scratch space for the next TODO item only. Rewrite this file after each completed item so it always reflects the current implementation target, assumptions, sequencing, and open questions.

Current TODO item: public leaderboards.

## Goal

Add old-arcade-cabinet style public leaderboards.

Players can finish a game, optionally enter a simple display name, and submit a score to a shared leaderboard. No accounts, no passwords, no complicated auth.

## Current baseline

Previous statefulness plan is complete enough to replace:

- Browser `localStorage` stores preferences, saves, results, sync metadata.
- Bun server exposes `/api/sync`.
- Server mirrors local state into SQLite through `bun:sqlite`.
- Static hosting still works without sync.
- Service worker caches app assets only, not game data or API responses.

## Direction

Stay as Bun-native as possible:

- Use `bun:sqlite` for server storage.
- Use Bun `Bun.serve` routes already in `src/server.ts`.
- Use `mise run <task>` for workflows.
- Avoid npm packages unless they solve real non-trivial work.
- Prefer small local modules over framework/runtime additions.
- Keep app local-first; leaderboards are optional public submissions.

## Product behavior

### Username model

Allow repeated usernames.

Reason:

- No auth means no real username ownership.
- Unique names would create squatting problems.
- Arcade machines used initials/display names, not accounts.
- A score belongs to a submission, not a user identity.

Users may submit as the same name many times. If multiple people use the same name, that is acceptable arcade behavior.

### Submission flow

After a result is recorded:

1. Result history modal shows saved local result.
2. If result has a leaderboard metric, show `Submit to leaderboard` action.
3. User enters display name.
4. Client posts result to server.
5. Server validates username and score payload.
6. Server stores public leaderboard row.
7. UI shows rank/top scores.

If server unavailable, hide or disable leaderboard submission and keep local result behavior unchanged.

## Security and trust model

No auth and client-side games mean scores are not tamper-proof.

Accept this for MVP. Make it casual, not competitive-money secure.

Mitigations:

- Server validates shape and ranges.
- Reject impossible or absurd values per game where easy.
- Rate limit by IP/device where simple.
- Deduplicate optional `runId` submissions.
- Keep admin/manual cleanup possible through SQLite.
- Never trust username or metadata as HTML; render with `textContent` only.

## Username validation

Rules:

- Trim whitespace.
- Normalize Unicode with `NFKC`.
- Collapse repeated spaces.
- Length: 3-16 visible chars.
- Allowed chars first pass: letters, numbers, spaces, `_`, `-`.
- Reject URLs/emails.
- Reject control chars.
- Reject reserved names.
- Reject profanity/offensive names.

Reserved names:

```text
admin
administrator
mod
moderator
system
null
undefined
anonymous
leaderboard
games
support
root
```

Error message should stay generic:

```text
Choose another name.
```

Do not reveal which word/rule failed.

## Profanity/offensive-name filtering

Recommended MVP: offline denylist.

Why:

- No API key.
- No latency.
- No third-party privacy issue.
- Works in Docker/offline.
- Simple and Bun-native-friendly.

Possible sources:

- Vendored small word list under `src/server/moderation/`.
- LDNOOBW-style list if license is acceptable.
- Small hand-curated English list if dependency/license uncertain.

Avoid external moderation API for MVP.

External APIs can be considered later if public use grows, but they add rate limits, privacy questions, and deployment config.

## Leaderboard metrics

Each game needs one leaderboard metric and sort direction.

Suggested first pass:

| Game | Metric | Direction | Notes |
| --- | --- | --- | --- |
| 2048 | score | max | Include max tile metadata. |
| Tetris | score | max | Include lines and level. |
| Snake | score | max | Food/length score. |
| Breakout | score | max | Include level/lives. |
| Space Invaders | score | max | Include wave. |
| Memory | moves | min | Tie-break by duration. |
| Minesweeper | durationMs | min | Only winning games. |
| Tic-Tac-Toe | moves | min | Only wins? Maybe skip public leaderboard. |
| Connect 4 | moves | min | Only wins? Maybe skip public leaderboard. |

Suggestion: implement score-based arcade games first:

1. Tetris
2. Snake
3. 2048
4. Breakout
5. Space Invaders

Then add puzzle/board games once ranking rules feel good.

## Database schema

Add migration:

```text
migrations/002_leaderboard.sql
```

Proposed table:

```sql
CREATE TABLE leaderboard_scores (
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

CREATE INDEX leaderboard_scores_game_metric_idx
  ON leaderboard_scores (game_id, metric, metric_value DESC, created_at ASC);

CREATE INDEX leaderboard_scores_game_created_idx
  ON leaderboard_scores (game_id, created_at DESC);

CREATE UNIQUE INDEX leaderboard_scores_device_run_idx
  ON leaderboard_scores (device_id, run_id)
  WHERE device_id IS NOT NULL AND run_id IS NOT NULL;
```

Note: sort direction differs by metric. Query code should choose `ASC` or `DESC` safely from server-side config, never from raw user input.

## API

Add routes under existing Bun server API.

```text
GET  /api/leaderboard?gameId=tetris&difficulty=Hard&limit=10
POST /api/leaderboard
```

Submit body:

```json
{
  "deviceId": "optional-device-id",
  "runId": "run-id-from-local-result",
  "gameId": "tetris",
  "username": "KARL",
  "difficulty": "Hard",
  "outcome": "lost",
  "score": 12000,
  "level": 7,
  "metadata": { "lines": 62 }
}
```

Success response:

```json
{
  "ok": true,
  "rank": 4,
  "entry": {
    "id": "leaderboard-entry-id",
    "gameId": "tetris",
    "username": "KARL",
    "score": 12000,
    "rank": 4,
    "createdAt": "2026-04-25T00:00:00.000Z"
  }
}
```

Failure response:

```json
{
  "ok": false,
  "error": "Choose another name."
}
```

## Server modules

Add:

```text
src/server/leaderboard.ts
src/server/leaderboard-schema.ts
src/server/username.ts
src/server/profanity.ts
src/server/rate-limit.ts
```

Responsibilities:

- `leaderboard.ts`: DB queries and rank calculation.
- `leaderboard-schema.ts`: request parsing/validation.
- `username.ts`: normalize and validate display names.
- `profanity.ts`: offline denylist filter.
- `rate-limit.ts`: small in-memory IP/device throttle.

Keep modules small and dependency-light.

## Client modules

Add:

```text
src/leaderboard.ts
src/leaderboard-dialog.ts
```

Responsibilities:

- Fetch top scores.
- Submit score.
- Show submit form after result.
- Show leaderboard list per game.
- Hide gracefully when server/API unavailable.

Possible UI:

- Add `Leaderboard` button near `History`.
- Add `Submit score` in result modal for eligible results.
- Add top 10 list with rank, username, score, difficulty/date.

## Validation details

Server must validate:

- Known game id.
- Known difficulty if present.
- Known outcome.
- Numeric fields finite integers and sane ranges.
- Metric exists for game.
- Submitted result qualifies for leaderboard.
- Metadata is small and JSON-safe.
- Username passes normalization/profanity rules.

Client validation is only UX. Server validation is source of truth.

## Rate limiting

Simple first pass:

- In-memory token bucket by IP and optional device id.
- Example: 10 submissions per 5 minutes.
- Example: 60 leaderboard reads per minute.

This resets on server restart, acceptable for MVP.

Later if needed, persist rate limits in SQLite.

## Privacy

Public leaderboard stores:

- display username
- score/result fields
- timestamp
- game id/difficulty

Do not publicly show:

- device id
- IP address
- raw sync data

Avoid storing IP unless needed for moderation. Prefer transient in-memory rate limit only.

## Implementation phases

### Phase 1: Server foundation

- Add migration `002_leaderboard.sql`.
- Add leaderboard table to schema bootstrap.
- Add DB methods for insert/list/rank.
- Add unit tests with `GameDatabase(":memory:")`.

Acceptance:

- Can insert valid leaderboard score.
- Can list top scores by game.
- Rank calculation works.
- Duplicate `(deviceId, runId)` no-ops or returns existing entry.

### Phase 2: Username moderation

- Implement username normalize/validate.
- Add reserved-name list.
- Add offline denylist module.
- Add tests for allowed/rejected names.

Acceptance:

- Repeated usernames allowed.
- Reserved/offensive/URL/control-char names rejected.
- Error remains generic.

### Phase 3: API routes

- Add `GET /api/leaderboard`.
- Add `POST /api/leaderboard`.
- Add request parsing and response helpers.
- Add simple in-memory rate limit.

Acceptance:

- Invalid payload returns 400.
- Bad username returns 400 with generic error.
- API returns top 10.
- API not cached by service worker.

### Phase 4: Client UI

- Add `Leaderboard` button in game nav.
- Add leaderboard dialog.
- Add submit action after result saved.
- Reuse existing modal/dialog styling.

Acceptance:

- User can submit eligible score after finishing game.
- Leaderboard shows submitted score.
- Repeated username entries appear separately.
- Static/no-server mode degrades cleanly.

### Phase 5: Game-specific eligibility

Implement first:

1. Tetris
2. Snake
3. 2048
4. Breakout
5. Space Invaders

Then evaluate puzzle/board games.

Acceptance:

- Each included game has clear metric/direction.
- Server rejects missing metric values.
- UI labels metric clearly.

### Phase 6: Polish and moderation tools

- Add clear/delete helper task or documented SQLite command.
- Add optional admin-only delete endpoint only if a simple secret env var is acceptable.
- Add better empty/error states.
- Add README docs.

## Tests

Run:

```bash
mise run check
```

Add unit tests for:

- username normalization.
- profanity/reserved-name rejection.
- leaderboard DB insert/list/rank.
- duplicate run handling.
- request parsing.
- impossible value rejection.

Add e2e tests for:

- finish/submit flow on one game if practical.
- leaderboard dialog loads and displays seeded API data.
- bad username shows generic error.

## Open questions

- Which games launch with public leaderboards?
- Should local two-player/board games be excluded from public scores?
- Should leaderboard separate by difficulty, or show difficulty as a filter?
- Should score submission be automatic prompt or manual button only?
- How large should top list be: 10, 25, 50?

## Recommended MVP answer

Build first version with:

- Repeated usernames allowed.
- No auth.
- Offline username denylist.
- Tetris + Snake + 2048 leaderboards first.
- Top 10 per game/difficulty.
- Bun SQLite only.
- Local-first game data unchanged.
