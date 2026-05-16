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
  - Keep `index.ts` as the UI/controller wiring.
  - Put deterministic rules, movement, scoring, collision, parsing helpers, and other testable code in `logic.ts` before adding new shared abstractions.

## Features

- Local result history and formatting: `src/features/results/`
- Browser-local leaderboards: `src/features/leaderboard/`
- Online multiplayer client flow/protocol/countdown: `src/features/multiplayer/`
- Bot streak state: `src/features/bot-streaks/`

## Server

- Node server entrypoint: `src/server/index.ts`
- Server-side multiplayer rooms/adapters: `src/server/multiplayer/`
- Request utilities: `src/server/http.ts`, `src/server/rate-limit.ts`

## Tests

- Unit tests: `test/`
- Browser/e2e tests: `e2e/`

Imports use aliases from `tsconfig.json`: `@app`, `@shared`, `@ui`, `@games`, `@features`, and `@server`.
