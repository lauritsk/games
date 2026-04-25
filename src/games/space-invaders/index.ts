import * as v from "valibot";
import {
  clamp,
  createArcadeModeController,
  createHeldKeyInput,
  createPauseButton,
  createPauseOverlay,
  createTouchControls,
  keyDirection,
  parseRect,
  positionPercent,
  startFixedStepLoop,
  syncPositionedChildren,
  type FixedStepLoop,
} from "@games/shared/arcade";
import {
  addTouchGestureControls,
  createDelayedAction,
  createGameShell,
  createMountScope,
  durationSince,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  finiteNumberSchema,
  parseWithSchema,
  picklistSchema,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  parseStartedAt,
  pauseGameOnRequest,
  pauseOnFocusLoss,
  resetGameProgress,
  setIconLabel,
  type Difficulty,
  type Direction,
  type GameDefinition,
} from "@shared/core";
import { createInvalidMoveFeedback } from "@ui/feedback";
import { createMultiplayerActionButtons } from "@features/multiplayer/multiplayer-actions";
import { createMultiplayerGameClient } from "@features/multiplayer/multiplayer-game-client";
import {
  multiplayerJoinedSeatCount,
  multiplayerRematchStatusText,
  type MultiplayerRoomSnapshot,
  type MultiplayerSeat,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";
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
import { playSound } from "@ui/sound";
import { createGameDifficultyControl, createResetControl } from "@games/shared/controls";
import {
  aimInvaderPlayer,
  fireInvaderShot,
  invaderConfigs,
  invaderShotHeight,
  invaderShotWidth,
  newInvaderState,
  nextInvaderWave,
  stepInvaders,
  type InvaderAlien,
  type InvaderBarrier,
  type InvaderConfig,
  type InvaderPlayer,
  type InvaderPlayerId,
  type InvaderShot,
  type InvaderState,
} from "@games/space-invaders/logic";

type Mode = "ready" | "playing" | "paused" | "wave" | "lost";

const savePayloadVersion = 1;

type SaveSpaceInvaders = {
  difficulty: Difficulty;
  mode: Mode;
  state: InvaderState;
  startedAt: number | null;
};

type OnlineInvaderState = InvaderState & { difficulty: Difficulty };

const invaderModeSchema = picklistSchema(["ready", "playing", "paused", "wave", "lost"] as const);
const invaderPlayerIdSchema = picklistSchema(["p1", "p2"] as const);
const alienDirectionSchema = picklistSchema([-1, 1] as const);
const shotOwnerSchema = picklistSchema(["player", "alien"] as const);
const saveSpaceInvadersBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  mode: v.unknown(),
  state: v.unknown(),
  startedAt: v.unknown(),
});
const invaderStateBaseSchema = v.looseObject({
  width: finiteNumberSchema,
  height: finiteNumberSchema,
  player: v.unknown(),
  players: v.optional(v.unknown()),
  aliens: v.unknown(),
  barriers: v.unknown(),
  shots: v.unknown(),
  alienDirection: alienDirectionSchema,
  tick: finiteNumberSchema,
  score: finiteNumberSchema,
  lives: finiteNumberSchema,
  wave: finiteNumberSchema,
  won: v.boolean(),
  lost: v.boolean(),
});
const invaderAlienExtrasSchema = v.looseObject({ alive: v.boolean() });
const invaderBarrierExtrasSchema = v.looseObject({ hp: finiteNumberSchema });
const invaderPlayerExtrasSchema = v.looseObject({ id: v.unknown() });
const invaderShotSchema = v.looseObject({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  vy: finiteNumberSchema,
  owner: shotOwnerSchema,
  playerId: v.optional(v.unknown()),
});
const onlineInvaderBaseSchema = v.looseObject({ difficulty: v.unknown() });

const configs: Record<Difficulty, InvaderConfig> = invaderConfigs;

export const spaceInvaders: GameDefinition = {
  id: "space-invaders",
  name: "Space Invaders",
  tagline: "Hold the line against descending waves.",
  players: "Solo or online co-op",
  theme: "outer-space",
  mount: mountSpaceInvaders,
};

export function mountSpaceInvaders(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(spaceInvaders.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let state = newInvaderState(configs[difficulty]);
  let mode: Mode = "ready";
  let loop: FixedStepLoop | null = null;
  let runId = createRunId();
  let startedAt: number | null = null;
  let onlineState: OnlineInvaderState | null = null;
  let lastOnlineMove: -1 | 0 | 1 = 0;
  let lastOnlineAimX: number | null = null;

  const saved = loadGameSave(spaceInvaders.id, savePayloadVersion, parseSaveSpaceInvaders);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    state =
      saved.payload.mode === "wave"
        ? nextInvaderWave(saved.payload.state, configs[difficulty])
        : saved.payload.state;
    mode =
      saved.payload.mode === "playing" || saved.payload.mode === "wave"
        ? "paused"
        : saved.payload.mode;
    startedAt = saved.payload.startedAt;
  }

  const { shell, status, actions, viewport, board, remove } = createGameShell(target, {
    gameClass: "invaders-game",
    boardClass: "board--invaders",
    boardLabel: "Space Invaders playfield",
    layout: gameLayouts.portraitFit,
  });
  shell.tabIndex = 0;
  const onlinePresence = el("div", { className: "online-presence-host" });
  viewport.append(onlinePresence);

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const autosave = createAutosave({ gameId: spaceInvaders.id, scope, save: saveCurrentGame });
  const waveAdvance = createDelayedAction();
  const online = createMultiplayerGameClient({
    game: spaceInvaders,
    render,
    applySnapshot: applyOnlineSnapshot,
  });
  const input = createHeldKeyInput(scope, (direction) => {
    if (isConfirmOpen() || (direction !== "left" && direction !== "right")) return;
    if (online.session) syncOnlineControlFromInput();
    else start();
  });
  const players = el("div", { className: "invader-players" });
  const aliens = el("div", { className: "invader-aliens" });
  const barriers = el("div", { className: "invader-barriers" });
  const shots = el("div", { className: "invader-shots" });
  board.append(aliens, barriers, shots, players);
  const modeController = createArcadeModeController<Mode>({
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    blockedStart: ["lost"],
    blockedPause: ["lost", "wave"],
    ready: "ready",
    playing: "playing",
    paused: "paused",
    onBlockedStart: () => invalidMove.trigger(),
    onFirstStart: () => {
      ensureStarted();
      playSound("gameMajor");
    },
    onPlaying: restartTimer,
    onPause: () => {
      stopTimer();
      saveCurrentGame();
      playSound("uiToggle");
    },
    afterChange: render,
  });
  const overlay = createPauseOverlay(board, togglePause);
  createTouchControls(shell, {
    left: () => touchMoveByDirection("left"),
    right: () => touchMoveByDirection("right"),
    fire,
  });

  const difficultyControl = createGameDifficultyControl(actions, {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
      savePreferences();
    },
    reset: resetAfterDifficultyChange,
  });
  const pauseButton = createPauseButton(actions, togglePause);
  const {
    onlineButton,
    startOnlineButton,
    rematchButton,
    closeDialog: closeOnlineDialog,
  } = createMultiplayerActionButtons(actions, {
    game: spaceInvaders,
    getSession: () => online.session,
    onSession: startOnline,
    onStart: requestOnlineStart,
    onRematch: requestOnlineRematch,
    getSettings: onlineSettings,
  });
  const requestReset = createResetControl(actions, shell, resetGame);

  onDocumentKeyDown(onKeyDown, scope);
  document.addEventListener("keyup", onKeyUp, { signal: scope.signal });
  pauseGameOnRequest(shell, scope, {
    canPause: () => !online.session && mode === "playing",
    isPaused: () => !online.session && mode === "paused",
    pause: togglePause,
  });
  pauseOnFocusLoss(scope, {
    isActive: () => !online.session && mode === "playing",
    pause: togglePause,
  });
  board.addEventListener(
    "pointerdown",
    (event) => {
      movePointer(event);
      start();
      fire();
    },
    { signal: scope.signal },
  );
  board.addEventListener("pointermove", movePointer, { signal: scope.signal });
  addTouchGestureControls(
    board,
    {
      onSwipe: (direction) => {
        if (direction === "left" || direction === "right") touchMoveByDirection(direction);
        else fire();
      },
    },
    { signal: scope.signal, touchAction: "none" },
  );

  function resetGame(): void {
    stopOnline();
    stopTimer();
    clearGameSave(spaceInvaders.id);
    waveAdvance.clear();
    resetGameProgress(shell);
    runId = createRunId();
    startedAt = null;
    state = newInvaderState(configs[difficulty]);
    mode = "ready";
    input.clear();
    savePreferences();
    render();
  }

  function resetAfterDifficultyChange(): void {
    if (online.session) {
      requestOnlineSettings();
      return;
    }
    resetGame();
  }

  function start(): void {
    if (online.session) {
      requestOnlineStart();
      return;
    }
    modeController.start();
  }

  function togglePause(): void {
    if (online.session) {
      invalidMove.trigger();
      return;
    }
    modeController.togglePause();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      togglePause();
      return;
    }
    handleStandardGameKey(event, {
      onDirection: moveByDirection,
      onActivate: () => {
        start();
        fire();
      },
      onNextDifficulty: difficultyControl.next,
      onPreviousDifficulty: difficultyControl.previous,
      onReset: requestReset,
    });
  }

  function onKeyUp(event: KeyboardEvent): void {
    const direction = keyDirection(event);
    if (!online.session || (direction !== "left" && direction !== "right")) return;
    syncOnlineControlFromInput();
  }

  function moveByDirection(direction: Direction): void {
    if (direction !== "left" && direction !== "right") return;
    if (online.session) {
      sendOnlineMove(direction === "left" ? -1 : 1);
      return;
    }
    const delta =
      direction === "left" ? -configs[difficulty].playerSpeed : configs[difficulty].playerSpeed;
    state = {
      ...state,
      player: {
        ...state.player,
        x: clamp(state.player.x + delta, 0, state.width - state.player.width),
      },
      players: state.players.map((candidate, index) =>
        index === 0
          ? { ...candidate, x: clamp(candidate.x + delta, 0, state.width - candidate.width) }
          : candidate,
      ),
    };
    start();
    autosave.request();
    render();
  }

  function touchMoveByDirection(direction: Direction): void {
    if (online.session) sendOnlineMoveStep(direction);
    else moveByDirection(direction);
  }

  function fire(): void {
    if (online.session) {
      sendOnlineFire();
      return;
    }
    if (mode !== "playing") return;
    const before = state.shots.length;
    state = fireInvaderShot(state);
    if (state.shots.length > before) {
      saveCurrentGame();
      playSound("uiToggle");
    }
    render();
  }

  function tick(): void {
    const move = input.horizontal();
    const beforeScore = state.score;
    const beforeLives = state.lives;
    state = stepInvaders(state, configs[difficulty], { move });
    if (state.score > beforeScore) playSound("gameGood");
    if (state.lives < beforeLives) playSound("gameLose");
    if (state.lost) {
      mode = "lost";
      finishGame();
      input.clear();
      playSound("gameLose");
    } else if (state.won) {
      mode = "wave";
      stopTimer();
      input.clear();
      saveCurrentGame();
      playSound("gameWin");
      waveAdvance.start(() => {
        state = nextInvaderWave(state, configs[difficulty]);
        mode = "playing";
        saveCurrentGame();
        restartTimer();
        render();
      }, 900);
    } else autosave.request();
    render();
  }

  function movePointer(event: PointerEvent): void {
    const rect = board.getBoundingClientRect();
    const current = currentInvaderState();
    const center = ((event.clientX - rect.left) / rect.width) * current.width;
    if (online.session) {
      if (event.type === "pointerdown" || event.buttons > 0) sendOnlineAim(center);
      return;
    }
    state = aimInvaderPlayer(state, "p1", center);
    autosave.request();
    render();
  }

  function render(): void {
    const current = currentInvaderState();
    online.renderPresence(onlinePresence);
    difficultyControl.sync(difficulty, Boolean(online.session && !canAdjustOnlineSettings()));
    setIconLabel(
      pauseButton,
      mode === "paused" ? "▶" : "⏸",
      mode === "paused" ? "Resume" : "Pause",
    );
    pauseButton.hidden = Boolean(online.session);
    online.syncActionButtons(
      { onlineButton, startOnlineButton, rematchButton },
      isOnlineFinished(),
    );
    status.textContent = statusText();
    overlay.setVisible(!online.session && mode === "paused");
    syncPlayers(current);
    syncAliens(current);
    syncBarriers(current);
    syncShots(current);
  }

  function syncPlayers(next: InvaderState): void {
    const activePlayers = invaderPlayersForRender(next);
    syncPositioned(
      players,
      activePlayers.length,
      "arcade-entity arcade-glow invader-player",
      (child, index) => {
        const player = activePlayers[index];
        if (!player) return;
        position(child, player.x, player.y, player.width, player.height);
        child.dataset.player = player.id;
        child.dataset.yours = String(player.id === online.seat);
        child.setAttribute(
          "aria-label",
          online.seat === player.id ? "Your cannon" : `${player.id.toUpperCase()} cannon`,
        );
      },
    );
  }

  function syncAliens(next: InvaderState): void {
    syncPositioned(aliens, next.aliens.length, "arcade-entity invader-alien", (child, index) => {
      const alien = next.aliens[index];
      if (!alien) return;
      position(child, alien.x, alien.y, alien.width, alien.height);
      child.dataset.alive = String(alien.alive);
      child.setAttribute(
        "aria-label",
        alien.alive ? `Alien ${index + 1}` : `Destroyed alien ${index + 1}`,
      );
    });
  }

  function syncBarriers(next: InvaderState): void {
    syncPositioned(
      barriers,
      next.barriers.length,
      "arcade-entity invader-barrier",
      (child, index) => {
        const barrier = next.barriers[index];
        if (!barrier) return;
        position(child, barrier.x, barrier.y, barrier.width, barrier.height);
        child.dataset.hp = String(barrier.hp);
        child.setAttribute("aria-label", `Barrier ${index + 1}, ${barrier.hp} strength`);
      },
    );
  }

  function syncShots(next: InvaderState): void {
    syncPositioned(
      shots,
      next.shots.length,
      "arcade-entity arcade-glow invader-shot",
      (child, index) => {
        const shot = next.shots[index];
        if (!shot) return;
        child.dataset.owner = shot.owner;
        position(
          child,
          shot.x - invaderShotWidth / 2,
          shot.y - invaderShotHeight / 2,
          invaderShotWidth,
          invaderShotHeight,
        );
      },
    );
  }

  function syncPositioned(
    container: HTMLElement,
    count: number,
    className: string,
    apply: (child: HTMLElement, index: number) => void,
  ): void {
    syncPositionedChildren(container, count, className, apply);
  }

  function position(
    element: HTMLElement,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    positionPercent(element, { x, y, width, height });
  }

  function currentInvaderState(): InvaderState {
    return onlineState ?? state;
  }

  function invaderPlayersForRender(next: InvaderState): InvaderPlayer[] {
    return next.players.length > 0 ? next.players : [{ ...next.player, id: "p1" }];
  }

  function statusText(): string {
    if (online.session) return onlineStatusText();
    if (mode === "ready") return "Ready";
    if (mode === "paused") return "Paused";
    if (mode === "wave") return `Wave ${state.wave + 1}`;
    if (mode === "lost") return `Over · ${state.score}`;
    return `${state.score} · W${state.wave} · ${"♥".repeat(state.lives)}`;
  }

  function restartTimer(): void {
    if (mode !== "playing" || loop?.running) return;
    loop = startFixedStepLoop(tick, render, 31);
  }

  function stopTimer(): void {
    loop?.stop();
    loop = null;
  }

  function ensureStarted(): void {
    if (startedAt === null) startedAt = Date.now();
    markGameStarted(shell);
  }

  function finishGame(): void {
    markGameFinished(shell);
    stopTimer();
    recordGameResult({
      runId,
      gameId: spaceInvaders.id,
      difficulty,
      outcome: "lost",
      score: state.score,
      level: state.wave,
      durationMs: durationMs(),
      metadata: { lives: state.lives },
    });
    clearGameSave(spaceInvaders.id);
  }

  function saveCurrentGame(): void {
    if (online.session) return;
    if (startedAt === null) return;
    if (mode === "lost") {
      clearGameSave(spaceInvaders.id);
      return;
    }
    saveGameSave(spaceInvaders.id, savePayloadVersion, {
      runId,
      status:
        mode === "paused" ? "paused" : mode === "playing" || mode === "wave" ? "playing" : "ready",
      payload: { difficulty, mode, state, startedAt },
    });
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(spaceInvaders.id, { difficulty });
  }

  function startOnline(session: MultiplayerSession): void {
    stopTimer();
    waveAdvance.clear();
    clearGameSave(spaceInvaders.id);
    resetGameProgress(shell);
    online.start(session, () => {
      onlineState = null;
      lastOnlineMove = 0;
      lastOnlineAimX = null;
      runId = createRunId();
      startedAt = null;
      mode = "ready";
      input.clear();
    });
  }

  function requestOnlineStart(): void {
    online.requestStart(() => invalidMove.trigger());
  }

  function requestOnlineSettings(): void {
    online.requestSettings(onlineSettings());
  }

  function requestOnlineRematch(): void {
    online.requestRematch(isOnlineFinished());
  }

  function syncOnlineControlFromInput(): void {
    sendOnlineMove(input.horizontal());
  }

  function sendOnlineMove(move: -1 | 0 | 1): void {
    if (!online.seat || online.connectionStatus !== "connected" || online.roomStatus !== "playing")
      return;
    if (move === lastOnlineMove) return;
    lastOnlineMove = move;
    online.connection?.sendAction(online.revision, { type: "move", move });
  }

  function sendOnlineMoveStep(direction: Direction): void {
    if (direction !== "left" && direction !== "right") return;
    if (
      !online.seat ||
      online.connectionStatus !== "connected" ||
      online.roomStatus !== "playing"
    ) {
      invalidMove.trigger();
      return;
    }
    online.connection?.sendAction(online.revision, {
      type: "step",
      move: direction === "left" ? -1 : 1,
    });
    playSound("gameMove");
  }

  function sendOnlineFire(): void {
    if (!online.seat || online.connectionStatus !== "connected" || online.roomStatus !== "playing")
      return;
    online.connection?.sendAction(online.revision, { type: "fire" });
    playSound("uiToggle");
  }

  function sendOnlineAim(centerX: number): void {
    if (!online.seat || online.connectionStatus !== "connected" || online.roomStatus !== "playing")
      return;
    if (lastOnlineAimX !== null && Math.abs(centerX - lastOnlineAimX) < 1.2) return;
    lastOnlineAimX = centerX;
    online.connection?.sendAction(online.revision, { type: "aim", x: centerX });
  }

  function canAdjustOnlineSettings(): boolean {
    return online.canAdjustSettings();
  }

  function onlineSettings(): { difficulty: Difficulty } {
    return { difficulty };
  }

  function isOnlineFinished(): boolean {
    return Boolean(online.session && onlineState?.lost);
  }

  function stopOnline(): void {
    closeOnlineDialog();
    online.stop();
    onlineState = null;
    lastOnlineMove = 0;
    lastOnlineAimX = null;
  }

  function applyOnlineSnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat | null): void {
    const snapshot = parseOnlineInvaderState(room.state);
    if (!snapshot || room.gameId !== spaceInvaders.id) return;
    const previous = onlineState;
    const wasInFinishedOrStartedOnlineGame =
      online.resultRecorded || Boolean(previous?.lost) || (previous?.tick ?? 0) > 0;
    online.applySnapshot(room, seat);
    if (wasInFinishedOrStartedOnlineGame && snapshot.tick === 0 && !snapshot.lost) {
      resetGameProgress(shell);
      runId = createRunId();
      online.resultRecorded = false;
      startedAt = null;
    }
    if (previous && snapshot.score > previous.score) playSound("gameGood");
    if (previous && snapshot.lives < previous.lives) playSound("gameLose");
    difficulty = snapshot.difficulty;
    onlineState = snapshot;
    if (snapshot.tick > 0) ensureStarted();
    if (snapshot.lost) {
      markGameFinished(shell);
      recordOnlineFinished(snapshot);
    }
    render();
  }

  function onlineStatusText(): string {
    if (online.error) return online.error;
    if (online.connectionStatus === "connecting") return "Connecting…";
    if (online.connectionStatus === "reconnecting") return "Reconnecting…";
    if (!online.session) return "Online";
    if (online.roomStatus === "countdown") {
      return online.seat
        ? `Starting in ${online.countdownText()}`
        : `Spectating · Starting in ${online.countdownText()}`;
    }
    if (online.roomStatus === "lobby") {
      const joined = multiplayerJoinedSeatCount(online.seats);
      if (!online.seat) return "Spectating";
      if (online.seat === "p1") return `${joined}/2 · Start at 2`;
      return "Waiting host";
    }
    const snapshot = onlineState;
    if (!snapshot) return "Waiting";
    if (snapshot.lost) {
      const result = `Over · ${snapshot.score}`;
      if (!online.seat) return `Spectating · ${result}`;
      return multiplayerRematchStatusText({
        result,
        localSeat: online.seat,
        seats: online.seats,
      });
    }
    const summary = `${snapshot.score} · W${snapshot.wave} · ${"♥".repeat(snapshot.lives)} · Co-op`;
    return online.seat ? summary : `Spectating · ${summary}`;
  }

  function recordOnlineFinished(snapshot: OnlineInvaderState): void {
    if (online.resultRecorded || !online.seat) return;
    online.resultRecorded = true;
    recordGameResult({
      runId,
      gameId: spaceInvaders.id,
      difficulty: snapshot.difficulty,
      outcome: "lost",
      score: snapshot.score,
      level: snapshot.wave,
      durationMs: durationMs(),
      metadata: { mode: "online", seat: online.seat, lives: snapshot.lives },
    });
  }

  if (startedAt !== null) markGameStarted(shell);
  if (mode === "lost") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    stopTimer();
    waveAdvance.clear();
    stopOnline();
    invalidMove.cleanup();
    input.destroy();
    scope.cleanup();
    remove();
  };
}

function parseSaveSpaceInvaders(value: unknown): SaveSpaceInvaders | null {
  const parsed = parseWithSchema(saveSpaceInvadersBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  const mode = parseMode(parsed.mode);
  const state = parseInvaderState(parsed.state);
  const startedAt = parseStartedAt(parsed.startedAt);
  if (!difficulty || !mode || !state || startedAt === undefined) return null;
  return { difficulty, mode, state, startedAt };
}

function parseInvaderState(value: unknown): InvaderState | null {
  const parsed = parseWithSchema(invaderStateBaseSchema, value);
  if (!parsed) return null;
  const player = parseRect(parsed.player);
  const aliens = parseAliens(parsed.aliens);
  const barriers = parseBarriers(parsed.barriers);
  const shots = parseShots(parsed.shots);
  const players = parsePlayers(parsed.players, player);
  if (!player || !players || !aliens || !barriers || !shots) return null;
  return {
    width: parsed.width,
    height: parsed.height,
    player,
    players,
    aliens,
    barriers,
    shots,
    alienDirection: parsed.alienDirection,
    tick: parsed.tick,
    score: parsed.score,
    lives: parsed.lives,
    wave: parsed.wave,
    won: parsed.won,
    lost: parsed.lost,
  };
}

function parseAliens(value: unknown): InvaderAlien[] | null {
  if (!Array.isArray(value)) return null;
  const aliens = value.map((alien) => {
    const rect = parseRect(alien);
    const extras = parseWithSchema(invaderAlienExtrasSchema, alien);
    return rect && extras ? { ...rect, ...extras } : null;
  });
  return aliens.every((alien): alien is InvaderAlien => alien !== null) ? aliens : null;
}

function parseBarriers(value: unknown): InvaderBarrier[] | null {
  if (!Array.isArray(value)) return null;
  const barriers = value.map((barrier) => {
    const rect = parseRect(barrier);
    const extras = parseWithSchema(invaderBarrierExtrasSchema, barrier);
    return rect && extras ? { ...rect, ...extras } : null;
  });
  return barriers.every((barrier): barrier is InvaderBarrier => barrier !== null) ? barriers : null;
}

function parsePlayers(
  value: unknown,
  fallback: InvaderState["player"] | null,
): InvaderPlayer[] | null {
  if (!Array.isArray(value)) return fallback ? [{ ...fallback, id: "p1" }] : null;
  const players = value.map((player) => {
    const rect = parseRect(player);
    const extras = parseWithSchema(invaderPlayerExtrasSchema, player);
    if (!rect || !extras) return null;
    const id = parseInvaderPlayerId(extras.id);
    return id ? { ...rect, id } : null;
  });
  return players.every((player): player is InvaderPlayer => player !== null) ? players : null;
}

function parseShots(value: unknown): InvaderShot[] | null {
  if (!Array.isArray(value)) return null;
  const shots = value.map((shot) => {
    const parsed = parseWithSchema(invaderShotSchema, shot);
    if (!parsed) return null;
    const playerId = parseInvaderPlayerId(parsed.playerId);
    return {
      x: parsed.x,
      y: parsed.y,
      vy: parsed.vy,
      owner: parsed.owner,
      ...(playerId ? { playerId } : {}),
    };
  });
  return shots.every((shot): shot is InvaderShot => shot !== null) ? shots : null;
}

function parseOnlineInvaderState(value: unknown): OnlineInvaderState | null {
  const parsed = parseWithSchema(onlineInvaderBaseSchema, value);
  if (!parsed) return null;
  const state = parseInvaderState(value);
  const difficulty = parseDifficulty(parsed.difficulty);
  return state && difficulty ? { ...state, difficulty } : null;
}

function parseInvaderPlayerId(value: unknown): InvaderPlayerId | null {
  return parseWithSchema(invaderPlayerIdSchema, value);
}

function parseMode(value: unknown): Mode | null {
  return parseWithSchema(invaderModeSchema, value);
}
