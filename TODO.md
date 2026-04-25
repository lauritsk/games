# TODO

This file is the stable implementation queue. `PLAN.md` is an ephemeral whiteboard for planning the next TODO item: rewrite it freely after each item is finished instead of treating it as permanent documentation.

## Current baseline

- Stack: Bun, TypeScript, plain DOM/CSS, no frontend framework runtime.
- Tooling: use `mise install` and `mise run <task>` only; main gate is `mise run check`.
- Implemented games: Connect 4, Minesweeper, 2048, Tic-Tac-Toe, Snake, Memory, Tetris, Breakout, Space Invaders.
- Shared foundations already exist:
  - scoped keyboard/input helpers
  - fixed-step arcade loop helpers
  - collision/geometry helpers
  - shared game UI, modals, history, pause overlays, touch controls, themes
  - pure logic modules and unit tests for non-trivial games
  - Playwright e2e coverage
- State already exists:
  - local preferences, saves, result history, and result-clear records
  - `runId`-based result de-dupe
  - Bun SQLite sync via `/api/sync`
  - static hosting fallback with sync disabled
- Service worker should continue caching app assets only; never cache API/game data responses.

## Next focus: public leaderboards

Build casual arcade-style public leaderboards on top of existing local result history and Bun SQLite sync. No accounts, passwords, or ownership model.

MVP decisions:

- Repeated usernames are allowed.
- Submission is manual after a saved local result.
- Launch first for score-based games: Tetris, Snake, 2048, Breakout, Space Invaders.
- Top list defaults to top 10 per game and difficulty.
- Score sorting is server-side config only; never trust client-provided sort direction.
- Static/no-server mode hides or disables leaderboard features cleanly.
- Server validation is authoritative; client validation is UX only.

### Phase 1 — Server data foundation

- [ ] Add `migrations/002_leaderboard.sql` for public score rows.
- [ ] Extend `src/server/schema.ts` bootstrap with leaderboard schema.
- [ ] Add leaderboard types/config for eligible games, metric, direction, and value limits.
- [ ] Add `GameDatabase` methods to:
  - [ ] insert a leaderboard entry
  - [ ] return existing entry on duplicate `(deviceId, runId)`
  - [ ] list top entries by game/difficulty
  - [ ] calculate rank safely for max/min metrics
- [ ] Add unit tests using `GameDatabase(":memory:")` for insert, list, rank, and duplicate run handling.

### Phase 2 — Username and payload validation

- [ ] Add username normalization/validation:
  - trim, `NFKC`, collapse spaces
  - 3-16 visible chars
  - letters, numbers, spaces, `_`, `-`
  - reject control chars, URLs/emails, reserved names, offensive names
  - return generic `Choose another name.` errors
- [ ] Add small offline denylist module; no external moderation API for MVP.
- [ ] Add server request parsing for leaderboard submissions and queries.
- [ ] Validate known game id, difficulty, outcome, metric field, metadata size, finite integer ranges, and result eligibility.
- [ ] Add tests for accepted/rejected usernames and invalid payloads.

### Phase 3 — API routes

- [ ] Add `GET /api/leaderboard?gameId=<id>&difficulty=<difficulty>&limit=10`.
- [ ] Add `POST /api/leaderboard`.
- [ ] Add small in-memory rate limit for reads and submissions by IP and optional device id.
- [ ] Keep responses `cache-control: no-store`.
- [ ] Return clear API errors without leaking moderation rule details.
- [ ] Add tests for route success, invalid payloads, bad usernames, duplicate submissions, and top 10 reads.

### Phase 4 — Client leaderboard UI

- [ ] Add client API module for status/list/submit operations.
- [ ] Add leaderboard dialog using existing modal/history styling.
- [ ] Add `Leaderboard` action near `History` in game UI/navigation.
- [ ] Add `Submit score` action in the result-saved history modal for eligible results.
- [ ] Show rank, username, metric value, difficulty, and date.
- [ ] Show useful loading, empty, offline, and error states.
- [ ] Render all public username/metadata text with `textContent` only.
- [ ] Add e2e coverage for dialog load and one submit flow.

### Phase 5 — Game rollout

- [ ] Tetris: score max, metadata lines/level.
- [ ] Snake: score max, metadata length if useful.
- [ ] 2048: score max, metadata max tile.
- [ ] Breakout: score max, metadata level/lives.
- [ ] Space Invaders: score max, metadata wave/lives.
- [ ] Revisit puzzle/board games after arcade metrics feel stable:
  - Minesweeper: winning duration min.
  - Memory: moves min, tie-break duration.
  - Tic-Tac-Toe and Connect 4: likely skip public leaderboards unless there is a compelling metric.

### Phase 6 — Polish, docs, operations

- [ ] Document leaderboard behavior in `README.md`.
- [ ] Document moderation/admin cleanup path, either SQLite command or tiny admin helper.
- [ ] Add a `mise` task for any repeated admin/test workflow; do not require manual tool commands.
- [ ] Confirm Docker/server build includes migrations and works with `GAMES_DB_PATH`.
- [ ] Run `mise run check` before considering the feature done.

## Later game backlog

Implement after leaderboard MVP unless priorities change.

- [ ] Ballz / Bricks n Balls
  - Turn-based aiming and multi-ball shots.
  - Blocks descend each turn.
  - Extra balls unlock as score increases.
- [ ] Asteroids
  - Rotate/thrust ship controls.
  - Bullets, asteroid splitting, waves.
  - Screen wrapping and vector collision helpers.
- [ ] Frogger
  - Traffic, rivers, logs, safe homes.
  - Timing lanes with speed/density progression.
- [ ] Pac-Man style maze chase
  - Pellets, power pellets, ghosts.
  - Simple ghost AI first; add maze graph/pathfinding only if needed.
- [ ] Checkers
  - Pure move generator first.
  - Local two-player, forced captures, kinging.
  - Bot later.
- [ ] Solitaire
  - Klondike draw-one first.
  - Pure deck/tableau/foundation logic.
  - Click-to-move before drag-and-drop.

## Definition of done for new work

- [ ] Pure non-trivial game/domain logic lives in focused modules and has deterministic unit tests.
- [ ] UI uses shared helpers/styles before adding one-off code.
- [ ] Keyboard, mouse, touch, pause/reset, and difficulty flows are accessible where applicable.
- [ ] Timers, intervals, animation frames, listeners, and pending timeouts clean up on route change.
- [ ] Local-first behavior keeps working when the server/API is unavailable.
- [ ] New routes validate input server-side and return `no-store` API responses.
- [ ] `mise run check` passes.
