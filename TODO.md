# TODO

## Games to add

- [x] Tic-Tac-Toe
  - Easy / Medium / Hard bot
  - Local two-player option

- [x] Snake
  - Keyboard controls
  - Difficulty controls speed

- [x] Memory / Concentration
  - Difficulty controls pair count

- [x] 2048
  - Difficulty controls board size or target tile

- [ ] Checkers
  - Local two-player first
  - Bot later

## Code quality fixes

- [x] Replace per-game global `document.addEventListener("keydown", ...)` with scoped input manager.
  - Use one active handler per route/game.
  - Prefer `AbortController` cleanup per mount.

- [x] Stop rebuilding whole game boards on every render.
  - Create cells once, update text/dataset/disabled state.
  - Or use board-level event delegation to avoid reattaching click handlers.

- [x] Split game modules into cleaner layers.
  - Pure state/reducer logic.
  - DOM renderer.
  - Input adapter.
  - Sound/effect adapter.

- [x] Extract repeated game UI boilerplate.
  - Difficulty button behavior.
  - Reset/new-game confirmation.
  - Shared key handling for difficulty/reset.
  - Mount/unmount cleanup helpers.

- [x] Clarify mutating helper APIs.
  - Rename in-place helpers like `shuffle`, `dropConnect4Disc`, `floodOpenMinesweeper`.
  - Or convert helpers to immutable return-new-state style.

- [x] Inject RNG into random logic for deterministic tests/replays.
  - `shuffle`
  - 2048 tile spawning
  - Snake food spawning
  - Connect 4 random moves
  - Tic-Tac-Toe random moves

- [x] Reduce non-null assertions.
  - Replace board/index `!` access with bounds helpers or stronger board types.
  - Keep `noUncheckedIndexedAccess` useful.

- [x] Add board/state invariants.
  - Validate 2048 square boards.
  - Validate Connect 4 dimensions/columns.
  - Validate Tic-Tac-Toe board length.
  - Prefer opaque board constructors where practical.

- [x] Improve confirm dialog accessibility.
  - Use native `<dialog>` or focus trap helper.
  - Move focus into dialog on open.
  - Restore previous focus on close.
  - Avoid broad `stopImmediatePropagation` if possible.

- [ ] Add Playwright browser tests later.
  - Reset confirmation flow.
  - Key routing.
  - Bot timers.
  - Difficulty changes during active games.
  - Snake timer cleanup.
  - Memory pending timeout cleanup.
