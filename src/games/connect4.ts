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
  Keys,
  markGameFinished,
  markGameStarted,
  matchesKey,
  onDocumentKeyDown,
  parseOneOf,
  resetGameProgress,
  setBoardGrid,
  setSelected,
  syncChildren,
  type Difficulty,
  type Direction,
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { getBotStreak, recordBotStreakOutcome, resetBotStreak } from "../bot-streaks";
import { loadGamePreferences, parseDifficulty, saveGamePreferences } from "../game-preferences";
import { recordGameResult } from "../game-results";
import { clearGameSave, createRunId, loadGameSave, saveGameSave } from "../game-state";
import {
  connectMultiplayerSession,
  type MultiplayerConnection,
  type MultiplayerConnectionStatus,
} from "../multiplayer";
import { createMultiplayerDialog } from "../multiplayer-dialog";
import {
  parseMultiplayerSeat,
  type MultiplayerRoomSnapshot,
  type MultiplayerSeat,
  type MultiplayerSession,
} from "../multiplayer-protocol";
import { playSound } from "../sound";
import {
  botPlayModeLabel,
  changeDifficulty,
  createDifficultyControl,
  createModeControl,
  createResetControl,
  nextBotPlayMode,
  toggleMode,
  type BotPlayMode,
} from "./controls";
import {
  chooseConnect4BotColumn,
  connect4Bot,
  connect4Columns,
  connect4Human,
  connect4Rows,
  dropConnect4DiscInPlace,
  findConnect4Win,
  newConnect4Board,
  type Connect4Cell,
  type Connect4Player,
  type Connect4WinLine,
} from "./connect4.logic";

const names: Record<Connect4Player, string> = { 1: "Red", 2: "Gold" };
const savePayloadVersion = 1;

type SaveConnect4 = {
  board: Connect4Cell[][];
  current: Connect4Player;
  winner: Connect4Player | null;
  moves: number;
  mode: BotPlayMode;
  difficulty: Difficulty;
};

type OnlineConnect4State = {
  board: Connect4Cell[][];
  current: MultiplayerSeat;
  winner: MultiplayerSeat | "draw" | null;
  winningLine: Connect4WinLine;
  moves: number;
};

export const connect4: GameDefinition = {
  id: "connect4",
  name: "Connect 4",
  tagline: "Drop discs. Stack four. Keep it light.",
  players: "Solo, local, or online",
  theme: "deep-ocean",
  mount: mountConnect4,
};

export function mountConnect4(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(connect4.id);
  let board = newConnect4Board();
  let current: Connect4Player = 1;
  let winner: Connect4Player | null = null;
  let winningLine: Connect4WinLine = [];
  let moves = 0;
  let mode: BotPlayMode = parseBotPlayMode(preferences.options?.mode) ?? "bot";
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let selectedColumn = Math.floor(connect4Columns / 2);
  let runId = createRunId();
  let skipNextAbandonStreakReset = false;
  let onlineSession: MultiplayerSession | null = null;
  let onlineConnection: MultiplayerConnection | null = null;
  let onlineSeat: MultiplayerSeat | null = null;
  let onlineRevision = 0;
  let onlineStatus: MultiplayerConnectionStatus = "closed";
  let onlineResultRecorded = false;
  let onlineError = "";

  const saved = loadGameSave(connect4.id, savePayloadVersion, parseSaveConnect4);
  if (saved) {
    runId = saved.runId;
    board = saved.payload.board;
    current = saved.payload.current;
    winner = saved.payload.winner;
    moves = saved.payload.moves;
    mode = saved.payload.mode;
    difficulty = saved.payload.difficulty;
  }

  const {
    shell,
    status,
    actions,
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "connect4",
    boardClass: "board--connect4",
    boardLabel: "Connect 4 board",
    layout: gameLayouts.wideFit,
  });
  shell.tabIndex = 0;
  setBoardGrid(grid, connect4Columns, connect4Rows);
  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const botMove = createDelayedAction();
  onDocumentKeyDown(onKeyDown, scope);
  addTouchGestureControls(
    grid,
    { onSwipe: handleDirectionInput },
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
  onlineButton.addEventListener("click", () => onlineDialog.show(connect4, startOnline));
  actions.append(onlineButton);

  const requestReset = createResetControl(actions, shell, resetGame);

  function resetGame(): void {
    if (skipNextAbandonStreakReset) skipNextAbandonStreakReset = false;
    else resetAbandonedBotStreak();
    stopOnline();
    botMove.clear();
    clearGameSave(connect4.id);
    resetGameProgress(shell);
    runId = createRunId();
    board = newConnect4Board();
    current = connect4Human;
    winner = null;
    winningLine = [];
    moves = 0;
    selectedColumn = Math.floor(connect4Columns / 2);
    savePreferences();
    render();
  }

  function render(): void {
    shell.dataset.turn = String(current);
    status.textContent = statusText();
    modeButton.textContent = onlineSession ? "Online" : botPlayModeLabel(mode);
    modeButton.disabled = Boolean(onlineSession);
    difficultyButton.textContent = onlineSession ? "Online" : difficulty;
    difficultyButton.disabled = Boolean(onlineSession);
    onlineButton.textContent = onlineSession ? `Room ${onlineSession.code}` : "Play online";

    const cells = syncChildren(grid, connect4Rows * connect4Columns, (index) => {
      const column = index % connect4Columns;
      const cell = el("button", { className: "game-cell slot", type: "button" });
      cell.addEventListener("click", () => playTurn(column));
      cell.addEventListener("pointerenter", () => {
        if (selectedColumn === column) return;
        selectedColumn = column;
        render();
      });
      return cell;
    });
    cells.forEach((cell, index) => {
      const row = Math.floor(index / connect4Columns);
      const column = index % connect4Columns;
      const value = board[row]?.[column] ?? 0;
      cell.setAttribute("aria-label", labelFor(row, column, value));
      cell.dataset.player = String(value);
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      setSelected(cell, column === selectedColumn);
      if (winningLine.some(([r, c]) => r === row && c === column)) cell.dataset.win = "true";
      else delete cell.dataset.win;
      cell.disabled = isLocked();
      cell.setAttribute(
        "aria-disabled",
        String(Boolean(winner) || moves === connect4Rows * connect4Columns || !canPlay(column)),
      );
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      if (!onlineSession) toggleMode(modeControl);
      return;
    }
    if (matchesKey(event, Keys.down)) {
      event.preventDefault();
      playTurn(selectedColumn);
      return;
    }
    handleStandardGameKey(event, {
      onDirection: handleDirectionInput,
      onActivate: () => playTurn(selectedColumn),
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function handleDirectionInput(direction: Direction): void {
    if (direction === "left") selectedColumn = Math.max(0, selectedColumn - 1);
    else if (direction === "right")
      selectedColumn = Math.min(connect4Columns - 1, selectedColumn + 1);
    else if (direction === "down") playTurn(selectedColumn);
    render();
  }

  function statusText(): string {
    if (onlineSession) return onlineStatusText();
    if (mode === "local") return winner ? `${names[winner]} wins` : `${names[current]} turn`;
    if (winner === connect4Human) return withBotStreakText("You win");
    if (winner === connect4Bot) return withBotStreakText("Bot wins");
    if (moves === connect4Rows * connect4Columns) return withBotStreakText("Draw");
    return withBotStreakText(current === connect4Human ? "Your turn" : "Bot thinking");
  }

  function withBotStreakText(text: string): string {
    if (mode !== "bot") return text;
    return `${text} · Streak ${getBotStreak(connect4.id, difficulty).current}`;
  }

  function isLocked(): boolean {
    if (onlineSession) {
      return (
        onlineStatus !== "connected" ||
        !onlineSeat ||
        Boolean(winner) ||
        moves === connect4Rows * connect4Columns ||
        current !== playerForSeat(onlineSeat)
      );
    }
    return mode === "bot" && current === connect4Bot;
  }

  function playTurn(column: number): void {
    if (isLocked()) return;
    if (winner || moves === connect4Rows * connect4Columns || !canPlay(column)) {
      invalidMove.trigger();
      return;
    }
    if (onlineSession) {
      onlineConnection?.sendAction(onlineRevision, { type: "drop", column });
      return;
    }
    play(column);
    if (mode === "bot" && !winner && current === connect4Bot) scheduleBot();
  }

  function play(column: number): void {
    if (winner || !canPlay(column)) return;
    const row = dropConnect4DiscInPlace(board, column, current);
    if (row === null) return;

    markGameStarted(shell);
    moves += 1;
    const line = findConnect4Win(board, row, column, current);
    if (line) {
      winner = current;
      winningLine = line;
    } else {
      current = current === connect4Human ? connect4Bot : connect4Human;
    }
    if (winner || moves === connect4Rows * connect4Columns) {
      markGameFinished(shell);
      recordFinishedGame();
      clearGameSave(connect4.id);
    } else saveCurrentGame();
    if (winner) playSound(winner === connect4Human ? "gameWin" : "gameLose");
    else if (moves === connect4Rows * connect4Columns) playSound("gameMajor");
    else playSound("gameMove");
    render();
  }

  function scheduleBot(): void {
    botMove.start(() => {
      if (current === connect4Bot && !winner) play(chooseConnect4BotColumn(board, difficulty));
    }, 360);
  }

  function canPlay(column: number): boolean {
    return board[0]?.[column] === 0;
  }

  function saveCurrentGame(): void {
    if (onlineSession) return;
    saveGameSave(connect4.id, savePayloadVersion, {
      runId,
      status: "playing",
      payload: { board, current, winner, moves, mode, difficulty },
    });
  }

  function recordFinishedGame(): void {
    const outcome = winner ? (mode === "bot" && winner === connect4Bot ? "lost" : "won") : "draw";
    const streak =
      mode === "bot" ? recordBotStreakOutcome(connect4.id, difficulty, outcome).current : undefined;
    recordGameResult({
      runId,
      gameId: connect4.id,
      difficulty,
      outcome,
      moves,
      ...(outcome === "won" && streak ? { streak } : {}),
      metadata: { mode, winner: winner ?? "draw" },
    });
  }

  function resetAbandonedBotStreak(): void {
    if (mode === "bot" && !winner && moves > 0 && moves < connect4Rows * connect4Columns) {
      resetBotStreak(connect4.id, difficulty);
    }
  }

  function savePreferences(): void {
    saveGamePreferences(connect4.id, { difficulty, options: { mode } });
  }

  function startOnline(session: MultiplayerSession): void {
    resetAbandonedBotStreak();
    botMove.clear();
    clearGameSave(connect4.id);
    resetGameProgress(shell);
    onlineConnection?.close();
    onlineSession = session;
    onlineSeat = session.seat;
    onlineRevision = 0;
    onlineStatus = "connecting";
    onlineResultRecorded = false;
    onlineError = "";
    runId = createRunId();
    board = newConnect4Board();
    current = connect4Human;
    winner = null;
    winningLine = [];
    moves = 0;
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

  function stopOnline(): void {
    onlineDialog.close();
    onlineConnection?.close();
    onlineConnection = null;
    onlineSession = null;
    onlineSeat = null;
    onlineRevision = 0;
    onlineStatus = "closed";
    onlineError = "";
    onlineResultRecorded = false;
  }

  function applyOnlineSnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat): void {
    const state = parseOnlineConnect4State(room.state);
    if (!state || room.gameId !== connect4.id) return;
    onlineError = "";
    onlineSeat = seat;
    onlineRevision = room.revision;
    board = state.board;
    current = playerForSeat(state.current);
    winner = state.winner === "draw" || state.winner === null ? null : playerForSeat(state.winner);
    winningLine = state.winningLine;
    moves = state.moves;
    if (moves > 0) markGameStarted(shell);
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
    if (moves === connect4Rows * connect4Columns && !winner) return "Draw";
    if (winner) return winner === playerForSeat(onlineSeat) ? "You win" : "Opponent wins";
    if (onlineRevision === 0) return `Room ${onlineSession.code} · Waiting`;
    return current === playerForSeat(onlineSeat) ? "Your turn" : "Opponent turn";
  }

  function recordOnlineFinished(state: OnlineConnect4State): void {
    if (onlineResultRecorded || !onlineSeat || !state.winner) return;
    onlineResultRecorded = true;
    const outcome = state.winner === "draw" ? "draw" : state.winner === onlineSeat ? "won" : "lost";
    recordGameResult({
      runId,
      gameId: connect4.id,
      outcome,
      moves: state.moves,
      metadata: { mode: "online", seat: onlineSeat, winner: state.winner },
    });
  }

  if (moves > 0) markGameStarted(shell);
  render();
  if (mode === "bot" && current === connect4Bot && !winner) scheduleBot();

  return () => {
    scope.cleanup();
    invalidMove.cleanup();
    botMove.clear();
    stopOnline();
    remove();
  };
}

function parseBotPlayMode(value: unknown): BotPlayMode | null {
  return parseOneOf(value, ["bot", "local"] as const);
}

function parseSaveConnect4(value: unknown): SaveConnect4 | null {
  if (!isRecord(value)) return null;
  const board = parseBoard(value.board);
  const current = parsePlayer(value.current);
  const winner = parseWinner(value.winner);
  const mode = parseBotPlayMode(value.mode);
  const difficulty = parseDifficulty(value.difficulty);
  if (!board || !current || winner === undefined || !mode || !difficulty) return null;
  if (
    typeof value.moves !== "number" ||
    value.moves < 0 ||
    value.moves > connect4Rows * connect4Columns
  )
    return null;
  return { board, current, winner, moves: value.moves, mode, difficulty };
}

function parseBoard(value: unknown): Connect4Cell[][] | null {
  if (!Array.isArray(value) || value.length !== connect4Rows) return null;
  const board = value.map((row) => {
    if (!Array.isArray(row) || row.length !== connect4Columns) return null;
    const cells = row.map(parseCell);
    return cells.every((cell): cell is Connect4Cell => cell !== null) ? cells : null;
  });
  return board.every((row): row is Connect4Cell[] => row !== null) ? board : null;
}

function parseCell(value: unknown): Connect4Cell | null {
  return parseOneOf(value, [0, connect4Human, connect4Bot] as const);
}

function parsePlayer(value: unknown): Connect4Player | null {
  return parseOneOf(value, [connect4Human, connect4Bot] as const);
}

function parseWinner(value: unknown): Connect4Player | null | undefined {
  if (value === null) return null;
  return parsePlayer(value) ?? undefined;
}

function parseOnlineConnect4State(value: unknown): OnlineConnect4State | null {
  if (!isRecord(value)) return null;
  const board = parseBoard(value.board);
  const current = parseMultiplayerSeat(value.current);
  const winner = parseOnlineWinner(value.winner);
  if (!board || !current || winner === undefined) return null;
  const winningLine = Array.isArray(value.winningLine)
    ? value.winningLine.flatMap((point): Connect4WinLine => {
        if (!Array.isArray(point) || point.length !== 2) return [];
        const [row, column] = point;
        return typeof row === "number" && typeof column === "number" ? [[row, column]] : [];
      })
    : [];
  const moves = typeof value.moves === "number" && Number.isInteger(value.moves) ? value.moves : 0;
  return { board, current, winner, winningLine, moves };
}

function parseOnlineWinner(value: unknown): MultiplayerSeat | "draw" | null | undefined {
  if (value === null || value === "draw") return value;
  return parseMultiplayerSeat(value) ?? undefined;
}

function playerForSeat(seat: MultiplayerSeat): Connect4Player {
  return seat === "p1" ? connect4Human : connect4Bot;
}

function labelFor(row: number, column: number, value: Connect4Cell): string {
  const token = value === 0 ? "empty" : `${names[value]} disc`;
  return `Row ${row + 1}, column ${column + 1}, ${token}`;
}
