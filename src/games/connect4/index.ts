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
  integerBetweenSchema,
  Keys,
  markGameFinished,
  markGameStarted,
  matchesKey,
  onDocumentKeyDown,
  parseFixedGrid,
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
  changeDifficulty,
  createDifficultyControl,
  createModeControl,
  createResetControl,
  nextBotPlayMode,
  setBotPlayModeIconLabel,
  setDifficultyControlIconLabel,
  toggleMode,
  type BotPlayMode,
} from "@games/shared/controls";
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
} from "@games/connect4/logic";

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

const botPlayModeSchema = picklistSchema(["bot", "local"] as const);
const connect4CellSchema = picklistSchema([0, connect4Human, connect4Bot] as const);
const connect4PlayerSchema = picklistSchema([connect4Human, connect4Bot] as const);
const connect4MovesSchema = integerBetweenSchema(0, connect4Rows * connect4Columns);
const saveConnect4BaseSchema = v.looseObject({
  board: v.unknown(),
  current: v.unknown(),
  winner: v.unknown(),
  moves: connect4MovesSchema,
  mode: v.unknown(),
  difficulty: v.unknown(),
});
const onlineConnect4BaseSchema = v.looseObject({
  board: v.unknown(),
  current: v.unknown(),
  winner: v.unknown(),
  winningLine: v.optional(v.unknown()),
  moves: v.optional(connect4MovesSchema, 0),
});

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
    viewport,
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
  const onlinePresence = el("div", { className: "online-presence-host" });
  viewport.append(onlinePresence);
  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const botMove = createDelayedAction();
  const online = createMultiplayerGameClient({
    game: connect4,
    render,
    applySnapshot: applyOnlineSnapshot,
  });
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

  const {
    onlineButton,
    startOnlineButton,
    rematchButton,
    closeDialog: closeOnlineDialog,
  } = createMultiplayerActionButtons(actions, {
    game: connect4,
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
    online.renderPresence(onlinePresence);
    setBotPlayModeIconLabel(modeButton, online.session ? "Online" : mode);
    modeButton.disabled = Boolean(online.session);
    setDifficultyControlIconLabel(difficultyButton, online.session ? "Online" : difficulty);
    difficultyButton.disabled = Boolean(online.session);
    online.syncActionButtons(
      { onlineButton, startOnlineButton, rematchButton },
      isOnlineFinished(),
    );

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
      if (!online.session) toggleMode(modeControl);
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
    if (online.session) return onlineStatusText();
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
    if (online.session) {
      return (
        online.connectionStatus !== "connected" ||
        online.roomStatus !== "playing" ||
        !online.seat ||
        Boolean(winner) ||
        moves === connect4Rows * connect4Columns ||
        current !== playerForSeat(online.seat)
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
    if (online.session) {
      online.connection?.sendAction(online.revision, { type: "drop", column });
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
    if (online.session) return;
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
    online.start(session, () => {
      runId = createRunId();
      board = newConnect4Board();
      current = connect4Human;
      winner = null;
      winningLine = [];
      moves = 0;
    });
  }

  function requestOnlineStart(): void {
    online.requestStart(() => invalidMove.trigger());
  }

  function requestOnlineRematch(): void {
    online.requestRematch(isOnlineFinished());
  }

  function isOnlineFinished(): boolean {
    return Boolean(online.session && (winner || moves === connect4Rows * connect4Columns));
  }

  function stopOnline(): void {
    closeOnlineDialog();
    online.stop();
  }

  function applyOnlineSnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat | null): void {
    const state = parseOnlineConnect4State(room.state);
    if (!state || room.gameId !== connect4.id) return;
    const wasInFinishedOrStartedOnlineGame = online.resultRecorded || winner !== null || moves > 0;
    online.applySnapshot(room, seat);
    if (wasInFinishedOrStartedOnlineGame && state.moves === 0 && !state.winner) {
      resetGameProgress(shell);
      runId = createRunId();
      online.resultRecorded = false;
    }
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
    if (moves === connect4Rows * connect4Columns && !winner) {
      return multiplayerRematchStatusText({
        result: "Draw",
        localSeat: online.seat,
        seats: online.seats,
      });
    }
    if (winner) {
      const result = winner === playerForSeat(online.seat) ? "You win" : "Opponent wins";
      return multiplayerRematchStatusText({ result, localSeat: online.seat, seats: online.seats });
    }
    if (online.revision === 0) return "Waiting";
    return current === playerForSeat(online.seat) ? "Your turn" : "Opponent turn";
  }

  function spectatorStatusText(): string {
    if (!online.session) return "Spectating";
    if (online.roomStatus === "countdown")
      return `Spectating · Starting in ${online.countdownText()}`;
    if (online.roomStatus === "lobby") return "Spectating";
    if (moves === connect4Rows * connect4Columns && !winner) return "Spectating · Draw";
    if (winner) return `Spectating · ${names[winner]} wins`;
    if (online.revision === 0) return "Spectating";
    return `Spectating · ${names[current]} turn`;
  }

  function recordOnlineFinished(state: OnlineConnect4State): void {
    if (online.resultRecorded || !online.seat || !state.winner) return;
    online.resultRecorded = true;
    const outcome =
      state.winner === "draw" ? "draw" : state.winner === online.seat ? "won" : "lost";
    recordGameResult({
      runId,
      gameId: connect4.id,
      outcome,
      moves: state.moves,
      metadata: { mode: "online", seat: online.seat, winner: state.winner },
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
  return parseWithSchema(botPlayModeSchema, value);
}

function parseSaveConnect4(value: unknown): SaveConnect4 | null {
  const parsed = parseWithSchema(saveConnect4BaseSchema, value);
  if (!parsed) return null;
  const board = parseBoard(parsed.board);
  const current = parsePlayer(parsed.current);
  const winner = parseWinner(parsed.winner);
  const mode = parseBotPlayMode(parsed.mode);
  const difficulty = parseDifficulty(parsed.difficulty);
  if (!board || !current || winner === undefined || !mode || !difficulty) return null;
  return { board, current, winner, moves: parsed.moves, mode, difficulty };
}

function parseBoard(value: unknown): Connect4Cell[][] | null {
  return parseFixedGrid(value, connect4Rows, connect4Columns, parseCell);
}

function parseCell(value: unknown): Connect4Cell | null {
  return parseWithSchema(connect4CellSchema, value);
}

function parsePlayer(value: unknown): Connect4Player | null {
  return parseWithSchema(connect4PlayerSchema, value);
}

function parseWinner(value: unknown): Connect4Player | null | undefined {
  if (value === null) return null;
  return parsePlayer(value) ?? undefined;
}

function parseOnlineConnect4State(value: unknown): OnlineConnect4State | null {
  const parsed = parseWithSchema(onlineConnect4BaseSchema, value);
  if (!parsed) return null;
  const board = parseBoard(parsed.board);
  const current = parseMultiplayerSeat(parsed.current);
  const winner = parseOnlineWinner(parsed.winner);
  if (!board || !current || winner === undefined) return null;
  const winningLine = Array.isArray(parsed.winningLine)
    ? parsed.winningLine.flatMap((point): Connect4WinLine => {
        if (!Array.isArray(point) || point.length !== 2) return [];
        const [row, column] = point;
        return typeof row === "number" && typeof column === "number" ? [[row, column]] : [];
      })
    : [];
  return { board, current, winner, winningLine, moves: parsed.moves };
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
