# Architecture map

Use this map to find likely edit points quickly.

## Browser app

- App shell, dashboard, hash routing: `src/app/`
- Theme, styles, PWA assets, sound, visual feedback: `src/ui/`
- Generic DOM/modal/keyboard/storage/types: `src/shared/`

## Games

- Game registry: `src/games/index.ts`
- Shared game helpers: `src/games/shared/`
  - Fixed-step loops, collisions, pause/touch controls: `arcade.ts`
  - Difficulty/reset/mode buttons: `controls.ts`
  - Saved games/run ids: `game-state.ts`
  - Preferences/difficulty parsing: `game-preferences.ts`
  - Board layout/progress/input/time helpers: `layout.ts`, `progress.ts`, `game-input.ts`, `game-time.ts`
- Individual games: `src/games/<game>/`
  - UI/controller: `index.ts`
  - Pure rules: `logic.ts`

## Features

- Local result history and formatting: `src/features/results/`
- Public leaderboards: `src/features/leaderboard/`
- Local/remote sync: `src/features/sync/`
- Online multiplayer client flow/protocol/countdown: `src/features/multiplayer/`
- Bot streak state: `src/features/bot-streaks/`

## Server

- Bun server entrypoint: `src/server/index.ts`
- API routes: `src/server/api.ts`
- SQLite wrapper/migrations/schema: `src/server/db.ts`, `src/server/migrate.ts`, `src/server/schema.ts`
- Server-side leaderboard validation/types: `src/server/leaderboard/`
- Server-side multiplayer rooms/adapters: `src/server/multiplayer/`
- Request utilities: `src/server/rate-limit.ts`, `src/server/username.ts`, `src/server/profanity.ts`

## Tests

- Unit tests: `test/`
- Browser/e2e tests: `e2e/`

Imports use aliases from `tsconfig.json`: `@app`, `@shared`, `@ui`, `@games`, `@features`, and `@server`.
