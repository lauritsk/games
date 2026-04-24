# TODO

## Current library

Implemented games:

- [x] Connect 4
- [x] Minesweeper
- [x] 2048
- [x] Tic-Tac-Toe
  - Easy / Medium / Hard bot
  - Local two-player option
- [x] Snake
  - Keyboard controls
  - Difficulty controls speed
- [x] Memory / Concentration
  - Difficulty controls pair count

## Roadmap

### Phase 1 — Ship high-value classics

Build these first because they fit current patterns or unlock reusable systems for later games.

- [x] Tetris
  - Pure logic: board, tetromino bag, rotate, collide, lock, clear lines.
  - Tests: rotation, wall kicks, line clears, level speed, game over.
  - UI: board renderer, next-piece preview, score, level, pause.
  - Later: hold piece.

- [x] Breakout / Arkanoid
  - Paddle at bottom; ball destroys top bricks.
  - Increasingly difficult levels.
  - Shared playfield/collision helpers where useful.
  - Later: power-ups and multi-ball.

- [x] Space Invaders
  - Player cannon vs descending alien formation.
  - Shots, barriers, waves, level speed-up.
  - Reuse fixed-step loop and keyboard helpers.

### Phase 2 — Extract arcade foundations

Do this after the first arcade game exposes real needs, before adding more physics/action games.

- [x] Fixed-step arcade loop helper
  - `startFixedStepLoop(update, render, fps)` with cleanup.
  - Pause/resume/reset hooks.
  - Route-change cleanup.
  - Deterministic tests where practical.

- [x] Collision and geometry helpers
  - Rect overlap.
  - Circle/rect or ball/paddle response.
  - Bounds wrapping/clamping.
  - Vector helpers if Asteroids needs them.

- [x] Held-key input helper
  - Scoped listeners with cleanup.
  - Arrow/WASD mapping.
  - Prevent repeat bugs and stale key state after blur.

- [x] Shared arcade UI pieces
  - Score/lives/level display.
  - Pause overlay.
  - Touch controls where needed.

### Phase 3 — More arcade/action games

- [ ] Ballz / Bricks n Balls
  - Aim and shoot one or more balls upward.
  - Blocks descend each turn.
  - Extra balls unlock as score increases.
  - Game over when blocks reach the bottom.

- [ ] Asteroids
  - Rotate/thrust ship controls.
  - Bullets, asteroid splitting, waves.
  - Screen wrapping and collision helpers.

- [ ] Frogger
  - Cross traffic and rivers.
  - Timing-based lanes, logs, safe homes.
  - Increasing speed/density.

- [ ] Pac-Man style maze chase
  - Pellets, power pellets, ghosts.
  - Simple ghost AI first.
  - Maze graph/pathfinding helper if useful.

### Phase 4 — Board and card games

- [ ] Checkers
  - Pure move generator first.
  - Local two-player.
  - Forced captures and kinging rules.
  - Bot later.

- [ ] Solitaire
  - Klondike draw-one first.
  - Pure deck/tableau/foundation logic.
  - Click-to-move before drag-and-drop.
  - Tests for legal moves and win detection.

## Per-game definition of done

- [ ] Pure game logic lives in `src/games/<game>.logic.ts` when non-trivial.
- [ ] Logic has deterministic unit tests.
- [ ] Game registers in `src/games.ts`.
- [ ] Difficulty setting changes meaningful gameplay.
- [ ] Keyboard controls work where expected.
- [ ] Mouse/touch controls work where expected.
- [ ] Timers, intervals, animation frames, listeners, and pending timeouts clean up on route change.
- [ ] Game over, reset, and difficulty-change flows are accessible.
- [ ] `mise run check` passes.

## Quality backlog

Completed cleanup:

- [x] Replace per-game global `document.addEventListener("keydown", ...)` with scoped input manager.
- [x] Stop rebuilding whole game boards on every render.
- [x] Split game modules into cleaner layers.
- [x] Extract repeated game UI boilerplate.
- [x] Clarify mutating helper APIs.
- [x] Inject RNG into random logic for deterministic tests/replays.
- [x] Reduce non-null assertions.
- [x] Add board/state invariants.
- [x] Improve confirm dialog accessibility.

Future cleanup:

- [x] Add Playwright browser tests.
  - Reset confirmation flow.
  - Key routing.
  - Bot timers.
  - Difficulty changes during active games.
  - Snake timer cleanup.
  - Memory pending timeout cleanup.
  - Arcade loop cleanup once added.
  - Added `mise run test-e2e`; `mise run check` runs browser coverage.

- [x] Review shared styling after several new games.
  - Avoid one-off CSS per game unless needed.
  - Keep theme tokens reusable.
  - Add new themes only when they serve distinct game moods.
  - Current CSS already centralizes shell, board sizing, controls, surfaces, and theme tokens; remaining per-game selectors are limited to distinct board/cell visuals.

- [x] Consider a game template/generator after 2–3 more games.
  - Scaffold game file, logic file, test file, and registry import.
  - Only add if repetition becomes real.
  - Decision: defer generator until another batch of games creates stable scaffolding needs; existing helpers cover current repetition.
