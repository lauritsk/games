# Statefulness Plan

## Goal

Add statefulness without turning small static game collection into heavy backend app.

Primary user stories:

- Remember difficulty and game options after browser reload.
- Save in-progress games and resume after reload/navigation.
- Store game score/result history.
- Leave room for future offline support, IndexedDB, or server SQLite without rewrites.

## Recommendation

Use local-first persistence.

| Need | Best first storage | Why |
| --- | --- | --- |
| Difficulty/options | `localStorage` | Tiny, sync, already used for appearance. |
| Current game save | `localStorage` | Snapshots are small and JSON-friendly. |
| Score/result history | bounded `localStorage` array | Simple, enough for first version. |
| Large history/replays/multiple slots | IndexedDB later | Better for lots of records or large payloads. |
| Cross-device sync/leaderboards | server SQLite later | Requires backend/API/auth/deployment storage. |
| Offline asset caching | Cache API/service worker later | Cache app files only, not game state. |

Do not start with server SQLite. Current app is static-first. Backend persistence adds complexity not needed for local reload/resume/history.

## Current app notes

Relevant files:

- `src/main.ts`: app shell, hash routing, mounts/unmounts games.
- `src/types.ts`: `GameDefinition`, `Difficulty`, shared types.
- `src/appearance.ts`: existing `localStorage` pattern for appearance.
- `src/progress.ts`: `started`/`finished` dataset helpers.
- `src/games/controls.ts`: shared difficulty/mode/reset controls.
- `src/games/*.ts`: game UI/state modules.
- `src/games/*.logic.ts`: serializable pure logic for many games.
- `src/server.ts`: static Bun server, no DB/API today.

## Design principles

1. Local-first: app works offline-ish and without account.
2. Version every stored object.
3. Never store DOM nodes, timers, RAF IDs, listeners, `AbortController`, media queries, or held-key state.
4. Store only serializable game model state.
5. Restore realtime games paused, never auto-running.
6. Clear saves when game finishes or new game starts.
7. Throttle autosave for realtime games.
8. Treat stored data as untrusted: validate enough, ignore corrupt data.
9. Keep per-game save shape owned by each game.
10. Add server sync later as optional mirror, not source of truth.

## New modules

### `src/storage.ts`

Safe JSON wrapper around `localStorage`.

Responsibilities:

- Namespace keys.
- Read/write/remove JSON.
- Handle unavailable storage/private mode/quota errors.
- Validate version.
- Return fallback on parse error.

Suggested API:

```ts
export type StoredEnvelope<T> = {
  version: number;
  updatedAt: string;
  data: T;
};

export function readStored<T>(key: string, version: number): T | null;
export function writeStored<T>(key: string, version: number, data: T): boolean;
export function removeStored(key: string): void;
export function storageKey(...parts: string[]): string;
```

Key format:

```text
games:v1:preferences
games:v1:saves:<gameId>
games:v1:results
```

### `src/game-preferences.ts`

Persist game settings.

Suggested types:

```ts
export type GamePreferences = {
  difficulty?: Difficulty;
  options?: Record<string, string | number | boolean>;
};

export function loadGamePreferences(gameId: string): GamePreferences;
export function saveGamePreferences(gameId: string, preferences: GamePreferences): void;
export function updateGamePreferences(
  gameId: string,
  updater: (current: GamePreferences) => GamePreferences,
): void;
```

Possible stored object:

```json
{
  "version": 1,
  "updatedAt": "2026-04-25T00:00:00.000Z",
  "data": {
    "snake": {
      "difficulty": "Medium",
      "options": { "wallMode": "fatal" }
    },
    "tetris": {
      "difficulty": "Hard"
    }
  }
}
```

### `src/game-state.ts`

Persist one current save per game.

Suggested types:

```ts
export type GameSave<T> = {
  gameId: string;
  version: number;
  savedAt: string;
  status: "ready" | "playing" | "paused";
  payload: T;
};

export function loadGameSave<T>(gameId: string, version: number): GameSave<T> | null;
export function saveGameSave<T>(gameId: string, version: number, save: Omit<GameSave<T>, "gameId" | "version" | "savedAt">): void;
export function clearGameSave(gameId: string): void;
export function hasGameSave(gameId: string): boolean;
```

Autosave helper for realtime games:

```ts
export function createAutosave(options: {
  gameId: string;
  intervalMs?: number;
  save(): void;
  scope: MountScope;
}): { request(): void; flush(): void };
```

Autosave events:

- `pagehide`: flush.
- `visibilitychange` when hidden: flush.
- game pause: save immediately.
- game move/drop/tick: throttled save only.

### `src/game-results.ts`

Persist score/result history.

Suggested types:

```ts
export type GameOutcome = "won" | "lost" | "draw" | "completed";

export type GameResult = {
  id: string;
  gameId: string;
  finishedAt: string;
  durationMs?: number;
  difficulty?: Difficulty;
  outcome: GameOutcome;
  score?: number;
  moves?: number;
  level?: number;
  metadata?: Record<string, string | number | boolean>;
};

export function recordGameResult(result: Omit<GameResult, "id" | "finishedAt">): void;
export function listGameResults(gameId?: string): GameResult[];
export function clearGameResults(gameId?: string): void;
export function bestGameResult(gameId: string, metric: "score" | "moves" | "durationMs"): GameResult | null;
```

Bound history:

- Keep latest 250 total results, or latest 50 per game.
- If both limits used, prune by `finishedAt`.

## Preferences plan

Persist these now:

| Game | Preferences |
| --- | --- |
| Connect 4 | difficulty, mode (`bot`/`local`) |
| Minesweeper | difficulty |
| 2048 | difficulty |
| Tic-Tac-Toe | difficulty, mode (`bot`/`local`) |
| Snake | difficulty, wall mode (`fatal`/`teleport`) |
| Memory | difficulty |
| Tetris | difficulty |
| Breakout | difficulty |
| Space Invaders | difficulty |

Implementation pattern inside each game:

1. Load preferences at mount.
2. Validate enum values.
3. Initialize local `difficulty`/mode from preferences or default.
4. When control changes, save preferences and reset game.

Example pattern:

```ts
const preferences = loadGamePreferences("snake");
let difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
let wallMode = parseWallMode(preferences.options?.wallMode) ?? "fatal";

function setDifficulty(next: Difficulty): void {
  difficulty = next;
  saveGamePreferences("snake", { difficulty, options: { wallMode } });
}
```

Add helper validators:

```ts
export function parseDifficulty(value: unknown): Difficulty | null;
```

## Save/resume UX

### First version UX

Keep simple:

- If save exists when game mounts, restore automatically.
- Status text should show restored state if paused/ready.
- `New` button clears save via existing reset flow.
- Finished game clears save.

### Better later UX

Add reusable resume prompt:

- `Resume saved game?`
- Buttons: `Resume`, `New`, `Dismiss`.
- Show saved time.

Potential module:

```text
src/resume.ts
```

Potential API:

```ts
export function confirmResumeSave(options: {
  gameName: string;
  savedAt: string;
  onResume(): void;
  onNew(): void;
}): () => void;
```

## Save/resume per game

### 2048

Likely easy.

Save payload:

```ts
type Save2048 = {
  board: number[][];
  score: number;
  difficulty: Difficulty;
  size: number;
  started: boolean;
  finished: boolean;
};
```

Save when:

- after successful move
- after difficulty change/reset preferences
- on `pagehide`

Clear when:

- no moves/finished
- new game reset

Restore:

- board, score, difficulty, size
- progress flags from `started`/`finished`

Result history:

- outcome: `lost` or `completed` if max tile threshold/win exists
- score
- max tile metadata

### Minesweeper

Medium complexity; board must include mine layout.

Save payload:

```ts
type SaveMinesweeper = {
  difficulty: Difficulty;
  config: { rows: number; columns: number; mines: number };
  board: MinesweeperCell[][];
  state: "playing" | "won" | "lost";
  startedAt?: number;
  elapsedMs?: number;
};
```

Save when:

- after reveal
- after flag
- on page hide

Clear when:

- won/lost after result recorded
- new game reset

Restore:

- exact board with mines/revealed/flags/adjacent counts
- state
- difficulty

Result history:

- won/lost
- duration
- difficulty
- flags/revealed maybe metadata

### Memory

Medium easy.

Save payload:

```ts
type SaveMemory = {
  difficulty: Difficulty;
  cards: Card[];
  selectedIndexes: number[];
  matchedIndexes: number[];
  moves: number;
  startedAt?: number;
  elapsedMs?: number;
};
```

Important:

- Save shuffled card order.
- If two cards are temporarily face-up and timeout pending, restore them as selected or close them deterministically.

Save when:

- after card flip resolution
- after move count change
- page hide

Result history:

- won/completed
- moves
- duration

### Tic-Tac-Toe

Easy.

Save payload:

```ts
type SaveTicTacToe = {
  board: Mark[];
  current: Mark;
  mode: "bot" | "local";
  difficulty: Difficulty;
  winner: Mark | "draw" | null;
};
```

Save when:

- after every move
- after bot move
- after mode/difficulty change

Clear when:

- game finished after result recorded
- reset

Result history:

- won/lost/draw from human perspective in bot mode
- winner metadata
- moves
- mode/difficulty

### Connect 4

Easy.

Save payload:

```ts
type SaveConnect4 = {
  board: Connect4Player[][];
  current: Connect4Player;
  winner: Connect4Player | null;
  moves: number;
  mode: "bot" | "local";
  difficulty: Difficulty;
};
```

Save when:

- after every player move
- after bot move
- after mode/difficulty change

Result history:

- winner/lost/draw if draw exists
- moves
- mode/difficulty

### Snake

Harder because animation loop.

Save payload:

```ts
type SaveSnake = {
  difficulty: Difficulty;
  wallMode: "fatal" | "teleport";
  config: { size: number; speed: number };
  snake: SnakePoint[];
  food: SnakePoint;
  direction: Direction;
  queuedDirection: Direction;
  state: "ready" | "playing" | "won" | "lost";
  score: number;
};
```

Implementation notes:

- Add pause mode or restore `playing` as `ready` with message `Paused · press key to resume`.
- Do not store `animationFrame`, `lastFrameTime`, `tickRemainder`.
- On restore, no RAF running.
- Clear held key state.

Save when:

- throttled during play after ticks
- immediately on pause/visibility hidden/pagehide
- after food eaten

Clear when:

- won/lost after result recorded
- reset

Result history:

- score = snake length or food eaten
- won/lost
- difficulty/wall mode

### Tetris

Good candidate because `TetrisState` is serializable.

Save payload:

```ts
type SaveTetris = {
  difficulty: Difficulty;
  mode: "ready" | "playing" | "paused" | "over";
  state: TetrisState;
};
```

Restore rules:

- If saved mode was `playing`, restore as `paused`.
- Do not restore timer.
- User resumes with pause button or start action.

Save when:

- after hard drop
- after soft/drop tick, throttled
- on pause
- pagehide/visibility hidden

Clear when:

- over after result recorded
- reset

Result history:

- score
- lines
- level
- difficulty

### Breakout

Harder but feasible if state is serializable.

Save payload:

```ts
type SaveBreakout = {
  difficulty: Difficulty;
  mode: "ready" | "playing" | "paused" | "won" | "lost";
  state: BreakoutState;
};
```

State should include:

- ball position/velocity
- paddle position
- bricks
- score
- lives
- level/config-derived data if needed

Restore rules:

- `playing` becomes `paused`.
- Held keys not restored.
- Timer/loop not restored.

Save when:

- on pause
- throttled during play
- pagehide/visibility hidden

Result history:

- won/lost
- score
- lives
- level metadata

### Space Invaders

Harder due wave timer.

Save payload:

```ts
type SaveSpaceInvaders = {
  difficulty: Difficulty;
  mode: "ready" | "playing" | "paused" | "wave" | "lost";
  state: InvaderState;
};
```

State should include:

- player/cannon position
- bullets
- invaders
- barriers
- score
- lives
- wave
- formation direction/speed data if not derived

Restore rules:

- `playing` becomes `paused`.
- `wave` should become `paused` or deterministic ready-for-next-wave state; do not restore `setTimeout`.
- Timers/held keys not restored.

Save when:

- on pause
- throttled during play
- pagehide/visibility hidden

Result history:

- lost/completed if win condition exists
- score
- wave
- difficulty

## Result history details

### Recording rule

Call `recordGameResult()` close to `markGameFinished(shell)`.

Avoid duplicate result records:

- Use local boolean `resultRecorded` per mounted game, or
- clear save and set finished once, or
- have `recordGameResult` accept `runId` and dedupe.

Recommended: generate `runId` when new game starts/restores.

```ts
type GameRun = {
  runId: string;
  startedAt: number;
};
```

Store `runId` in save payload. Result history can dedupe by `runId`.

### Example records

Tetris:

```json
{
  "id": "uuid",
  "gameId": "tetris",
  "finishedAt": "2026-04-25T00:00:00.000Z",
  "difficulty": "Hard",
  "outcome": "lost",
  "score": 12000,
  "level": 7,
  "metadata": { "lines": 62 }
}
```

Memory:

```json
{
  "id": "uuid",
  "gameId": "memory",
  "finishedAt": "2026-04-25T00:00:00.000Z",
  "difficulty": "Medium",
  "outcome": "completed",
  "moves": 24,
  "durationMs": 91000
}
```

## Dashboard/UI ideas

Phase after data exists:

1. Dashboard card shows best stat:
   - Tetris: best score
   - Memory: best moves/time
   - Minesweeper: best time
   - Snake/Breakout/Invaders: best score
2. Game header shows `Best: X` pill.
3. Add `History` button per game.
4. Add result summary modal after finish.
5. Add clear history action with confirmation.
6. Add saved-game indicator on dashboard card.

## IndexedDB option

Do not implement now.

Use IndexedDB later if:

- result history grows past localStorage comfort,
- multiple save slots per game are desired,
- replay/event logs are stored,
- large analytics are added,
- import/export of complete DB is needed.

Potential stores:

```text
preferences
saves
results
events
```

Migration path:

1. Keep public API from `game-preferences.ts`, `game-state.ts`, `game-results.ts`.
2. Swap internals from localStorage to IndexedDB later.
3. On first IndexedDB load, migrate localStorage values.

## Server SQLite option

Do not implement now.

Use server SQLite later for:

- cloud sync,
- public/private leaderboards,
- accounts,
- cross-device saves,
- backup/restore.

Needed backend pieces:

```text
src/server/db.ts
src/server/api.ts
migrations/
data/games.sqlite
```

Possible schema:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE results (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  game_id TEXT NOT NULL,
  difficulty TEXT,
  outcome TEXT NOT NULL,
  score INTEGER,
  moves INTEGER,
  duration_ms INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE preferences (
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE saves (
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
```

API ideas:

```text
GET /api/results?gameId=tetris
POST /api/results
GET /api/preferences
PUT /api/preferences/:gameId
GET /api/saves/:gameId
PUT /api/saves/:gameId
DELETE /api/saves/:gameId
```

Concerns:

- Need auth or anonymous device id.
- Client results are cheat-able.
- Need migrations and backups.
- Need rate limiting if public.
- Docker/deploy needs persistent volume for SQLite file.

## Cache/offline option

Service worker/Cache API is separate from state.

Use for:

- offline app shell,
- faster repeat loads,
- installable PWA.

Do not use Cache API for:

- save games,
- score history,
- preferences.

Later files:

```text
src/service-worker.ts
public/manifest.webmanifest
```

## Implementation phases

### Phase 1: Storage primitives

Add:

```text
src/storage.ts
test/storage.test.ts
```

Tasks:

- implement `readStored`, `writeStored`, `removeStored`, `storageKey`.
- support version mismatch fallback.
- test corrupt JSON, missing key, version mismatch.

Run:

```bash
mise run test
mise run typecheck
```

### Phase 2: Preferences

Add:

```text
src/game-preferences.ts
```

Tasks:

- implement preference load/save.
- add `parseDifficulty` helper.
- wire all games to load difficulty.
- wire option modes for Snake, Tic-Tac-Toe, Connect 4.
- save on change.

Acceptance:

- Change difficulty, reload, same game keeps difficulty.
- Change Snake wall mode, reload, wall mode remains.
- Existing appearance storage still works.

### Phase 3: Result history

Add:

```text
src/game-results.ts
test/game-results.test.ts
```

Tasks:

- bounded result array.
- record on game finish.
- avoid duplicate records per run.
- expose list/best helpers.

Acceptance:

- Finish Tetris, reload, result still listed via helper.
- Result cap works.
- Corrupt history ignored/reset safely.

### Phase 4: Save/resume for turn-based games

Implement in order:

1. Tic-Tac-Toe
2. Connect 4
3. 2048
4. Memory
5. Minesweeper

Acceptance:

- Make move, reload, board restored.
- Press New, save cleared.
- Finish game, save cleared and result recorded.
- Difficulty/mode restored correctly.

### Phase 5: Save/resume for realtime games

Implement in order:

1. Tetris
2. Snake
3. Breakout
4. Space Invaders

Acceptance:

- Start game, play, reload, state restored paused.
- Resume continues from saved state.
- No auto-running after reload.
- No excessive localStorage writes during gameplay.
- Finish clears save and records result.

### Phase 6: UI polish

Tasks:

- saved-game badge on dashboard cards.
- best score/stat on dashboard cards.
- per-game `History` button.
- result summary after finish.
- clear history action.

### Phase 7: Optional offline/PWA

Tasks:

- add manifest.
- add service worker.
- cache built assets.
- verify state remains in localStorage modules, not Cache API.

### Phase 8: Optional backend sync

Tasks:

- design auth/device identity.
- add SQLite migrations.
- add API routes.
- sync local results/saves/preferences.
- preserve local-first behavior if server unavailable.

## Testing plan

### Unit tests

Add tests for:

- storage safe parse/write/remove.
- preference validation.
- result pruning/best lookup.
- save version mismatch.

### Game logic tests

Existing pure logic should stay unchanged when possible.

Add tests only if save serialization needs helpers, e.g.:

- `serializeTetrisState` / `parseTetrisSave`.
- `parseSnakeSave`.

### E2E tests

Add Playwright tests after first save/resume game:

1. Open 2048.
2. Make move.
3. Reload.
4. Assert score/board changed state persists.
5. Press New.
6. Reload.
7. Assert fresh board.

Add preferences e2e:

1. Open Snake.
2. Change difficulty/wall mode.
3. Reload.
4. Assert controls show same values.

Add realtime e2e later:

1. Open Tetris.
2. Move/drop piece.
3. Reload.
4. Assert mode paused/restored, not auto-running.

Run full check:

```bash
mise run check
```

## Migration/versioning

Initial versions:

```ts
const PREFERENCES_VERSION = 1;
const RESULTS_VERSION = 1;
const SAVE_VERSION = 1; // per game can differ
```

Per-game save versions:

```ts
const SAVE_VERSION = 1;
```

If shape changes:

- Prefer migration function if simple.
- Else ignore old save and clear it.
- Never crash because old save exists.

## Privacy/export ideas

Later optional:

- `Export data` button downloads JSON.
- `Import data` button validates and merges.
- `Clear all local data` button.

Useful because all data is local-first.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Corrupt localStorage breaks app | Safe parse + fallback + remove bad key. |
| Quota exceeded | Catch write error; keep game playable. |
| Realtime autosave too frequent | Throttle to 500-1000ms and flush on pagehide. |
| Old save shape crashes after deploy | Version saves and validate payload. |
| Duplicate score records | Use `runId` or local `resultRecorded` guard. |
| Restored timers behave wrong | Never store timers; restore paused. |
| Server data conflicts later | Local-first API boundary allows merge/sync later. |

## Best first PR sequence

1. `feat: add safe local storage helpers`
2. `feat: persist game preferences`
3. `feat: record local game results`
4. `feat: resume 2048 games after reload`
5. `feat: resume board games after reload`
6. `feat: resume tetris games paused after reload`
7. `feat: show saved games and best scores`

## Final direction

Build this now:

```text
localStorage:
  preferences
  one current save per game
  bounded result history
```

Keep this for later:

```text
IndexedDB:
  large history, multiple save slots, replay/event logs

Server SQLite:
  cloud sync, accounts, leaderboards

Cache API:
  offline assets only
```
