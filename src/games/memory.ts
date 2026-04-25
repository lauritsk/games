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
  setSelected,
  syncChildren,
  type Difficulty,
  type Direction,
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { loadGamePreferences, parseDifficulty, saveGamePreferences } from "../game-preferences";
import { recordGameResult } from "../game-results";
import {
  clearGameSave,
  createAutosave,
  createRunId,
  loadGameSave,
  saveGameSave,
} from "../game-state";
import { createMultiplayerCountdown, multiplayerCountdownNumber } from "../multiplayer-countdown";
import {
  connectMultiplayerSession,
  type MultiplayerConnection,
  type MultiplayerConnectionStatus,
} from "../multiplayer";
import { createMultiplayerDialog } from "../multiplayer-dialog";
import {
  parseMultiplayerSeat,
  type MultiplayerRoomSnapshot,
  type MultiplayerRoomStatus,
  type MultiplayerSeat,
  type MultiplayerSession,
} from "../multiplayer-protocol";
import { playSound } from "../sound";
import {
  changeDifficulty,
  createDifficultyControl,
  createModeControl,
  createResetControl,
  toggleMode,
} from "./controls";
import {
  allMemoryMatched,
  memoryConfigs,
  newMemoryDeck,
  openUnmatchedMemoryCards,
  type MemoryCard,
  type MemoryConfig,
} from "./memory.logic";

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
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "memory-game",
    boardClass: "board--memory",
    boardLabel: "Memory board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;

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
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const onlineDialog = createMultiplayerDialog();
  const onlineButton = el("button", {
    className: "button pill surface interactive",
    text: "Play online",
    type: "button",
  });
  onlineButton.addEventListener("click", () => {
    if (!onlineSession) onlineDialog.show(memory, startOnline);
  });
  actions.append(onlineButton);
  const rematchButton = el("button", {
    className: "button pill surface interactive",
    text: "Rematch",
    type: "button",
  });
  rematchButton.addEventListener("click", requestOnlineRematch);
  actions.append(rematchButton);
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

  function render(): void {
    setBoardGrid(grid, config.columns, config.rows);
    shell.dataset.turn = String(currentPlayer);
    status.textContent = statusText();
    modeButton.textContent = onlineSession ? "Online" : memoryModeLabel(mode);
    modeButton.disabled = Boolean(onlineSession);
    difficultyButton.textContent = onlineSession ? "Online" : difficulty;
    difficultyButton.disabled = Boolean(onlineSession);
    onlineButton.textContent = onlineSession ? `Room ${onlineSession.code}` : "Play online";
    onlineButton.disabled = Boolean(onlineSession);
    rematchButton.hidden = !canOnlineRematch();
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
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
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
    onlineSession = session;
    onlineSeat = session.seat;
    onlineRevision = 0;
    onlineStatus = "connecting";
    onlineRoomStatus = "lobby";
    onlineCountdownEndsAt = undefined;
    onlineResultRecorded = false;
    onlineError = "";
    runId = createRunId();
    config = memoryConfigs.Medium;
    cards = newMemoryDeck(config.pairs);
    selected = 0;
    moves = 0;
    currentPlayer = 1;
    scores = newScores();
    winner = null;
    lock = false;
    startedAt = null;
    onlineConnection = connectMultiplayerSession(session, {
      onSnapshot: (message) => applyOnlineSnapshot(message.room, message.you.seat),
      onError: (error, room) => {
        onlineError = error;
        if (room) applyOnlineSnapshot(room, onlineSeat ?? session.seat);
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

  function requestOnlineRematch(): void {
    if (!canOnlineRematch()) return;
    onlineError = "Starting rematch…";
    onlineConnection?.requestRematch(onlineRevision);
    render();
  }

  function canOnlineRematch(): boolean {
    return Boolean(onlineSession && winner);
  }

  function stopOnline(): void {
    onlineDialog.close();
    onlineConnection?.close();
    onlineConnection = null;
    onlineSession = null;
    onlineSeat = null;
    onlineRevision = 0;
    onlineStatus = "closed";
    onlineRoomStatus = "lobby";
    onlineCountdownEndsAt = undefined;
    onlineCountdown.cleanup();
    onlineError = "";
    onlineResultRecorded = false;
  }

  function applyOnlineSnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat): void {
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
    onlineCountdown.update(room);
    if (wasInFinishedOrStartedOnlineGame && state.moves === 0 && !state.winner) {
      resetGameProgress(shell);
      runId = createRunId();
      onlineResultRecorded = false;
      startedAt = null;
    }
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
    if (!onlineSeat) return "Joining…";
    if (onlineRoomStatus === "countdown") return `Starting in ${onlineCountdownText()}`;
    if (winner === "draw") return `Draw · ${scoreText()}`;
    if (winner) return winner === playerForSeat(onlineSeat) ? "You win" : "Opponent wins";
    if (onlineRevision === 0) return `Room ${onlineSession.code} · Waiting`;
    if (lock) return `Settling · ${scoreText()}`;
    return currentPlayer === playerForSeat(onlineSeat)
      ? `Your turn · ${scoreText()}`
      : `Opponent turn · ${scoreText()}`;
  }

  function onlineCountdownText(): string {
    const number = multiplayerCountdownNumber({
      code: onlineSession?.code ?? "",
      gameId: memory.id,
      status: onlineRoomStatus,
      revision: onlineRevision,
      seats: {
        p1: { joined: true, connected: true },
        p2: { joined: true, connected: true },
        p3: { joined: false, connected: false },
        p4: { joined: false, connected: false },
      },
      state: {},
      countdownEndsAt: onlineCountdownEndsAt,
    });
    return number === null ? "…" : String(number);
  }

  function recordOnlineFinished(state: OnlineMemoryState): void {
    if (onlineResultRecorded || !onlineSeat || !state.winner) return;
    onlineResultRecorded = true;
    const outcome = state.winner === "draw" ? "draw" : state.winner === onlineSeat ? "won" : "lost";
    recordGameResult({
      runId,
      gameId: memory.id,
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
  const config = configForCardCount(value.cards.length);
  if (!config) return null;
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
  return { cards, current, scores, moves, winner, pendingCloseAt };
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
