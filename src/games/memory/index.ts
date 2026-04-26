import * as v from "valibot";
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
  finiteNumberSchema,
  integerRangeSchema,
  integerSchema,
  nonNegativeIntegerSchema,
  parseFixedArray,
  parseWithSchema,
  picklistSchema,
  markGameFinished,
  markGameStarted,
  moveGridIndex,
  onDocumentKeyDown,
  parseStartedAt,
  resetGameProgress,
  setBoardGrid,
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
import { createMultiplayerActionButtons } from "@features/multiplayer/multiplayer-actions";
import { createMultiplayerGameClient } from "@features/multiplayer/multiplayer-game-client";
import {
  multiplayerJoinedSeatCount,
  multiplayerRematchStatusText,
  parseMultiplayerSeat,
  parseMultiplayerWinner,
  type MultiplayerRoomSnapshot,
  type MultiplayerSeat,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";
import { playSound } from "@ui/sound";
import {
  createGameDifficultyControl,
  createModeControl,
  createResetControl,
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

const memoryModeSchema = picklistSchema(["solo", "local"] as const);
const memoryPlayerSchema = picklistSchema([1, 2] as const);
const memoryCardSchema = v.object({
  id: integerSchema,
  symbol: v.string(),
  open: v.boolean(),
  matched: v.boolean(),
});
const memoryScoresSchema = v.object({
  1: nonNegativeIntegerSchema,
  2: nonNegativeIntegerSchema,
});
const saveMemoryBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  cards: v.unknown(),
  selected: v.unknown(),
  moves: nonNegativeIntegerSchema,
  mode: v.unknown(),
  currentPlayer: v.unknown(),
  scores: v.unknown(),
  winner: v.unknown(),
  startedAt: v.unknown(),
});
const onlineMemoryBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  cards: v.unknown(),
  current: v.unknown(),
  scores: v.unknown(),
  winner: v.unknown(),
  moves: v.optional(nonNegativeIntegerSchema, 0),
  pendingCloseAt: v.optional(v.unknown()),
});
const onlineScoresSchema = v.object({
  p1: nonNegativeIntegerSchema,
  p2: nonNegativeIntegerSchema,
  p3: nonNegativeIntegerSchema,
  p4: nonNegativeIntegerSchema,
});

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
  const online = createMultiplayerGameClient({
    game: memory,
    render,
    applySnapshot: applyOnlineSnapshot,
  });
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
  const difficultyControl = createGameDifficultyControl(actions, {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
      savePreferences();
    },
    reset: resetAfterDifficultyChange,
  });
  const {
    onlineButton,
    startOnlineButton,
    rematchButton,
    closeDialog: closeOnlineDialog,
  } = createMultiplayerActionButtons(actions, {
    game: memory,
    getSession: () => online.session,
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
    if (online.session) {
      requestOnlineSettings();
      return;
    }
    resetGame();
  }

  function render(): void {
    setBoardGrid(grid, config.columns, config.rows);
    shell.dataset.turn = String(currentPlayer);
    status.textContent = statusText();
    online.renderPresence(onlinePresence);
    setPlayerModeIconLabel(modeButton, online.session ? "Online" : memoryModeLabel(mode));
    modeButton.disabled = Boolean(online.session);
    difficultyControl.sync(difficulty, Boolean(online.session && !canAdjustOnlineSettings()));
    online.syncActionButtons(
      { onlineButton, startOnlineButton, rematchButton },
      isOnlineFinished(),
    );

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
      if (!online.session) toggleMode(modeControl);
      return;
    }
    handleStandardGameKey(event, {
      onDirection: moveSelection,
      onActivate: () => flip(selected),
      onNextDifficulty: () => {
        if (!online.session || canAdjustOnlineSettings()) difficultyControl.next();
      },
      onPreviousDifficulty: () => {
        if (!online.session || canAdjustOnlineSettings()) difficultyControl.previous();
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
    if (online.session) {
      online.connection?.sendAction(online.revision, { type: "flip", index });
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
    if (online.session) return onlineStatusText();
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
    if (online.session) {
      return (
        online.connectionStatus !== "connected" ||
        online.roomStatus !== "playing" ||
        !online.seat ||
        winner !== null ||
        lock ||
        currentPlayer !== playerForSeat(online.seat)
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
    if (online.session || startedAt === null) return;
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
    online.start(session, () => {
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

  function canAdjustOnlineSettings(): boolean {
    return online.canAdjustSettings();
  }

  function onlineSettings(): { difficulty: Difficulty } {
    return { difficulty };
  }

  function isOnlineFinished(): boolean {
    return Boolean(online.session && winner);
  }

  function stopOnline(): void {
    closeOnlineDialog();
    online.stop();
  }

  function applyOnlineSnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat | null): void {
    const state = parseOnlineMemoryState(room.state);
    if (!state || room.gameId !== memory.id) return;
    const nextConfig = configForCardCount(state.cards.length);
    if (!nextConfig) return;
    const wasInFinishedOrStartedOnlineGame = online.resultRecorded || winner !== null || moves > 0;
    online.applySnapshot(room, seat);
    if (wasInFinishedOrStartedOnlineGame && state.moves === 0 && !state.winner) {
      resetGameProgress(shell);
      runId = createRunId();
      online.resultRecorded = false;
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
    if (online.error) return online.error;
    if (online.connectionStatus === "connecting") return "Connecting…";
    if (online.connectionStatus === "reconnecting") return "Reconnecting…";
    if (!online.session) return "Online";
    if (!online.seat) return spectatorStatusText();
    if (online.roomStatus === "countdown") return `Starting in ${online.countdownText()}`;
    if (online.roomStatus === "lobby") {
      const joined = multiplayerJoinedSeatCount(online.seats);
      if (online.seat === "p1") return `${joined}/2 · Start at 2`;
      return "Waiting host";
    }
    if (winner === "draw") {
      return multiplayerRematchStatusText({
        result: `Draw · ${scoreText()}`,
        localSeat: online.seat,
        seats: online.seats,
      });
    }
    if (winner) {
      const result = winner === playerForSeat(online.seat) ? "You win" : "Opponent wins";
      return multiplayerRematchStatusText({
        result: `${result} · ${scoreText()}`,
        localSeat: online.seat,
        seats: online.seats,
      });
    }
    if (online.revision === 0) return "Waiting";
    if (lock) return `Settling · ${scoreText()}`;
    return currentPlayer === playerForSeat(online.seat)
      ? `Your turn · ${scoreText()}`
      : `Opponent turn · ${scoreText()}`;
  }

  function spectatorStatusText(): string {
    if (!online.session) return "Spectating";
    if (online.roomStatus === "countdown")
      return `Spectating · Starting in ${online.countdownText()}`;
    if (online.roomStatus === "lobby") return "Spectating";
    if (winner === "draw") return `Spectating · Draw · ${scoreText()}`;
    if (winner) return `Spectating · P${winner} wins · ${scoreText()}`;
    if (online.revision === 0) return "Spectating";
    if (lock) return `Spectating · Settling · ${scoreText()}`;
    return `Spectating · P${currentPlayer} turn · ${scoreText()}`;
  }

  function recordOnlineFinished(state: OnlineMemoryState): void {
    if (online.resultRecorded || !online.seat || !state.winner) return;
    online.resultRecorded = true;
    const outcome =
      state.winner === "draw" ? "draw" : state.winner === online.seat ? "won" : "lost";
    recordGameResult({
      runId,
      gameId: memory.id,
      difficulty: state.difficulty,
      outcome,
      moves: state.moves,
      metadata: {
        mode: "online",
        seat: online.seat,
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
  return parseWithSchema(memoryModeSchema, value);
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
  const parsed = parseWithSchema(saveMemoryBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  if (!difficulty) return null;
  const config = memoryConfigs[difficulty];
  const cards = parseCards(parsed.cards, config.pairs * 2);
  if (!cards) return null;
  const selected = parseWithSchema(integerRangeSchema(0, cards.length), parsed.selected);
  if (selected === null) return null;
  const mode = parseMemoryMode(parsed.mode);
  if (!mode) return null;
  const currentPlayer = parseMemoryPlayer(parsed.currentPlayer);
  const scores = parseMemoryScores(parsed.scores);
  const winner = parseMemoryWinner(parsed.winner);
  if (!currentPlayer || !scores || winner === undefined) return null;
  const startedAt = parseStartedAt(parsed.startedAt);
  if (startedAt === undefined) return null;
  return {
    difficulty,
    mode,
    cards,
    selected,
    moves: parsed.moves,
    currentPlayer,
    scores,
    winner,
    startedAt,
  };
}

function parseCards(value: unknown, length: number): MemoryCard[] | null {
  return parseFixedArray(value, length, parseCard);
}

function parseCard(value: unknown): MemoryCard | null {
  return parseWithSchema(memoryCardSchema, value);
}

function parseMemoryPlayer(value: unknown): MemoryPlayer | null {
  return parseWithSchema(memoryPlayerSchema, value);
}

function parseMemoryScores(value: unknown): MemoryScores | null {
  const scores = parseWithSchema(memoryScoresSchema, value);
  return scores ? { 1: scores[1], 2: scores[2] } : null;
}

function parseMemoryWinner(value: unknown): MemoryPlayer | "draw" | null | undefined {
  if (value === null || value === "draw") return value;
  return parseMemoryPlayer(value) ?? undefined;
}

function parseOnlineMemoryState(value: unknown): OnlineMemoryState | null {
  const parsed = parseWithSchema(onlineMemoryBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  if (!difficulty) return null;
  const config = memoryConfigs[difficulty];
  const cards = parseCards(parsed.cards, config.pairs * 2);
  const current = parseMultiplayerSeat(parsed.current);
  const scores = parseOnlineScores(parsed.scores);
  const winner = parseMultiplayerWinner(parsed.winner);
  if (!cards || !current || !scores || winner === undefined) return null;
  const pendingCloseAt = parseWithSchema(finiteNumberSchema, parsed.pendingCloseAt);
  return {
    difficulty,
    cards,
    current,
    scores,
    moves: parsed.moves,
    winner,
    pendingCloseAt,
  };
}

function parseOnlineScores(value: unknown): Record<MultiplayerSeat, number> | null {
  return parseWithSchema(onlineScoresSchema, value);
}
