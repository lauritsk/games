import {
  addTouchGestureControls,
  createDelayedAction,
  createGameShell,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  isRecord,
  moveGridIndex,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  parseOneOf,
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
import {
  createMultiplayerCountdown,
  multiplayerCountdownNumber,
} from "@features/multiplayer/multiplayer-countdown";
import {
  connectMultiplayerSession,
  type MultiplayerConnection,
  type MultiplayerConnectionStatus,
} from "@features/multiplayer/multiplayer";
import { createMultiplayerDialog } from "@features/multiplayer/multiplayer-dialog";
import {
  emptyMultiplayerSeatSnapshots,
  multiplayerReadySeatCount,
  parseMultiplayerSeat,
  type MultiplayerRoomSnapshot,
  type MultiplayerRoomStatus,
  type MultiplayerSeat,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";
import { playSound } from "@ui/sound";
import {
  botPlayModeLabel,
  changeDifficulty,
  createDifficultyControl,
  createModeControl,
  createResetControl,
  nextBotPlayMode,
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
  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const botMove = createDelayedAction();
  const onlineCountdown = createMultiplayerCountdown(render);
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
  const difficultyControl = {
    get: () => difficulty,
    set: (next: Difficulty) => {
      resetAbandonedBotStreak();
      skipNextAbandonStreakReset = true;
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
    if (!onlineSession) onlineDialog.show(tictactoe, startOnline);
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
    modeButton.textContent = onlineSession ? "Online" : botPlayModeLabel(mode);
    modeButton.disabled = Boolean(onlineSession);
    difficultyButton.textContent = onlineSession ? "Online" : difficulty;
    difficultyButton.disabled = Boolean(onlineSession);
    onlineButton.textContent = onlineSession ? `Room ${onlineSession.code}` : "Play online";
    onlineButton.disabled = Boolean(onlineSession);
    rematchButton.hidden = !isOnlineFinished();
    rematchButton.textContent =
      onlineSeat === "p1" ? "Start rematch" : currentSeatReady() ? "Ready" : "Ready rematch";
    rematchButton.disabled = onlineStatus !== "connected" || !canOnlineRematch();

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
      if (!onlineSession) toggleMode(modeControl);
      return;
    }
    handleStandardGameKey(event, {
      onDirection: moveSelection,
      onActivate: () => playTurn(selected),
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function moveSelection(direction: Direction): void {
    selected = moveGridIndex(selected, direction, ticTacToeSize, board.length);
    render();
  }

  function statusText(): string {
    if (onlineSession) return onlineStatusText();
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
    if (onlineSession) {
      return (
        onlineStatus !== "connected" ||
        onlineRoomStatus !== "playing" ||
        !onlineSeat ||
        winner !== null ||
        current !== markForSeat(onlineSeat)
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
    if (onlineSession) {
      onlineConnection?.sendAction(onlineRevision, { type: "place", index });
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
    if (onlineSession) return;
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
    onlineConnection?.close();
    onlineSession = session;
    onlineSeat = session.seat;
    onlineRevision = 0;
    onlineStatus = "connecting";
    onlineRoomStatus = "lobby";
    onlineCountdownEndsAt = undefined;
    onlineSeats = emptyMultiplayerSeatSnapshots();
    onlineResultRecorded = false;
    onlineError = "";
    runId = createRunId();
    board = newTicTacToeBoard();
    current = humanMark;
    winner = null;
    winLine = [];
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
    onlineError = onlineSeat === "p1" ? "Starting rematch…" : "Ready for rematch…";
    onlineConnection?.requestRematch(onlineRevision);
    render();
  }

  function canOnlineRematch(): boolean {
    if (!isOnlineFinished()) return false;
    return onlineSeat === "p1" || !currentSeatReady();
  }

  function isOnlineFinished(): boolean {
    return Boolean(onlineSession && winner);
  }

  function currentSeatReady(): boolean {
    return onlineSeat ? onlineSeats[onlineSeat].ready === true : false;
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
    onlineSeats = emptyMultiplayerSeatSnapshots();
    onlineError = "";
    onlineResultRecorded = false;
  }

  function applyOnlineSnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat): void {
    const state = parseOnlineTicTacToeState(room.state);
    if (!state || room.gameId !== tictactoe.id) return;
    const wasInFinishedOrStartedOnlineGame =
      onlineResultRecorded || winner !== null || board.some(Boolean);
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
    if (onlineError) return onlineError;
    if (onlineStatus === "connecting") return "Connecting…";
    if (onlineStatus === "reconnecting") return "Reconnecting…";
    if (!onlineSession) return "Online";
    if (!onlineSeat) return "Joining…";
    if (winner) {
      const result =
        winner === "draw"
          ? "Draw"
          : winner === markForSeat(onlineSeat)
            ? "You win"
            : "Opponent wins";
      return `${result} · ${multiplayerReadySeatCount(onlineSeats)} ready`;
    }
    if (onlineRoomStatus === "countdown") {
      const number = multiplayerCountdownNumber({
        code: onlineSession.code,
        gameId: tictactoe.id,
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
      return `Starting in ${number ?? "…"}`;
    }
    if (onlineRevision === 0) return `Room ${onlineSession.code} · Waiting`;
    return current === markForSeat(onlineSeat) ? "Your turn" : "Opponent turn";
  }

  function recordOnlineFinished(state: OnlineTicTacToeState): void {
    if (onlineResultRecorded || !onlineSeat || !state.winner) return;
    onlineResultRecorded = true;
    const outcome = state.winner === "draw" ? "draw" : state.winner === onlineSeat ? "won" : "lost";
    recordGameResult({
      runId,
      gameId: tictactoe.id,
      outcome,
      moves: state.moves,
      metadata: { mode: "online", seat: onlineSeat, winner: state.winner },
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
    onlineCountdown.cleanup();
    remove();
  };
}

function parseBotPlayMode(value: unknown): BotPlayMode | null {
  return parseOneOf(value, ["bot", "local"] as const);
}

function parseSaveTicTacToe(value: unknown): SaveTicTacToe | null {
  if (!isRecord(value)) return null;
  const board = parseBoard(value.board);
  const current = parseMark(value.current);
  const mode = parseBotPlayMode(value.mode);
  const difficulty = parseDifficulty(value.difficulty);
  const winner = parseWinner(value.winner);
  if (!board || !current || !mode || !difficulty || winner === undefined) return null;
  return { board, current, mode, difficulty, winner };
}

function parseBoard(value: unknown): TicTacToeCell[] | null {
  if (!Array.isArray(value) || value.length !== ticTacToeSize * ticTacToeSize) return null;
  const board = value.map(parseCell);
  return board.every((cell): cell is TicTacToeCell => cell !== null) ? board : null;
}

function parseCell(value: unknown): TicTacToeCell | null {
  return parseOneOf(value, [humanMark, botMark, ""] as const);
}

function parseMark(value: unknown): Mark | null {
  return parseOneOf(value, [humanMark, botMark] as const);
}

function parseWinner(value: unknown): Mark | "draw" | null | undefined {
  if (value === null || value === "draw") return value;
  return parseMark(value) ?? undefined;
}

function parseOnlineTicTacToeState(value: unknown): OnlineTicTacToeState | null {
  if (!isRecord(value)) return null;
  const board = parseBoard(value.board);
  const current = parseMultiplayerSeat(value.current);
  const winner = parseOnlineWinner(value.winner);
  if (!board || !current || winner === undefined) return null;
  const winLine = Array.isArray(value.winLine)
    ? value.winLine.filter((index): index is number => typeof index === "number")
    : [];
  const moves = typeof value.moves === "number" && Number.isInteger(value.moves) ? value.moves : 0;
  return { board, current, winner, winLine, moves };
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
