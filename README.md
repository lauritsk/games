# Games

A small collection of browser games built with TypeScript, Vite, and plain CSS.

## Play locally

```bash
mise install
mise run dev
```

Open <http://localhost:3000>.

## Games

- Connect 4
- Minesweeper
- 2048
- Tic-Tac-Toe
- Snake
- Memory
- Tetris
- Breakout
- Ballz
- Space Invaders
- Asteroids
- Frogger
- Maze Chase

Some games have local multiplayer, bots, saves, leaderboards, or online private rooms when the Node server is running.

## Commands

```bash
mise run dev              # start dev server
mise run build            # build static app
mise run test             # run unit tests
mise run test:e2e         # run browser tests
mise run lint             # lint/format check
mise run fix              # run fixers
mise run check            # lint, test, build, e2e
mise run docker:up        # run with Docker Compose
```

## Structure

```text
src/
  app/          app shell and routing
  features/     results, leaderboards, multiplayer
  games/        game implementations
  server/       Node/WebSocket server for online rooms
  shared/       shared helpers
  ui/           styles, assets, sounds

test/           unit tests
e2e/            Playwright tests
docs/           extra notes
```

## Add a game

1. Create `src/games/<game>/index.ts` exporting a `GameDefinition`.
2. Put reusable game logic in `src/games/<game>/logic.ts`.
3. Add tests in `test/`.
4. Register it in `src/games/index.ts`.
5. Run `mise run check`.

## Multiplayer

Online rooms need the included Node/WebSocket server. Static hosting still works for local play, but not live multiplayer.

Rooms are in memory only, so they disappear when the server restarts.
