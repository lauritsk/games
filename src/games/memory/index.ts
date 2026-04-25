import {
  createDelayedAction,
  addTouchGestureControls,
  createGameShell,
  durationSince,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  isRecord,
  markGameFinished,
  markGameStarted,
  moveGridIndex,
  onDocumentKeyDown,
  parseOneOf,
  parseStartedAt,
  resetGameProgress,
  setBoardGrid,
  setIconLabel,
  setSelected,
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
  setDifficultyControlIconLabel,
  setPlayerModeIconLabel,
  toggleMode,
} from "@games/shared/controls";
import {
  allMemoryMatched,
  memoryConfigs,
  newMemoryDeck,
  openUnmatchedMemoryCards,
  type MemoryCard,
  type MemoryConfig,
} from "@games/memory/logic";

type MemoryMode = "solo" | "local";
type MemoryPlayer = 1 | 2;
type MemoryScores = Record<MemoryPlayer, number>;

type SaveMemory = {
  difficulty: Difficulty;
  mode: MemoryMode;
  cards: MemoryCard[];
  selected: number;
  moves: number;
  currentPlayer: MemoryPlayer;
  scores: MemoryScores;
  winner: MemoryPlayer | "draw" | null;
  startedAt: number | null;
};

type OnlineMemoryState = {
  difficulty: Difficulty;
  cards: MemoryCard[];
  current: MultiplayerSeat;
  scores: Record<MultiplayerSeat, number>;
  moves: number;
  winner: MultiplayerSeat | "draw" | null;
  pendingCloseAt: number | null;
};

const savePayloadVersion = 2;

export const memory: GameDefinition = {
  id: "memory",
  name: "Memory",
  tagline: "Flip cards. Match pairs.",
  players: "Solo, local, or online",
  theme: "deep-ocean",
  mount: mountMemory,
};

export function mountMemory(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(memory.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let mode: MemoryMode = parseMemoryMode(preferences.options?.mode) ?? "solo";
  let config = memoryConfigs[difficulty];
  let cards = newMemoryDeck(config.pairs);
  let selected = 0;
  let moves = 0;
  let currentPlayer: MemoryPlayer = 1;
  let scores: MemoryScores = newScores();
  let winner: MemoryPlayer | "draw" | null = null;
  let lock = false;
  let startedAt: number | null = null;
  let runId = createRunId();
  let onlineSession: MultiplayerSession | null = null;
  let onlineConnection: MultiplayerConnection | null = null;
  let onlineSeat: MultiplayerSeat | null = null;
  let onlineRevision = 0;
  let onlineStatus: MultiplayerConnectionStatus = "closed";
  let onlineRoomStatus: MultiplayerRoomStatus = "lobby";
  let onlineCountdownEndsAt: number | undefined;
  let onlineSeats = emptyMultiplayerSeatSnapshots();
  let onlineResultRecorded = false;
  let onlineError = "";

  const saved = loadGameSave(memory.id, savePayloadVersion, parseSaveMemory);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    mode = saved.payload.mode;
    config = memoryConfigs[difficulty];
    cards = saved.payload.cards;
    selected = saved.payload.selected;
    moves = saved.payload.moves;
    currentPlayer = saved.payload.currentPlayer;
    scores = saved.payload.scores;
    winner = saved.payload.winner;
    startedAt = saved.payload.startedAt;
  }

  const {
    shell,
    status,
    actions,
    viewport,
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "memory-game",
    boardClass: "board--memory",
    boardLabel: "Memory board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;
  const onlinePresence = el("div", { className: "online-presence-host" });
  viewport.append(onlinePresence);

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const pendingFlip = createDelayedAction();
  const onlineCountdown = createMultiplayerCountdown(render);
  const modeControl = {
    get: () => mode,
    set: (next: MemoryMode) => {
      mode = next;
      savePreferences();
    },
    next: nextMemoryMode,
    label: memoryModeLabel,
    reset: resetGame,
  };
  const modeButton = createModeControl(actions, modeControl);
  const difficultyControl = {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
      savePreferences();
    },
    reset: resetAfterDifficultyChange,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const {
    onlineButton,
    startOnlineButton,
    rematchButton,
    closeDialog: closeOnlineDialog,
  } = createMultiplayerActionButtons(actions, {
    game: memory,
    getSession: () => onlineSession,
    onSession: startOnline,
    onStart: requestOnlineStart,
    onRematch: requestOnlineRematch,
    getSettings: onlineSettings,
  });
  const requestReset = createResetControl(actions, shell, resetGame);
  onDocumentKeyDown(onKeyDown, scope);
  addTouchGestureControls(
    grid,
    { onSwipe: moveSelection },
    { signal: scope.signal, touchAction: "none" },
  );
  const autosave = createAutosave({ gameId: memory.id, scope, save: saveCurrentGame });

  function resetGame(): void {
    stopOnline();
    pendingFlip.clear();
    clearGameSave(memory.id);
    resetGameProgress(shell);
    runId = createRunId();
    config = memoryConfigs[difficulty];
    cards = newMemoryDeck(config.pairs);
    selected = 0;
    moves = 0;
    currentPlayer = 1;
    scores = newScores();
    winner = null;
    lock = false;
    startedAt = null;
    savePreferences();
    render();
  }

  function resetAfterDifficultyChange(): void {
    if (onlineSession) {
      requestOnlineSettings();
      return;
    }
    resetGame();
  }

  function render(): void {
    setBoardGrid(grid, config.columns, config.rows);
    shell.dataset.turn = String(currentPlayer);
    status.textContent = statusText();
    renderMultiplayerPresence(onlinePresence, {
      gameId: memory.id,
      session: onlineSession,
      seat: onlineSeat,
      status: onlineRoomStatus,
      seats: onlineSeats,
      countdown: onlineCountdownText(),
    });
    setPlayerModeIconLabel(modeButton, onlineSession ? "Online" : memoryModeLabel(mode));
    modeButton.disabled = Boolean(onlineSession);
    setDifficultyControlIconLabel(difficultyButton, difficulty);
    difficultyButton.disabled = Boolean(onlineSession && !canAdjustOnlineSettings());
    setIconLabel(onlineButton, "🌐", onlineSession ? "Online" : "Play online");
    onlineButton.disabled = Boolean(onlineSession);
    startOnlineButton.hidden = !onlineSession || onlineRoomStatus !== "lobby";
    startOnlineButton.disabled = !canOnlineStart();
    rematchButton.hidden = !isOnlineFinished() || !onlineSeat;
    setIconLabel(
      rematchButton,
      onlineSeat === "p1" ? "▶" : "✓",
      multiplayerRematchActionLabel(onlineSeat, currentSeatReady()),
    );
    rematchButton.disabled = onlineStatus !== "connected" || !canOnlineRematch();

    const tiles = syncChildren(grid, cards.length, (index) => {
      const tile = el("button", { className: "game-cell memory-card", type: "button" });
      tile.addEventListener("click", () => flip(index));
      tile.addEventListener("pointerenter", () => {
        if (selected === index) return;
        selected = index;
        render();
      });
      return tile;
    });
    cards.forEach((card, index) => {
      const faceUp = card.open || card.matched;
      const tile = tiles[index];
      if (!tile) return;
      tile.setAttribute("aria-label", labelFor(card, index));
      tile.textContent = faceUp ? card.symbol : "?";
      tile.dataset.open = String(faceUp);
      tile.dataset.matched = String(card.matched);
      setSelected(tile, index === selected);
      tile.disabled = false;
      tile.setAttribute("aria-disabled", String(isFlipBlocked(card)));
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      if (!onlineSession) toggleMode(modeControl);
      return;
    }
    handleStandardGameKey(event, {
      onDirection: moveSelection,
      onActivate: () => flip(selected),
      onNextDifficulty: () => {
        if (!onlineSession || canAdjustOnlineSettings())
          changeDifficulty(difficultyControl, "next");
      },
      onPreviousDifficulty: () => {
        if (!onlineSession || canAdjustOnlineSettings())
          changeDifficulty(difficultyControl, "previous");
      },
      onReset: requestReset,
    });
  }

  function moveSelection(direction: Direction): void {
    selected = moveGridIndex(selected, direction, config.columns, cards.length);
    render();
  }

  function flip(index: number): void {
    if (isLocked()) return;
    const card = cards[index];
    if (!card || card.open || card.matched) {
      invalidMove.trigger();
      return;
    }
    if (onlineSession) {
      onlineConnection?.sendAction(onlineRevision, { type: "flip", index });
      return;
    }
    flipLocal(index);
  }

  function flipLocal(index: number): void {
    const card = cards[index];
    if (!card) return;
    ensureStarted();
    card.open = true;
    const open = openUnmatchedMemoryCards(cards);

    if (open.length === 2) {
      moves += 1;
      const [a, b] = open;
      if (!a || !b) return;
      if (a.symbol === b.symbol) {
        a.matched = true;
        b.matched = true;
        a.open = false;
        b.open = false;
        if (mode === "local") scores = { ...scores, [currentPlayer]: scores[currentPlayer] + 1 };
        if (allMemoryMatched(cards)) {
          winner = mode === "local" ? localWinner(scores) : null;
          markGameFinished(shell);
          recordFinishedGame();
          clearGameSave(memory.id);
          playSound(mode === "solo" || winner === 1 ? "gameWin" : "gameMajor");
        } else {
          saveCurrentGame();
          playSound("gameGood");
        }
      } else {
        playSound("gameBad");
        lock = true;
        pendingFlip.start(() => {
          a.open = false;
          b.open = false;
          if (mode === "local") currentPlayer = otherPlayer(currentPlayer);
          lock = false;
          saveCurrentGame();
          render();
        }, 650);
      }
    } else {
      saveCurrentGame();
      playSound("gameMove");
    }

    render();
  }

  function statusText(): string {
    if (onlineSession) return onlineStatusText();
    if (mode === "local") {
      if (winner === "draw") return `Draw · ${scoreText()}`;
      if (winner) return `P${winner} wins · ${scoreText()}`;
      return `P${currentPlayer} turn · ${scoreText()}`;
    }
    return allMemoryMatched(cards) ? `Won · ${moves}` : `Moves ${moves}`;
  }

  function scoreText(): string {
    return `${scores[1]}-${scores[2]}`;
  }

  function isLocked(): boolean {
    if (onlineSession) {
      return (
        onlineStatus !== "connected" ||
        onlineRoomStatus !== "playing" ||
        !onlineSeat ||
        winner !== null ||
        lock ||
        currentPlayer !== playerForSeat(onlineSeat)
      );
    }
    return lock || (mode === "local" && winner !== null) || allMemoryMatched(cards);
  }

  function isFlipBlocked(card: MemoryCard): boolean {
    return isLocked() || card.open || card.matched;
  }

  function recordFinishedGame(): void {
    const outcome = mode === "solo" ? "completed" : winner === "draw" ? "draw" : "won";
    recordGameResult({
      runId,
      gameId: memory.id,
      difficulty,
      outcome,
      moves,
      durationMs: durationMs(),
      metadata:
        mode === "solo"
          ? { mode }
          : { mode, winner: winner ?? "draw", p1Pairs: scores[1], p2Pairs: scores[2] },
    });
  }

  function ensureStarted(): void {
    if (startedAt === null) startedAt = Date.now();
    markGameStarted(shell);
  }

  function saveCurrentGame(): void {
    if (onlineSession || startedAt === null) return;
    if (allMemoryMatched(cards)) {
      clearGameSave(memory.id);
      return;
    }
    saveGameSave(memory.id, savePayloadVersion, {
      runId,
      status: "playing",
      payload: {
        difficulty,
        mode,
        cards: cardsForSave(),
        selected,
        moves,
        currentPlayer,
        scores,
        winner,
        startedAt,
      },
    });
  }

  function cardsForSave(): MemoryCard[] {
    const open = openUnmatchedMemoryCards(cards);
    const closePendingMismatch = lock && open.length === 2 && open[0]?.symbol !== open[1]?.symbol;
    return cards.map((card) => ({
      ...card,
      open: closePendingMismatch && card.open && !card.matched ? false : card.open,
    }));
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(memory.id, { difficulty, options: { mode } });
  }

  function startOnline(session: MultiplayerSession): void {
    pendingFlip.clear();
    clearGameSave(memory.id);
    resetGameProgress(shell);
    onlineConnection?.close();
    const spectator = session.role === "spectator";
    onlineSession = session;
    onlineSeat = spectator ? null : session.seat;
    onlineRevision = 0;
    onlineStatus = "connecting";
    onlineRoomStatus = "lobby";
    onlineCountdownEndsAt = undefined;
    onlineSeats = emptyMultiplayerSeatSnapshots();
    if (!spectator) onlineSeats[session.seat] = { joined: true, connected: false };
    onlineResultRecorded = false;
    onlineError = "";
    runId = createRunId();
    config = memoryConfigs[difficulty];
    cards = newMemoryDeck(config.pairs);
    selected = 0;
    moves = 0;
    currentPlayer = 1;
    scores = newScores();
    winner = null;
    lock = false;
    startedAt = null;
    onlineConnection = connectMultiplayerSession(session, {
      onSnapshot: (message) =>
        applyOnlineSnapshot(
          message.room,
          message.you.role === "spectator" ? null : message.you.seat,
        ),
      onError: (error, room) => {
        onlineError = error;
        if (room) applyOnlineSnapshot(room, onlineSeat);
        else render();
      },
      onStatus: (status) => {
        onlineStatus = status;
        if (status === "connected") onlineError = "";
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

  function requestOnlineSettings(): void {
    if (!canAdjustOnlineSettings()) return;
    onlineError = "Updating settings…";
    onlineConnection?.updateSettings(onlineRevision, onlineSettings());
    render();
  }

  function requestOnlineRematch(): void {
    if (!canOnlineRematch()) return;
    onlineError = onlineSeat === "p1" ? "Starting rematch…" : "Ready for rematch…";
    onlineConnection?.requestRematch(onlineRevision);
    render();
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

  function canAdjustOnlineSettings(): boolean {
    return Boolean(
      onlineSession &&
      onlineSeat === "p1" &&
      onlineStatus === "connected" &&
      onlineRoomStatus === "lobby",
    );
  }

  function onlineSettings(): { difficulty: Difficulty } {
    return { difficulty };
  }

  function canOnlineRematch(): boolean {
    return canRequestMultiplayerRematch(isOnlineFinished(), onlineSeat, currentSeatReady());
  }

  function isOnlineFinished(): boolean {
    return Boolean(onlineSession && winner);
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
    onlineError = "";
    onlineResultRecorded = false;
  }

  function applyOnlineSnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat | null): void {
    const state = parseOnlineMemoryState(room.state);
    if (!state || room.gameId !== memory.id) return;
    const nextConfig = configForCardCount(state.cards.length);
    if (!nextConfig) return;
    const wasInFinishedOrStartedOnlineGame = onlineResultRecorded || winner !== null || moves > 0;
    onlineError = "";
    onlineSeat = seat;
    onlineRevision = room.revision;
    onlineRoomStatus = room.status;
    onlineCountdownEndsAt = room.countdownEndsAt;
    onlineSeats = room.seats;
    onlineCountdown.update(room);
    if (wasInFinishedOrStartedOnlineGame && state.moves === 0 && !state.winner) {
      resetGameProgress(shell);
      runId = createRunId();
      onlineResultRecorded = false;
      startedAt = null;
    }
    difficulty = state.difficulty;
    config = nextConfig;
    cards = state.cards;
    currentPlayer = playerForSeat(state.current);
    scores = { 1: state.scores.p1, 2: state.scores.p2 };
    moves = state.moves;
    winner = onlineWinnerForLocal(state.winner);
    lock = state.pendingCloseAt !== null;
    if (moves > 0) {
      if (startedAt === null) startedAt = Date.now();
      markGameStarted(shell);
    }
    if (state.winner) {
      markGameFinished(shell);
      recordOnlineFinished(state);
    }
    render();
  }

  function onlineStatusText(): string {
    if (onlineError) return onlineError;
    if (onlineStatus === "connecting") return "Connecting…";
    if (onlineStatus === "reconnecting") return "Reconnecting…";
    if (!onlineSession) return "Online";
    if (!onlineSeat) return spectatorStatusText();
    if (onlineRoomStatus === "countdown") return `Starting in ${onlineCountdownText()}`;
    if (onlineRoomStatus === "lobby") {
      const joined = multiplayerJoinedSeatCount(onlineSeats);
      if (onlineSeat === "p1") return `${joined}/2 · Start at 2`;
      return "Waiting host";
    }
    if (winner === "draw") {
      return multiplayerRematchStatusText({
        result: `Draw · ${scoreText()}`,
        localSeat: onlineSeat,
        seats: onlineSeats,
      });
    }
    if (winner) {
      const result = winner === playerForSeat(onlineSeat) ? "You win" : "Opponent wins";
      return multiplayerRematchStatusText({
        result: `${result} · ${scoreText()}`,
        localSeat: onlineSeat,
        seats: onlineSeats,
      });
    }
    if (onlineRevision === 0) return "Waiting";
    if (lock) return `Settling · ${scoreText()}`;
    return currentPlayer === playerForSeat(onlineSeat)
      ? `Your turn · ${scoreText()}`
      : `Opponent turn · ${scoreText()}`;
  }

  function spectatorStatusText(): string {
    if (!onlineSession) return "Spectating";
    if (onlineRoomStatus === "countdown")
      return `Spectating · Starting in ${onlineCountdownText()}`;
    if (onlineRoomStatus === "lobby") return "Spectating";
    if (winner === "draw") return `Spectating · Draw · ${scoreText()}`;
    if (winner) return `Spectating · P${winner} wins · ${scoreText()}`;
    if (onlineRevision === 0) return "Spectating";
    if (lock) return `Spectating · Settling · ${scoreText()}`;
    return `Spectating · P${currentPlayer} turn · ${scoreText()}`;
  }

  function onlineCountdownText(): string {
    return multiplayerCountdownText({
      status: onlineRoomStatus,
      countdownEndsAt: onlineCountdownEndsAt,
    });
  }

  function recordOnlineFinished(state: OnlineMemoryState): void {
    if (onlineResultRecorded || !onlineSeat || !state.winner) return;
    onlineResultRecorded = true;
    const outcome = state.winner === "draw" ? "draw" : state.winner === onlineSeat ? "won" : "lost";
    recordGameResult({
      runId,
      gameId: memory.id,
      difficulty: state.difficulty,
      outcome,
      moves: state.moves,
      metadata: {
        mode: "online",
        seat: onlineSeat,
        winner: state.winner,
        p1Pairs: state.scores.p1,
        p2Pairs: state.scores.p2,
      },
    });
  }

  function labelFor(card: MemoryCard, index: number): string {
    const row = Math.floor(index / config.columns) + 1;
    const column = (index % config.columns) + 1;
    if (card.matched) return `Row ${row}, column ${column}, matched ${card.symbol}`;
    if (card.open) return `Row ${row}, column ${column}, open ${card.symbol}`;
    return `Row ${row}, column ${column}, hidden card`;
  }

  if (startedAt !== null) markGameStarted(shell);
  render();
  return () => {
    autosave.flush();
    pendingFlip.clear();
    invalidMove.cleanup();
    stopOnline();
    onlineCountdown.cleanup();
    scope.cleanup();
    remove();
  };
}

function nextMemoryMode(mode: MemoryMode): MemoryMode {
  return mode === "solo" ? "local" : "solo";
}

function memoryModeLabel(mode: MemoryMode): string {
  return mode === "solo" ? "Solo" : "2 players";
}

function parseMemoryMode(value: unknown): MemoryMode | null {
  return parseOneOf(value, ["solo", "local"] as const);
}

function newScores(): MemoryScores {
  return { 1: 0, 2: 0 };
}

function otherPlayer(player: MemoryPlayer): MemoryPlayer {
  return player === 1 ? 2 : 1;
}

function localWinner(scores: MemoryScores): MemoryPlayer | "draw" {
  if (scores[1] === scores[2]) return "draw";
  return scores[1] > scores[2] ? 1 : 2;
}

function playerForSeat(seat: MultiplayerSeat): MemoryPlayer {
  return seat === "p1" ? 1 : 2;
}

function onlineWinnerForLocal(
  value: MultiplayerSeat | "draw" | null,
): MemoryPlayer | "draw" | null {
  if (value === null || value === "draw") return value;
  return playerForSeat(value);
}

function configForCardCount(length: number): MemoryConfig | null {
  return Object.values(memoryConfigs).find((entry) => entry.pairs * 2 === length) ?? null;
}

function parseSaveMemory(value: unknown): SaveMemory | null {
  if (!isRecord(value)) return null;
  const difficulty = parseDifficulty(value.difficulty);
  if (!difficulty) return null;
  const config = memoryConfigs[difficulty];
  const cards = parseCards(value.cards, config.pairs * 2);
  if (!cards) return null;
  if (typeof value.selected !== "number" || value.selected < 0 || value.selected >= cards.length)
    return null;
  if (typeof value.moves !== "number" || !Number.isInteger(value.moves) || value.moves < 0)
    return null;
  const mode = parseMemoryMode(value.mode);
  if (!mode) return null;
  const currentPlayer = parseMemoryPlayer(value.currentPlayer);
  const scores = parseMemoryScores(value.scores);
  const winner = parseMemoryWinner(value.winner);
  if (!currentPlayer || !scores || winner === undefined) return null;
  const startedAt = parseStartedAt(value.startedAt);
  if (startedAt === undefined) return null;
  return {
    difficulty,
    mode,
    cards,
    selected: value.selected,
    moves: value.moves,
    currentPlayer,
    scores,
    winner,
    startedAt,
  };
}

function parseCards(value: unknown, length: number): MemoryCard[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const cards = value.map(parseCard);
  return cards.every((card): card is MemoryCard => card !== null) ? cards : null;
}

function parseCard(value: unknown): MemoryCard | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "number" || !Number.isInteger(value.id)) return null;
  if (typeof value.symbol !== "string") return null;
  if (typeof value.open !== "boolean" || typeof value.matched !== "boolean") return null;
  return { id: value.id, symbol: value.symbol, open: value.open, matched: value.matched };
}

function parseMemoryPlayer(value: unknown): MemoryPlayer | null {
  return parseOneOf(value, [1, 2] as const);
}

function parseMemoryScores(value: unknown): MemoryScores | null {
  if (!isRecord(value)) return null;
  const p1 = value[1];
  const p2 = value[2];
  if (typeof p1 !== "number" || !Number.isInteger(p1) || p1 < 0) return null;
  if (typeof p2 !== "number" || !Number.isInteger(p2) || p2 < 0) return null;
  return { 1: p1, 2: p2 };
}

function parseMemoryWinner(value: unknown): MemoryPlayer | "draw" | null | undefined {
  if (value === null || value === "draw") return value;
  return parseMemoryPlayer(value) ?? undefined;
}

function parseOnlineMemoryState(value: unknown): OnlineMemoryState | null {
  if (!isRecord(value) || !Array.isArray(value.cards)) return null;
  const difficulty = parseDifficulty(value.difficulty);
  if (!difficulty) return null;
  const config = memoryConfigs[difficulty];
  if (value.cards.length !== config.pairs * 2) return null;
  const cards = parseCards(value.cards, config.pairs * 2);
  const current = parseMultiplayerSeat(value.current);
  const scores = parseOnlineScores(value.scores);
  const winner = parseOnlineWinner(value.winner);
  if (!cards || !current || !scores || winner === undefined) return null;
  const moves = typeof value.moves === "number" && Number.isInteger(value.moves) ? value.moves : 0;
  const pendingCloseAt =
    typeof value.pendingCloseAt === "number" && Number.isFinite(value.pendingCloseAt)
      ? value.pendingCloseAt
      : null;
  return { difficulty, cards, current, scores, moves, winner, pendingCloseAt };
}

function parseOnlineScores(value: unknown): Record<MultiplayerSeat, number> | null {
  if (!isRecord(value)) return null;
  const scores = { p1: 0, p2: 0, p3: 0, p4: 0 } satisfies Record<MultiplayerSeat, number>;
  for (const seat of ["p1", "p2", "p3", "p4"] as const) {
    const score = value[seat];
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0) return null;
    scores[seat] = score;
  }
  return scores;
}

function parseOnlineWinner(value: unknown): MultiplayerSeat | "draw" | null | undefined {
  if (value === null || value === "draw") return value;
  return parseMultiplayerSeat(value) ?? undefined;
}
