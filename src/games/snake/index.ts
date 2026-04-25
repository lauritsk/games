import { createPauseOverlay } from "@games/shared/arcade";
import {
  addTouchGestureControls,
  createGameShell,
  createMountScope,
  durationSince,
  el,
  gameLayouts,
  handleStandardGameKey,
  isFiniteNumber,
  isIntegerInRange,
  isRecord,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  parseOneOf,
  parseStartedAt,
  pauseOnFocusLoss,
  resetGameProgress,
  required,
  setBoardGrid,
  syncChildren,
  type Difficulty,
  type Direction,
  type GameDefinition,
} from "@shared/core";
import { createInvalidMoveFeedback } from "@ui/feedback";
import {
  loadGamePreferences,
  parseDifficulty,
  saveGamePreferences,
} from "@games/shared/game-preferences";
import { recordGameResult } from "@features/results/game-results";
import {
  clearGameSave,
  createAutosave,
  createRunId,
  loadGameSave,
  saveGameSave,
} from "@games/shared/game-state";
import {
  createMultiplayerCountdown,
  multiplayerCountdownText,
} from "@features/multiplayer/multiplayer-countdown";
import {
  canRequestMultiplayerRematch,
  canStartMultiplayerMatch,
  createMultiplayerActionButtons,
  multiplayerRematchActionLabel,
} from "@features/multiplayer/multiplayer-actions";
import {
  connectMultiplayerSession,
  type MultiplayerConnection,
  type MultiplayerConnectionStatus,
} from "@features/multiplayer/multiplayer";
import { renderMultiplayerPresence } from "@features/multiplayer/multiplayer-presence";
import {
  emptyMultiplayerSeatSnapshots,
  multiplayerJoinedSeatCount,
  multiplayerRematchStatusText,
  parseMultiplayerSeat,
  type MultiplayerRoomSnapshot,
  type MultiplayerRoomStatus,
  type MultiplayerSeat,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";
import { playSound } from "@ui/sound";
import {
  changeDifficulty,
  createDifficultyControl,
  createModeControl,
  createResetControl,
} from "@games/shared/controls";
import {
  moveSnakePoint,
  nextSnakeDirection,
  oppositeSnakeDirection,
  randomSnakeFood,
  snakeOutOfBounds,
  snakePointKey,
  snakePointsEqual,
  startSnakeBody,
  wrapSnakePoint,
  type SnakePoint,
} from "@games/snake/logic";
type State = "ready" | "playing" | "paused" | "won" | "lost";
type Config = { size: number; speed: number };
type SnakeCellState = {
  snake: boolean;
  head: boolean;
  food: boolean;
  owner: MultiplayerSeat | null;
  alive: boolean;
  yours: boolean;
};
type WallMode = "fatal" | "teleport";

type OnlineSnakePlayer = {
  seat: MultiplayerSeat;
  snake: SnakePoint[];
  direction: Direction;
  queuedDirection: Direction;
  alive: boolean;
  score: number;
};

type OnlineSnakeState = {
  size: number;
  food: SnakePoint;
  players: OnlineSnakePlayer[];
  winner: MultiplayerSeat | "draw" | null;
  tick: number;
  startedAt: number | null;
};

const configs: Record<Difficulty, Config> = {
  Easy: { size: 14, speed: 170 },
  Medium: { size: 18, speed: 115 },
  Hard: { size: 22, speed: 75 },
};
const gameId = "snake";
const savePayloadVersion = 1;

type SaveSnake = {
  difficulty: Difficulty;
  wallMode: WallMode;
  config: Config;
  snake: SnakePoint[];
  food: SnakePoint;
  direction: Direction;
  queuedDirection: Direction;
  state: State;
  score: number;
  startedAt: number | null;
};

const snakeGameDefinition: GameDefinition = {
  id: gameId,
  name: "Snake",
  tagline: "Eat, grow, do not crash.",
  players: "Solo or online (2-4)",
  theme: "deep-forest",
  mount: mountSnake,
};

export const snake = snakeGameDefinition;

export function mountSnake(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(gameId);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let wallMode: WallMode = parseWallMode(preferences.options?.wallMode) ?? "fatal";
  let config = configs[difficulty];
  let snake = startSnakeBody(config.size);
  let food = randomSnakeFood(config.size, snake);
  let direction: Direction = "right";
  let queuedDirection: Direction = direction;
  let state: State = "ready";
  let runId = createRunId();
  let startedAt: number | null = null;
  let onlineSession: MultiplayerSession | null = null;
  let onlineConnection: MultiplayerConnection | null = null;
  let onlineSeat: MultiplayerSeat | null = null;
  let onlineRevision = 0;
  let onlineStatus: MultiplayerConnectionStatus = "closed";
  let onlineRoomStatus: MultiplayerRoomStatus = "lobby";
  let onlineCountdownEndsAt: number | undefined;
  let onlineSeats = emptyMultiplayerSeatSnapshots();
  let onlineState: OnlineSnakeState | null = null;
  let onlineResultRecorded = false;
  let onlineError = "";

  const saved = loadGameSave(gameId, savePayloadVersion, parseSaveSnake);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    wallMode = saved.payload.wallMode;
    config = saved.payload.config;
    snake = saved.payload.snake;
    food = saved.payload.food;
    direction = saved.payload.direction;
    queuedDirection = saved.payload.queuedDirection;
    state = saved.payload.state === "playing" ? "paused" : saved.payload.state;
    startedAt = saved.payload.startedAt;
  }

  let animationFrame = 0;
  let lastFrameTime = 0;
  let tickRemainder = 0;
  let cells: HTMLDivElement[] = [];
  let renderedSize = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const {
    shell,
    status,
    actions,
    viewport,
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "snake-game",
    boardClass: "board--snake",
    boardLabel: "Snake board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;
  const onlinePresence = el("div", { className: "online-presence-host" });
  viewport.append(onlinePresence);

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const onlineCountdown = createMultiplayerCountdown(render);
  const difficultyControl = {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
      savePreferences();
    },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const overlay = createPauseOverlay(viewport, togglePause);
  const wallModeButton = createModeControl(actions, {
    get: () => wallMode,
    set: (next) => {
      wallMode = next;
      savePreferences();
    },
    next: (current) => (current === "fatal" ? "teleport" : "fatal"),
    label: wallModeLabel,
    reset: resetGame,
  });
  const {
    onlineButton,
    startOnlineButton,
    rematchButton,
    closeDialog: closeOnlineDialog,
  } = createMultiplayerActionButtons(actions, {
    game: snakeGameDefinition,
    getSession: () => onlineSession,
    onSession: startOnline,
    onStart: requestOnlineStart,
    onRematch: requestOnlineRematch,
  });
  const requestReset = createResetControl(actions, shell, resetGame);
  onDocumentKeyDown(onKeyDown, scope);
  addTouchGestureControls(
    grid,
    { onTap: activate, onSwipe: handleDirectionInput },
    { signal: scope.signal, touchAction: "none" },
  );
  pauseOnFocusLoss(scope, {
    isActive: () => !onlineSession && state === "playing",
    pause: togglePause,
  });
  const autosave = createAutosave({ gameId, scope, save: saveCurrentGame });

  function resetGame(): void {
    stopOnline();
    stopTimer();
    clearGameSave(gameId);
    resetGameProgress(shell);
    runId = createRunId();
    startedAt = null;
    config = configs[difficulty];
    snake = startSnakeBody(config.size);
    food = randomSnakeFood(config.size, snake);
    direction = "right";
    queuedDirection = direction;
    state = "ready";
    savePreferences();
    render();
  }

  function render(previousSnake?: SnakePoint[]): void {
    const size = currentBoardSize();
    const boardRebuilt = prepareBoard(size);
    status.textContent = statusText();
    renderMultiplayerPresence(onlinePresence, {
      gameId,
      session: onlineSession,
      seat: onlineSeat,
      status: onlineRoomStatus,
      seats: onlineSeats,
      countdown: onlineCountdownText(),
    });
    overlay.setVisible(!onlineSession && state === "paused");
    difficultyButton.textContent = onlineSession ? "Online" : difficulty;
    difficultyButton.disabled = Boolean(onlineSession);
    wallModeButton.textContent = onlineSession ? "Online" : wallModeLabel(wallMode);
    wallModeButton.disabled = Boolean(onlineSession);
    onlineButton.textContent = onlineSession ? `Room ${onlineSession.code}` : "Play online";
    onlineButton.disabled = Boolean(onlineSession);
    startOnlineButton.hidden = !onlineSession || onlineRoomStatus !== "lobby";
    startOnlineButton.disabled = !canOnlineStart();
    rematchButton.hidden = !isOnlineFinished();
    rematchButton.textContent = multiplayerRematchActionLabel(onlineSeat, currentSeatReady());
    rematchButton.disabled = onlineStatus !== "connected" || !canOnlineRematch();

    const onlineCells = onlineSession ? onlineCellStates() : null;
    const body = new Set(snake.map(snakePointKey));
    const origins = previousSnake ? segmentOrigins(previousSnake) : new Map<string, SnakePoint>();
    const head = snakePointKey(required(snake[0]));
    cells.forEach((cell, index) => {
      const point = { row: Math.floor(index / size), column: index % size };
      const key = snakePointKey(point);
      const onlineCell = onlineCells?.get(key);
      const isOnline = onlineCells !== null;
      const isSnake = isOnline ? Boolean(onlineCell) : body.has(key);
      const isHead = isOnline ? Boolean(onlineCell?.head) : key === head;
      const isFood = isOnline
        ? Boolean(
            onlineState &&
            onlineRoomStatus === "playing" &&
            snakePointsEqual(point, onlineState.food),
          )
        : snakePointsEqual(point, food);
      const cellState = {
        snake: isSnake,
        head: isHead,
        food: isFood,
        owner: onlineCell?.owner ?? null,
        alive: onlineCell?.alive ?? true,
        yours: onlineCell?.yours ?? false,
      } satisfies SnakeCellState;
      updateCell(cell, point, cellState, boardRebuilt, onlineCells ? undefined : origins.get(key));
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!onlineSession && event.key.toLowerCase() === "p") {
      event.preventDefault();
      togglePause();
      return;
    }
    handleStandardGameKey(event, {
      onDirection: handleDirectionInput,
      onActivate: activate,
      onNextDifficulty: () => {
        if (!onlineSession) changeDifficulty(difficultyControl, "next");
      },
      onPreviousDifficulty: () => {
        if (!onlineSession) changeDifficulty(difficultyControl, "previous");
      },
      onReset: requestReset,
    });
  }

  function activate(): void {
    if (onlineSession) requestOnlineStart();
    else start();
  }

  function handleDirectionInput(next: Direction): void {
    if (onlineSession) {
      sendOnlineDirection(next);
      return;
    }
    if (queueDirection(next)) playSound("gameMove");
    else if (state === "playing" && next === oppositeSnakeDirection[direction])
      invalidMove.trigger();
    start();
  }

  function start(): void {
    if (state === "lost" || state === "won") {
      invalidMove.trigger();
      return;
    }
    if (animationFrame) return;
    state = "playing";
    ensureStarted();
    lastFrameTime = 0;
    tickRemainder = 0;
    animationFrame = requestAnimationFrame(runFrame);
    playSound("gameMajor");
    render();
  }

  function togglePause(): void {
    if (onlineSession) {
      invalidMove.trigger();
      return;
    }
    if (state === "playing") {
      state = "paused";
      stopTimer();
      saveCurrentGame();
      playSound("uiToggle");
      render();
    } else if (state === "paused") start();
    else invalidMove.trigger();
  }

  function queueDirection(next: Direction): boolean {
    const queued = nextSnakeDirection(direction, queuedDirection, next);
    const changed = queued !== queuedDirection;
    queuedDirection = queued;
    return changed;
  }

  function runFrame(time: number): void {
    if (!lastFrameTime) lastFrameTime = time;
    tickRemainder += Math.min(time - lastFrameTime, config.speed * 2);
    lastFrameTime = time;

    if (tickRemainder >= config.speed) {
      tickRemainder %= config.speed;
      tick();
    }

    if (state === "playing") animationFrame = requestAnimationFrame(runFrame);
  }

  function tick(): void {
    direction = queuedDirection;
    const previousSnake = snake;
    const head = required(snake[0]);
    const moved = moveSnakePoint(head, direction);
    const outOfBounds = snakeOutOfBounds(moved, config.size);
    const next = wallMode === "teleport" ? wrapSnakePoint(moved, config.size) : moved;
    const ate = snakePointsEqual(next, food);
    const bodyToCheck = ate ? snake : snake.slice(0, -1);

    if (
      (outOfBounds && wallMode === "fatal") ||
      bodyToCheck.some((part) => snakePointsEqual(part, next))
    ) {
      state = "lost";
      finishGame("lost");
      playSound("gameLose");
      render();
      return;
    }

    snake = [next, ...snake];
    if (ate) {
      if (snake.length === config.size * config.size) {
        state = "won";
        finishGame("won");
        playSound("gameWin");
      } else {
        food = randomSnakeFood(config.size, snake);
        playSound("gameGood");
      }
    } else {
      snake.pop();
    }
    autosave.request();
    render(previousSnake);
  }

  function statusText(): string {
    if (onlineSession) return onlineStatusText();
    if (state === "ready") return `Ready · ${wallModeLabel(wallMode)}`;
    if (state === "paused") return `Paused · ${snake.length}`;
    if (state === "won") return "Full";
    if (state === "lost") return `Crash · ${snake.length}`;
    return `Length ${snake.length} · ${wallModeLabel(wallMode)}`;
  }

  function wallModeLabel(mode: WallMode): string {
    return mode === "fatal" ? "Fatal walls" : "Teleport walls";
  }

  function currentBoardSize(): number {
    return onlineSession ? (onlineState?.size ?? config.size) : config.size;
  }

  function labelFor(point: SnakePoint, next: SnakeCellState): string {
    const location = `Row ${point.row + 1}, column ${point.column + 1}`;
    if (next.head) return `${location}, ${snakeCellOwnerLabel(next)} snake head`;
    if (next.snake) return `${location}, ${snakeCellOwnerLabel(next)} snake body`;
    if (next.food) return `${location}, food`;
    return `${location}, empty`;
  }

  function snakeCellOwnerLabel(next: SnakeCellState): string {
    if (!next.owner) return "snake";
    const suffix = next.yours ? " (you)" : "";
    const stateText = next.alive ? "" : " crashed";
    return `${onlinePlayerLabel(next.owner)}${suffix}${stateText}`;
  }

  function prepareBoard(size: number): boolean {
    if (renderedSize === size) return false;
    renderedSize = size;
    setBoardGrid(grid, size);
    cells = syncChildren(grid, size * size, () => el("div", { className: "game-cell snake-cell" }));
    return true;
  }

  function segmentOrigins(previousSnake: SnakePoint[]): Map<string, SnakePoint> {
    const origins = new Map<string, SnakePoint>();
    snake.forEach((point, index) => {
      const previous =
        snake.length > previousSnake.length && index === snake.length - 1
          ? point
          : (previousSnake[index - 1] ?? required(previousSnake[0]));
      origins.set(snakePointKey(point), previous);
    });
    return origins;
  }

  function updateCell(
    cell: HTMLDivElement,
    point: SnakePoint,
    next: SnakeCellState,
    forceLabel: boolean,
    origin?: SnakePoint,
  ): void {
    const owner = next.owner ?? "";
    const alive = next.snake && next.owner ? String(next.alive) : "";
    const yours = next.yours ? "true" : "";
    const changed =
      cell.dataset.snake !== String(next.snake) ||
      cell.dataset.head !== String(next.head) ||
      cell.dataset.food !== String(next.food) ||
      (cell.dataset.owner ?? "") !== owner ||
      (cell.dataset.alive ?? "") !== alive ||
      (cell.dataset.yours ?? "") !== yours;
    if (!changed && !forceLabel) {
      animateSnakeCell(cell, point, next, origin);
      return;
    }

    if (changed) {
      setData(cell, "snake", next.snake);
      setData(cell, "head", next.head);
      setData(cell, "food", next.food);
      setStringData(cell, "owner", owner);
      setStringData(cell, "alive", alive);
      setStringData(cell, "yours", yours);
    }
    cell.setAttribute("aria-label", labelFor(point, next));
    animateSnakeCell(cell, point, next, origin);
  }

  function animateSnakeCell(
    cell: HTMLDivElement,
    point: SnakePoint,
    next: SnakeCellState,
    origin: SnakePoint | undefined,
  ): void {
    if (!next.snake || !origin || reducedMotion.matches) return;

    const columnDelta = origin.column - point.column;
    const rowDelta = origin.row - point.row;
    if (Math.abs(columnDelta) + Math.abs(rowDelta) !== 1) return;

    const scale = next.head ? " scale(1.02)" : "";
    cell.getAnimations().forEach((animation) => animation.cancel());
    cell.animate(
      [
        { transform: `translate(${columnDelta * 100}%, ${rowDelta * 100}%)${scale}` },
        { transform: `translate(0, 0)${scale}` },
      ],
      {
        duration: Math.min(96, config.speed * 0.86),
        easing: "linear",
      },
    );
  }

  function setData(cell: HTMLDivElement, key: string, value: boolean): void {
    const next = String(value);
    if (cell.dataset[key] !== next) cell.dataset[key] = next;
  }

  function setStringData(cell: HTMLDivElement, key: string, value: string): void {
    if (!value) {
      delete cell.dataset[key];
      return;
    }
    if (cell.dataset[key] !== value) cell.dataset[key] = value;
  }

  function stopTimer(): void {
    if (!animationFrame) return;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastFrameTime = 0;
    tickRemainder = 0;
  }

  function ensureStarted(): void {
    if (startedAt === null) startedAt = Date.now();
    markGameStarted(shell);
  }

  function finishGame(outcome: "won" | "lost"): void {
    markGameFinished(shell);
    stopTimer();
    recordGameResult({
      runId,
      gameId,
      difficulty,
      outcome,
      score: score(),
      durationMs: durationMs(),
      metadata: { wallMode, length: snake.length },
    });
    clearGameSave(gameId);
  }

  function saveCurrentGame(): void {
    if (onlineSession) return;
    if (startedAt === null) return;
    if (state === "won" || state === "lost") {
      clearGameSave(gameId);
      return;
    }
    saveGameSave(gameId, savePayloadVersion, {
      runId,
      status: state === "paused" ? "paused" : state === "playing" ? "playing" : "ready",
      payload: {
        difficulty,
        wallMode,
        config,
        snake,
        food,
        direction,
        queuedDirection,
        state,
        score: score(),
        startedAt,
      },
    });
  }

  function score(): number {
    return snake.length - 3;
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(gameId, { difficulty, options: { wallMode } });
  }

  function startOnline(session: MultiplayerSession): void {
    stopTimer();
    clearGameSave(gameId);
    resetGameProgress(shell);
    onlineConnection?.close();
    onlineSession = session;
    onlineSeat = session.seat;
    onlineRevision = 0;
    onlineStatus = "connecting";
    onlineRoomStatus = "lobby";
    onlineCountdownEndsAt = undefined;
    onlineSeats = emptyMultiplayerSeatSnapshots();
    onlineSeats[session.seat] = { joined: true, connected: false };
    onlineState = null;
    onlineResultRecorded = false;
    onlineError = "";
    runId = createRunId();
    state = "ready";
    onlineConnection = connectMultiplayerSession(session, {
      onSnapshot: (message) => applyOnlineSnapshot(message.room, message.you.seat),
      onError: (error, room) => {
        onlineError = error;
        if (room) applyOnlineSnapshot(room, onlineSeat ?? session.seat);
        else render();
      },
      onStatus: (connectionStatus) => {
        onlineStatus = connectionStatus;
        if (connectionStatus === "connected") onlineError = "";
        render();
      },
    });
    render();
  }

  function requestOnlineStart(): void {
    if (!onlineSession) return;
    if (!canOnlineStart()) {
      if (onlineRoomStatus === "lobby") invalidMove.trigger();
      return;
    }
    onlineError = "Starting…";
    onlineConnection?.requestStart(onlineRevision);
    render();
  }

  function requestOnlineRematch(): void {
    if (!canOnlineRematch()) return;
    onlineError = onlineSeat === "p1" ? "Starting rematch…" : "Ready for rematch…";
    onlineConnection?.requestRematch(onlineRevision);
    render();
  }

  function sendOnlineDirection(next: Direction): void {
    const player = onlineSeat ? onlinePlayerFor(onlineSeat) : null;
    if (onlineStatus !== "connected" || onlineRoomStatus !== "playing" || !player?.alive) {
      invalidMove.trigger();
      return;
    }
    onlineConnection?.sendAction(onlineRevision, { type: "direction", direction: next });
    playSound("gameMove");
  }

  function canOnlineStart(): boolean {
    return canStartMultiplayerMatch({
      session: onlineSession,
      seat: onlineSeat,
      connectionStatus: onlineStatus,
      roomStatus: onlineRoomStatus,
      seats: onlineSeats,
    });
  }

  function canOnlineRematch(): boolean {
    return canRequestMultiplayerRematch(isOnlineFinished(), onlineSeat, currentSeatReady());
  }

  function isOnlineFinished(): boolean {
    return Boolean(onlineSession && onlineState?.winner);
  }

  function currentSeatReady(): boolean {
    return onlineSeat ? onlineSeats[onlineSeat].ready === true : false;
  }

  function stopOnline(): void {
    closeOnlineDialog();
    onlineConnection?.close();
    onlineConnection = null;
    onlineSession = null;
    onlineSeat = null;
    onlineRevision = 0;
    onlineStatus = "closed";
    onlineRoomStatus = "lobby";
    onlineCountdownEndsAt = undefined;
    onlineCountdown.cleanup();
    onlineSeats = emptyMultiplayerSeatSnapshots();
    onlineState = null;
    onlineResultRecorded = false;
    onlineError = "";
  }

  function applyOnlineSnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat): void {
    const snapshot = parseOnlineSnakeState(room.state);
    if (!snapshot || room.gameId !== gameId) return;
    const wasInFinishedOrStartedOnlineGame =
      onlineResultRecorded || Boolean(onlineState?.winner) || (onlineState?.tick ?? 0) > 0;
    onlineError = "";
    onlineSeat = seat;
    onlineRevision = room.revision;
    onlineRoomStatus = room.status;
    onlineCountdownEndsAt = room.countdownEndsAt;
    onlineCountdown.update(room);
    onlineSeats = room.seats;
    onlineState = snapshot;
    if (
      wasInFinishedOrStartedOnlineGame &&
      room.status === "playing" &&
      snapshot.tick === 0 &&
      !snapshot.winner
    ) {
      resetGameProgress(shell);
      runId = createRunId();
      onlineResultRecorded = false;
    }
    if (room.status === "playing" && snapshot.players.length > 0) markGameStarted(shell);
    if (snapshot.winner) {
      markGameFinished(shell);
      recordOnlineFinished(snapshot);
    }
    render();
  }

  function onlineStatusText(): string {
    if (onlineError) return onlineError;
    if (onlineStatus === "connecting") return "Connecting…";
    if (onlineStatus === "reconnecting") return "Reconnecting…";
    if (!onlineSession) return "Online";
    const joined = multiplayerJoinedSeatCount(onlineSeats);
    if (onlineRoomStatus === "lobby") {
      if (onlineSeat === "p1") return `Room ${onlineSession.code} · ${joined}/4 · Start at 2`;
      return `Room ${onlineSession.code} · ${joined}/4 · Waiting host`;
    }
    if (onlineRoomStatus === "countdown") return `Starting in ${onlineCountdownText()}`;
    const winner = onlineState?.winner ?? null;
    if (winner) {
      const result =
        winner === "draw"
          ? "Draw"
          : winner === onlineSeat
            ? "You win"
            : `${onlinePlayerLabel(winner)} wins`;
      return multiplayerRematchStatusText({
        result,
        localSeat: onlineSeat,
        seats: onlineSeats,
        maxPlayers: 4,
      });
    }
    const player = onlineSeat ? onlinePlayerFor(onlineSeat) : null;
    if (!player) return `Room ${onlineSession.code} · Watching`;
    const alive = onlineState?.players.filter((entry) => entry.alive).length ?? 0;
    if (!player.alive) return `Crashed · ${alive} alive`;
    return `Length ${player.snake.length} · ${alive}/${onlineState?.players.length ?? joined} alive`;
  }

  function onlineCountdownText(): string {
    return multiplayerCountdownText({
      status: onlineRoomStatus,
      countdownEndsAt: onlineCountdownEndsAt,
    });
  }

  function recordOnlineFinished(snapshot: OnlineSnakeState): void {
    if (onlineResultRecorded || !onlineSeat || !snapshot.winner) return;
    onlineResultRecorded = true;
    const player = onlinePlayerFor(onlineSeat, snapshot);
    const outcome =
      snapshot.winner === "draw" ? "draw" : snapshot.winner === onlineSeat ? "won" : "lost";
    recordGameResult({
      runId,
      gameId,
      outcome,
      score: Math.max(0, (player?.snake.length ?? 3) - 3),
      durationMs: durationSince(snapshot.startedAt),
      metadata: {
        mode: "online",
        seat: onlineSeat,
        winner: snapshot.winner,
        players: snapshot.players.length,
        length: player?.snake.length ?? 0,
      },
    });
  }

  function onlineCellStates(): Map<
    string,
    { owner: MultiplayerSeat; head: boolean; alive: boolean; yours: boolean }
  > {
    const map = new Map<
      string,
      { owner: MultiplayerSeat; head: boolean; alive: boolean; yours: boolean }
    >();
    for (const player of onlineState?.players ?? []) {
      player.snake.forEach((point, index) => {
        const key = snakePointKey(point);
        if (!map.has(key)) {
          map.set(key, {
            owner: player.seat,
            head: index === 0,
            alive: player.alive,
            yours: player.seat === onlineSeat,
          });
        }
      });
    }
    return map;
  }

  function onlinePlayerFor(
    seat: MultiplayerSeat,
    snapshot: OnlineSnakeState | null = onlineState,
  ): OnlineSnakePlayer | null {
    return snapshot?.players.find((player) => player.seat === seat) ?? null;
  }

  if (startedAt !== null) markGameStarted(shell);
  if (state === "won" || state === "lost") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    stopTimer();
    invalidMove.cleanup();
    scope.cleanup();
    stopOnline();
    onlineCountdown.cleanup();
    remove();
  };
}

function onlinePlayerLabel(seat: MultiplayerSeat): string {
  return seat.toUpperCase();
}

function parseWallMode(value: unknown): WallMode | null {
  return parseOneOf(value, ["fatal", "teleport"] as const);
}

function parseSaveSnake(value: unknown): SaveSnake | null {
  if (!isRecord(value)) return null;
  const difficulty = parseDifficulty(value.difficulty);
  const wallMode = parseWallMode(value.wallMode);
  if (!difficulty || !wallMode) return null;
  const config = parseConfig(value.config, configs[difficulty]);
  const snake = parseSnake(value.snake, config?.size ?? 0);
  const food = parsePoint(value.food, config?.size ?? 0);
  const direction = parseDirection(value.direction);
  const queuedDirection = parseDirection(value.queuedDirection);
  const state = parseState(value.state);
  const startedAt = parseStartedAt(value.startedAt);
  if (!config || !snake || !food || !direction || !queuedDirection || !state) return null;
  if (!isFiniteNumber(value.score)) return null;
  if (startedAt === undefined) return null;
  return {
    difficulty,
    wallMode,
    config,
    snake,
    food,
    direction,
    queuedDirection,
    state,
    score: value.score,
    startedAt,
  };
}

function parseOnlineSnakeState(value: unknown): OnlineSnakeState | null {
  if (!isRecord(value)) return null;
  const size = typeof value.size === "number" && Number.isInteger(value.size) ? value.size : null;
  if (size === null || size < 8 || size > 40) return null;
  const food = parsePoint(value.food, size);
  const winner = parseOnlineWinner(value.winner);
  const players = Array.isArray(value.players)
    ? value.players.map((player) => parseOnlineSnakePlayer(player, size))
    : [];
  const tick = typeof value.tick === "number" && Number.isInteger(value.tick) ? value.tick : 0;
  const startedAt = parseStartedAt(value.startedAt);
  if (!food || winner === undefined || startedAt === undefined) return null;
  if (!players.every((player): player is OnlineSnakePlayer => player !== null)) return null;
  return { size, food, players, winner, tick, startedAt };
}

function parseOnlineSnakePlayer(value: unknown, size: number): OnlineSnakePlayer | null {
  if (!isRecord(value)) return null;
  const seat = parseMultiplayerSeat(value.seat);
  const snake = parseSnake(value.snake, size);
  const direction = parseDirection(value.direction);
  const queuedDirection = parseDirection(value.queuedDirection);
  const alive = typeof value.alive === "boolean" ? value.alive : null;
  const score =
    typeof value.score === "number" && Number.isInteger(value.score) ? value.score : null;
  if (!seat || !snake || !direction || !queuedDirection || alive === null || score === null) {
    return null;
  }
  return { seat, snake, direction, queuedDirection, alive, score };
}

function parseOnlineWinner(value: unknown): MultiplayerSeat | "draw" | null | undefined {
  if (value === null || value === "draw") return value;
  return parseMultiplayerSeat(value) ?? undefined;
}

function parseConfig(value: unknown, expected: Config): Config | null {
  if (!isRecord(value)) return null;
  return value.size === expected.size && value.speed === expected.speed ? expected : null;
}

function parseSnake(value: unknown, size: number): SnakePoint[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const snake = value.map((point) => parsePoint(point, size));
  return snake.every((point): point is SnakePoint => point !== null) ? snake : null;
}

function parsePoint(value: unknown, size: number): SnakePoint | null {
  if (!isRecord(value)) return null;
  const row = value.row;
  const column = value.column;
  if (!isIntegerInRange(row, size) || !isIntegerInRange(column, size)) return null;
  return { row, column };
}

function parseDirection(value: unknown): Direction | null {
  return parseOneOf(value, ["up", "right", "down", "left"] as const);
}

function parseState(value: unknown): State | null {
  return parseOneOf(value, ["ready", "playing", "paused", "won", "lost"] as const);
}
