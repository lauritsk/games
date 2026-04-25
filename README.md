<h1 align="center">
  <img src="src/favicon.svg" alt="Games" width="64" height="64" />
  <br />
  Games
</h1>

<p align="center">
  A small, fast collection of browser-playable games built with Bun, TypeScript, and plain CSS.
</p>

## Features

- 9 games: Connect 4, Minesweeper, 2048, Tic-Tac-Toe, Snake, Memory, Tetris, Breakout, and Space Invaders.
- No framework runtime: simple TypeScript modules, DOM helpers, and CSS themes.
- Keyboard-first play with mouse/touch support where it fits each game.
- Shared arcade helpers for fixed-step loops, collisions, held-key input, pause overlays, and touch controls.
- Unit tests for game logic plus Playwright coverage for browser behavior.
- Static builds and a Docker image for simple deployment.
- Local-first saves/results with optional Bun SQLite sync when served by the included Bun server.

## Demo locally

> [!NOTE]
> This project uses `mise` to pin and run tools. Prefer `mise run <task>` over calling tools directly.

```bash
mise install
mise run dev
```

Open <http://localhost:3000>.

## Available games

| Game | Notes |
| --- | --- |
| Connect 4 | Local play against a bot with difficulty-aware moves. |
| Minesweeper | Reveal/flag puzzle with scalable difficulty. |
| 2048 | Sliding tile puzzle with keyboard controls. |
| Tic-Tac-Toe | Easy, medium, hard bot plus local two-player mode. |
| Snake | Speed and wall behavior change by difficulty. |
| Memory | Concentration card matching with variable pair count. |
| Tetris | Bag pieces, rotation, line clears, levels, pause, and next preview. |
| Breakout | Paddle-and-brick arcade play with level progression. |
| Space Invaders | Cannon, waves, barriers, and descending alien formation. |

## Commands

| Command | Description |
| --- | --- |
| `mise run dev` | Start the Bun dev server with HMR at <http://localhost:3000>. |
| `mise run db:migrate` | Create or migrate the Bun SQLite sync database. |
| `mise run build` | Build the static app into `dist/`. |
| `mise run build:server` | Build the Bun server bundle into a temporary directory. |
| `mise run build:single` | Build a standalone single-file browser artifact into `dist-single/`. |
| `mise run test` | Run Bun unit tests. |
| `mise run test:e2e` | Build and run Playwright browser tests. |
| `mise run test:watch` | Run unit tests in watch mode. |
| `mise run lint` | Run hk-managed format/lint checks. |
| `mise run fix` | Run hk-managed fixers. |
| `mise run check` | Run lint, unit tests, build, and e2e tests. |
| `mise run docker:push` | Build and push the multi-arch Docker image as `docker.io/lauritsk/games:latest`. |
| `mise run docker:up` | Run the app with Docker Compose on port 3000. |

## Project structure

```text
.
├── index.html              # Bun HTML bundler entrypoint
├── src/
│   ├── main.ts             # App shell, hash routing, game selection
│   ├── server.ts           # Bun dev/production server
│   ├── games.ts            # Game registry
│   ├── games/              # Game UIs and pure logic modules
│   ├── arcade.ts           # Shared arcade loop, geometry, and controls
│   ├── core.ts             # Shared types and DOM/game helpers
│   └── styles.css          # Shared styles and theme tokens
├── test/                   # Bun unit tests
├── e2e/                    # Playwright tests
├── Dockerfile
├── compose.yaml
└── mise.toml               # Tool versions and tasks
```

## Add a game

1. Create a game UI module in `src/games/<game>.ts` that exports a `GameDefinition`.
2. Put non-trivial pure logic in `src/games/<game>.logic.ts`.
3. Add deterministic tests in `test/`.
4. Register the game in `src/games.ts`.
5. Reuse shared helpers from `src/core.ts`, `src/arcade.ts`, `src/keyboard.ts`, and `src/game-input.ts` where possible.
6. Run `mise run check` before opening a PR.

Themes are shared tokens in `src/styles.css` and selected by each game's `theme` field. Current theme names include `deep-cave`, `deep-ocean`, `outer-space`, and `deep-forest`.

## State and sync

The browser keeps game preferences, saves, and result history in `localStorage` first. When served by `src/server.ts`, the app also syncs that local data to Bun's native SQLite driver (`bun:sqlite`) through `/api/sync`.

Default database path:

```bash
GAMES_DB_PATH=data/games.sqlite
```

Create the database manually, or let the server create it on first request:

```bash
mise run db:migrate
```

Static hosting still works, but sync is disabled because there is no `/api/sync` server.

## Deployment

Build static assets:

```bash
mise run build
```

Serve `dist/` with any static host, or run the included container. For persistent sync storage, mount `/app/data` or set `GAMES_DB_PATH` to a persistent SQLite path:

```bash
mise run docker:up
```
