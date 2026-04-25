<h1 align="center">
  <img src="src/ui/favicon.svg" alt="Games" width="64" height="64" />
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
- Public leaderboards for scores, fastest times, and bot win streaks when the Bun server is available.
- Live private-room 1v1 multiplayer for Tic-Tac-Toe and Connect 4 when the Bun server is available.

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
| Connect 4 | Bot, local two-player, and private-room online 1v1 with difficulty-aware bot moves. |
| Minesweeper | Reveal/flag puzzle with scalable difficulty. |
| 2048 | Sliding tile puzzle with keyboard controls. |
| Tic-Tac-Toe | Easy, medium, hard bot plus local and private-room online two-player modes. |
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
│   ├── app/                # Browser app shell, hash routing, game selection
│   ├── features/           # Results, leaderboards, sync, multiplayer, bot streaks
│   ├── games/              # Game registry plus one folder per game
│   │   ├── shared/         # Game-only helpers: arcade, controls, layout, saves
│   │   └── <game>/         # `index.ts` UI and `logic.ts` pure rules
│   ├── server/             # Bun API/server, DB, leaderboard, multiplayer rooms
│   ├── shared/             # Generic DOM, modal, keyboard, storage, type helpers
│   └── ui/                 # Theme/assets/styles/PWA/sound/visual feedback
├── test/                   # Bun unit tests
├── e2e/                    # Playwright tests
├── Dockerfile
├── compose.yaml
└── mise.toml               # Tool versions and tasks
```

See `docs/architecture.md` for a quick "where do I edit?" map.

## Add a game

1. Create a game UI module in `src/games/<game>/index.ts` that exports a `GameDefinition`.
2. Put non-trivial pure logic in `src/games/<game>/logic.ts`.
3. Add deterministic tests in `test/`.
4. Register the game in `src/games/index.ts`.
5. Reuse helpers from `@shared/core`, `@games/shared/arcade`, `@games/shared/controls`, `@games/shared/game-input`, and `@shared/keyboard` where possible.
6. Check the new game acceptance checklist in `CONTRIBUTING.md`.
7. Run `mise run check` before opening a PR.

Themes are shared tokens in `src/ui/styles.css` and selected by each game's `theme` field. Current theme names include `deep-cave`, `deep-ocean`, `outer-space`, and `deep-forest`.

## State and sync

The browser keeps game preferences, saves, and result history in `localStorage` first. When served by `src/server/index.ts`, the app also syncs that local data to Bun's native SQLite driver (`bun:sqlite`) through `/api/sync`.

Default database path:

```bash
GAMES_DB_PATH=data/games.sqlite
```

Create the database manually, or let the server create it on first request:

```bash
mise run db:migrate
```

Static hosting still works, but sync, public leaderboards, and live multiplayer are disabled because there is no API server.

## Live multiplayer

When served by `src/server/index.ts`, Tic-Tac-Toe and Connect 4 support casual live 1v1 rooms:

1. Open a supported game.
2. Select `Play online`.
3. Create a room and share the 6-character code, or join with a code from another player.

Room codes use a cryptographically random ambiguity-safe base32 alphabet such as `K7P9Q2`. Each player also receives a separate high-entropy session token that is required for the WebSocket connection and reconnects. The server enforces room capacity, turn order, move validation, short request rate limits, and room cleanup TTLs.

Multiplayer rooms are process-local memory only in v1. They disappear when the Bun server restarts, and they are intended for friendly private games rather than strong anti-cheat. Online results can appear in local history but are not eligible for public leaderboards.

Static builds cannot host live multiplayer because they have no WebSocket/API server.

## Leaderboards

When served by `src/server/index.ts`, games can publish one primary leaderboard metric per game:

- Score leaderboards rank higher values first.
- Fastest-time leaderboards rank lower durations first.
- Bot win-streak leaderboards rank consecutive wins against the bot, separated by game and difficulty.

Tic-Tac-Toe and Connect 4 streaks are only eligible in `Vs bot` mode. A bot win increments the current streak for that game and difficulty. A bot loss, draw, or abandoned active bot game resets the current streak; leaving a saved game to resume later does not. Current streak state is device-local; submitted result history can still sync. Local two-player results stay in history but are not public-leaderboard eligible.

Leaderboard submissions use a display name plus the local device/run id to prevent duplicate submissions for the same finished run. They are intended as casual, friendly rankings: the server validates payload shape, ranges, allowed outcomes, duplicate runs, and basic moderation rules, but it does not provide strong anti-cheat.

### Moderation and cleanup

Leaderboard rows live in the `leaderboard_scores` SQLite table. To remove a bad public row, connect to the database configured by `GAMES_DB_PATH`, inspect the row, then delete it by `id`:

```sql
SELECT id, game_id, username, metric, metric_value, created_at
FROM leaderboard_scores
ORDER BY created_at DESC
LIMIT 20;

DELETE FROM leaderboard_scores
WHERE id = 'leaderboard-id-to-remove';
```

Create a backup before manual cleanup. Restart is not required because reads query SQLite directly.

## Deployment

Build static assets:

```bash
mise run build
```

Serve `dist/` with any static host, or run the included container. For persistent sync storage, mount `/app/data` or set `GAMES_DB_PATH` to a persistent SQLite path:

```bash
mise run docker:up
```
