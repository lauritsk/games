import * as v from "valibot";
import {
  addTouchGestureControls,
  createDelayedAction,
  createGameShell,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  integerSchema,
  moveGridIndex,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  parseFixedArray,
  parseWithSchema,
  picklistSchema,
  resetGameProgress,
  setBoardGrid,
  setSelected,
  syncChildren,
  type Difficulty,
  type Direction,
  type GameDefinition,
} from "@shared/core";
import { createInvalidMoveFeedback } from "@ui/feedback";
import { getBotStreak, recordBotStreakOutcome, resetBotStreak } from "@features/bot-streaks";
import {
  loadGamePreferences,
  parseDifficulty,
  saveGamePreferences,
} from "@games/shared/game-preferences";
import { recordGameResult } from "@features/results/game-results";
import { clearGameSave, createRunId, loadGameSave, saveGameSave } from "@games/shared/game-state";
import { createMultiplayerActionButtons } from "@features/multiplayer/multiplayer-actions";
import { createMultiplayerGameClient } from "@features/multiplayer/multiplayer-game-client";
import {
  multiplayerJoinedSeatCount,
  multiplayerRematchStatusText,
  parseMultiplayerSeat,
  type MultiplayerRoomSnapshot,
  type MultiplayerSeat,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";
import { playSound } from "@ui/sound";
import {
  botPlayModeLabel,
  createGameDifficultyControl,
  createModeControl,
  createResetControl,
  nextBotPlayMode,
  setBotPlayModeIconLabel,
  toggleMode,
  type BotPlayMode,
} from "@games/shared/controls";
import {
  botMark,
  chooseTicTacToeBotMove,
  getTicTacToeWinner,
  humanMark,
  newTicTacToeBoard,
  ticTacToeSize,
  type Mark,
  type TicTacToeCell,
} from "@games/tictactoe/logic";

const savePayloadVersion = 1;

type SaveTicTacToe = {
  board: TicTacToeCell[];
  current: Mark;
  mode: BotPlayMode;
  difficulty: Difficulty;
  winner: Mark | "draw" | null;
};

type OnlineTicTacToeState = {
  board: TicTacToeCell[];
  current: MultiplayerSeat;
  winner: MultiplayerSeat | "draw" | null;
  winLine: readonly number[];
  moves: number;
};

const botPlayModeSchema = picklistSchema(["bot", "local"] as const);
const ticTacToeCellSchema = picklistSchema([humanMark, botMark, ""] as const);
const ticTacToeMarkSchema = picklistSchema([humanMark, botMark] as const);
const saveTicTacToeBaseSchema = v.looseObject({
  board: v.unknown(),
  current: v.unknown(),
  mode: v.unknown(),
  difficulty: v.unknown(),
  winner: v.unknown(),
});
const onlineTicTacToeBaseSchema = v.looseObject({
  board: v.unknown(),
  current: v.unknown(),
  winner: v.unknown(),
  winLine: v.optional(v.unknown()),
  moves: v.optional(integerSchema, 0),
});

export const tictactoe: GameDefinition = {
  id: "tictactoe",
  name: "Tic-Tac-Toe",
  tagline: "Three in a row.",
  players: "Solo, local, or online",
  theme: "deep-forest",
  mount: mountTicTacToe,
};

export function mountTicTacToe(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(tictactoe.id);
  let board = newTicTacToeBoard();
  let current: Mark = humanMark;
  let mode: BotPlayMode = parseBotPlayMode(preferences.options?.mode) ?? "bot";
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let selected = 4;
  let winner: Mark | "draw" | null = null;
  let winLine: readonly number[] = [];
  let runId = createRunId();
  let skipNextAbandonStreakReset = false;

  const saved = loadGameSave(tictactoe.id, savePayloadVersion, parseSaveTicTacToe);
  if (saved) {
    runId = saved.runId;
    board = saved.payload.board;
    current = saved.payload.current;
    mode = saved.payload.mode;
    difficulty = saved.payload.difficulty;
    winner = saved.payload.winner;
    if (winner && winner !== "draw") winLine = getTicTacToeWinner(board)?.line ?? [];
  }

  const {
    shell,
    status,
    actions,
    viewport,
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "tictactoe",
    boardClass: "board--tictactoe",
    boardLabel: "Tic-Tac-Toe board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;
  setBoardGrid(grid, ticTacToeSize);
  const onlinePresence = el("div", { className: "online-presence-host" });
  viewport.append(onlinePresence);
  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const botMove = createDelayedAction();
  const online = createMultiplayerGameClient({
    game: tictactoe,
    render,
    applySnapshot: applyOnlineSnapshot,
  });
  onDocumentKeyDown(onKeyDown, scope);
  addTouchGestureControls(
    grid,
    { onSwipe: moveSelection },
    { signal: scope.signal, touchAction: "none" },
  );

  const modeControl = {
    get: () => mode,
    set: (next: BotPlayMode) => {
      resetAbandonedBotStreak();
      skipNextAbandonStreakReset = true;
      mode = next;
      savePreferences();
    },
    next: nextBotPlayMode,
    label: botPlayModeLabel,
    reset: resetGame,
  };
  const modeButton = createModeControl(actions, modeControl);
  const difficultyControl = createGameDifficultyControl(actions, {
    get: () => difficulty,
    set: (next: Difficulty) => {
      resetAbandonedBotStreak();
      skipNextAbandonStreakReset = true;
      difficulty = next;
      savePreferences();
    },
    reset: resetGame,
  });
  const {
    onlineButton,
    startOnlineButton,
    rematchButton,
    closeDialog: closeOnlineDialog,
  } = createMultiplayerActionButtons(actions, {
    game: tictactoe,
    getSession: () => online.session,
    onSession: startOnline,
    onStart: requestOnlineStart,
    onRematch: requestOnlineRematch,
  });
  const requestReset = createResetControl(actions, shell, resetGame);

  function resetGame(): void {
    if (skipNextAbandonStreakReset) skipNextAbandonStreakReset = false;
    else resetAbandonedBotStreak();
    stopOnline();
    botMove.clear();
    clearGameSave(tictactoe.id);
    resetGameProgress(shell);
    runId = createRunId();
    board = newTicTacToeBoard();
    current = humanMark;
    selected = 4;
    winner = null;
    winLine = [];
    savePreferences();
    render();
  }

  function render(): void {
    status.textContent = statusText();
    online.renderPresence(onlinePresence);
    setBotPlayModeIconLabel(modeButton, online.session ? "Online" : mode);
    modeButton.disabled = Boolean(online.session);
    difficultyControl.sync(online.session ? "Online" : difficulty, Boolean(online.session));
    online.syncActionButtons(
      { onlineButton, startOnlineButton, rematchButton },
      isOnlineFinished(),
    );

    const cells = syncChildren(grid, board.length, (index) => {
      const cell = el("button", { className: "game-cell ttt-cell", type: "button" });
      cell.addEventListener("click", () => playTurn(index));
      cell.addEventListener("pointerenter", () => {
        if (selected === index) return;
        selected = index;
        render();
      });
      return cell;
    });
    board.forEach((value, index) => {
      const cell = cells[index];
      if (!cell) return;
      cell.textContent = value;
      cell.setAttribute("aria-label", labelFor(index, value));
      setSelected(cell, index === selected);
      cell.dataset.mark = value;
      if (winLine.includes(index)) cell.dataset.win = "true";
      else delete cell.dataset.win;
      cell.disabled = isLocked();
      cell.setAttribute("aria-disabled", String(Boolean(winner) || value !== ""));
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
      onActivate: () => playTurn(selected),
      onNextDifficulty: difficultyControl.next,
      onPreviousDifficulty: difficultyControl.previous,
      onReset: requestReset,
    });
  }

  function moveSelection(direction: Direction): void {
    selected = moveGridIndex(selected, direction, ticTacToeSize, board.length);
    render();
  }

  function statusText(): string {
    if (online.session) return onlineStatusText();
    if (winner === "draw") return withBotStreakText("Draw");
    if (mode === "local") return winner ? `${winner} wins` : `${current} turn`;
    if (winner === humanMark) return withBotStreakText("You win");
    if (winner === botMark) return withBotStreakText("Bot wins");
    return withBotStreakText(current === humanMark ? "Your turn" : "Bot thinking");
  }

  function withBotStreakText(text: string): string {
    if (mode !== "bot") return text;
    return `${text} · Streak ${getBotStreak(tictactoe.id, difficulty).current}`;
  }

  function isLocked(): boolean {
    if (online.session) {
      return (
        online.connectionStatus !== "connected" ||
        online.roomStatus !== "playing" ||
        !online.seat ||
        winner !== null ||
        current !== markForSeat(online.seat)
      );
    }
    return mode === "bot" && current === botMark;
  }

  function playTurn(index: number): void {
    if (isLocked()) return;
    if (winner || board[index]) {
      invalidMove.trigger();
      return;
    }
    if (online.session) {
      online.connection?.sendAction(online.revision, { type: "place", index });
      return;
    }
    play(index);
    if (mode === "bot" && !winner && current === botMark) scheduleBot();
  }

  function play(index: number): void {
    if (winner || board[index]) return;
    markGameStarted(shell);
    board[index] = current;
    const result = getTicTacToeWinner(board);
    if (result) {
      winner = result.winner;
      winLine = result.line;
      markGameFinished(shell);
    } else if (board.every(Boolean)) {
      winner = "draw";
      markGameFinished(shell);
    } else {
      current = current === humanMark ? botMark : humanMark;
    }
    if (winner) {
      recordFinishedGame();
      clearGameSave(tictactoe.id);
      playSound(winner === "draw" ? "gameMajor" : winner === humanMark ? "gameWin" : "gameLose");
    } else {
      saveCurrentGame();
      playSound("gameMove");
    }
    render();
  }

  function scheduleBot(): void {
    botMove.start(() => {
      if (current === botMark && !winner) play(chooseTicTacToeBotMove(board, difficulty));
    }, 260);
  }

  function saveCurrentGame(): void {
    if (online.session) return;
    saveGameSave(tictactoe.id, savePayloadVersion, {
      runId,
      status: "playing",
      payload: { board, current, mode, difficulty, winner },
    });
  }

  function recordFinishedGame(): void {
    if (!winner) return;
    const outcome =
      winner === "draw" ? "draw" : mode === "bot" && winner === botMark ? "lost" : "won";
    const streak =
      mode === "bot"
        ? recordBotStreakOutcome(tictactoe.id, difficulty, outcome).current
        : undefined;
    recordGameResult({
      runId,
      gameId: tictactoe.id,
      difficulty,
      outcome,
      moves: board.filter(Boolean).length,
      ...(outcome === "won" && streak ? { streak } : {}),
      metadata: { mode, winner },
    });
  }

  function resetAbandonedBotStreak(): void {
    if (mode === "bot" && !winner && board.some(Boolean)) resetBotStreak(tictactoe.id, difficulty);
  }

  function savePreferences(): void {
    saveGamePreferences(tictactoe.id, { difficulty, options: { mode } });
  }

  function startOnline(session: MultiplayerSession): void {
    resetAbandonedBotStreak();
    botMove.clear();
    clearGameSave(tictactoe.id);
    resetGameProgress(shell);
    online.start(session, () => {
      runId = createRunId();
      board = newTicTacToeBoard();
      current = humanMark;
      winner = null;
      winLine = [];
    });
  }

  function requestOnlineStart(): void {
    online.requestStart(() => invalidMove.trigger());
  }

  function requestOnlineRematch(): void {
    online.requestRematch(isOnlineFinished());
  }

  function isOnlineFinished(): boolean {
    return Boolean(online.session && winner);
  }

  function stopOnline(): void {
    closeOnlineDialog();
    online.stop();
  }

  function applyOnlineSnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat | null): void {
    const state = parseOnlineTicTacToeState(room.state);
    if (!state || room.gameId !== tictactoe.id) return;
    const wasInFinishedOrStartedOnlineGame =
      online.resultRecorded || winner !== null || board.some(Boolean);
    online.applySnapshot(room, seat);
    if (wasInFinishedOrStartedOnlineGame && state.moves === 0 && !state.winner) {
      resetGameProgress(shell);
      runId = createRunId();
      online.resultRecorded = false;
    }
    board = state.board;
    current = markForSeat(state.current);
    winner = state.winner === "draw" ? "draw" : state.winner ? markForSeat(state.winner) : null;
    winLine = state.winLine;
    if (state.moves > 0) markGameStarted(shell);
    if (winner) {
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
    if (winner) {
      const result =
        winner === "draw"
          ? "Draw"
          : winner === markForSeat(online.seat)
            ? "You win"
            : "Opponent wins";
      return multiplayerRematchStatusText({ result, localSeat: online.seat, seats: online.seats });
    }
    if (online.roomStatus === "countdown") return `Starting in ${online.countdownText()}`;
    if (online.roomStatus === "lobby") {
      const joined = multiplayerJoinedSeatCount(online.seats);
      if (online.seat === "p1") return `${joined}/2 · Start at 2`;
      return "Waiting host";
    }
    return current === markForSeat(online.seat) ? "Your turn" : "Opponent turn";
  }

  function spectatorStatusText(): string {
    if (!online.session) return "Spectating";
    if (winner === "draw") return "Spectating · Draw";
    if (winner) return `Spectating · ${winner} wins`;
    if (online.roomStatus === "countdown")
      return `Spectating · Starting in ${online.countdownText()}`;
    if (online.roomStatus === "lobby") return "Spectating";
    return `Spectating · ${current} turn`;
  }

  function recordOnlineFinished(state: OnlineTicTacToeState): void {
    if (online.resultRecorded || !online.seat || !state.winner) return;
    online.resultRecorded = true;
    const outcome =
      state.winner === "draw" ? "draw" : state.winner === online.seat ? "won" : "lost";
    recordGameResult({
      runId,
      gameId: tictactoe.id,
      outcome,
      moves: state.moves,
      metadata: { mode: "online", seat: online.seat, winner: state.winner },
    });
  }

  if (board.some(Boolean)) markGameStarted(shell);
  render();
  if (mode === "bot" && current === botMark && !winner) scheduleBot();
  return () => {
    scope.cleanup();
    invalidMove.cleanup();
    botMove.clear();
    stopOnline();
    remove();
  };
}

function parseBotPlayMode(value: unknown): BotPlayMode | null {
  return parseWithSchema(botPlayModeSchema, value);
}

function parseSaveTicTacToe(value: unknown): SaveTicTacToe | null {
  const parsed = parseWithSchema(saveTicTacToeBaseSchema, value);
  if (!parsed) return null;
  const board = parseBoard(parsed.board);
  const current = parseMark(parsed.current);
  const mode = parseBotPlayMode(parsed.mode);
  const difficulty = parseDifficulty(parsed.difficulty);
  const winner = parseWinner(parsed.winner);
  if (!board || !current || !mode || !difficulty || winner === undefined) return null;
  return { board, current, mode, difficulty, winner };
}

function parseBoard(value: unknown): TicTacToeCell[] | null {
  return parseFixedArray(value, ticTacToeSize * ticTacToeSize, parseCell);
}

function parseCell(value: unknown): TicTacToeCell | null {
  return parseWithSchema(ticTacToeCellSchema, value);
}

function parseMark(value: unknown): Mark | null {
  return parseWithSchema(ticTacToeMarkSchema, value);
}

function parseWinner(value: unknown): Mark | "draw" | null | undefined {
  if (value === null || value === "draw") return value;
  return parseMark(value) ?? undefined;
}

function parseOnlineTicTacToeState(value: unknown): OnlineTicTacToeState | null {
  const parsed = parseWithSchema(onlineTicTacToeBaseSchema, value);
  if (!parsed) return null;
  const board = parseBoard(parsed.board);
  const current = parseMultiplayerSeat(parsed.current);
  const winner = parseOnlineWinner(parsed.winner);
  if (!board || !current || winner === undefined) return null;
  const winLine = Array.isArray(parsed.winLine)
    ? parsed.winLine.filter((index): index is number => typeof index === "number")
    : [];
  return { board, current, winner, winLine, moves: parsed.moves };
}

function parseOnlineWinner(value: unknown): MultiplayerSeat | "draw" | null | undefined {
  if (value === null || value === "draw") return value;
  return parseMultiplayerSeat(value) ?? undefined;
}

function markForSeat(seat: MultiplayerSeat): Mark {
  return seat === "p1" ? humanMark : botMark;
}

function labelFor(index: number, value: TicTacToeCell): string {
  const row = Math.floor(index / ticTacToeSize) + 1;
  const column = (index % ticTacToeSize) + 1;
  return `Row ${row}, column ${column}, ${value || "empty"}`;
}
