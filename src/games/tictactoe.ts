import {
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
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { loadGamePreferences, parseDifficulty, saveGamePreferences } from "../game-preferences";
import { recordGameResult } from "../game-results";
import { clearGameSave, createRunId, loadGameSave, saveGameSave } from "../game-state";
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
  botMark,
  chooseTicTacToeBotMove,
  getTicTacToeWinner,
  humanMark,
  newTicTacToeBoard,
  ticTacToeSize,
  type Mark,
  type TicTacToeCell,
} from "./tictactoe.logic";

const savePayloadVersion = 1;

type SaveTicTacToe = {
  board: TicTacToeCell[];
  current: Mark;
  mode: BotPlayMode;
  difficulty: Difficulty;
  winner: Mark | "draw" | null;
};

export const tictactoe: GameDefinition = {
  id: "tictactoe",
  name: "Tic-Tac-Toe",
  tagline: "Three in a row.",
  players: "Solo or local",
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
  onDocumentKeyDown(onKeyDown, scope);

  const modeControl = {
    get: () => mode,
    set: (next: BotPlayMode) => {
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
      difficulty = next;
      savePreferences();
    },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const requestReset = createResetControl(actions, shell, resetGame);

  function resetGame(): void {
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
    modeButton.textContent = botPlayModeLabel(mode);
    difficultyButton.textContent = difficulty;

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
      toggleMode(modeControl);
      return;
    }
    handleStandardGameKey(event, {
      onDirection: (direction) => {
        selected = moveGridIndex(selected, direction, ticTacToeSize, board.length);
        render();
      },
      onActivate: () => playTurn(selected),
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function statusText(): string {
    if (winner === "draw") return "Draw";
    if (mode === "local") return winner ? `${winner} wins` : `${current} turn`;
    if (winner === humanMark) return "You win";
    if (winner === botMark) return "Bot wins";
    return current === humanMark ? "Your turn" : "Bot thinking";
  }

  function isLocked(): boolean {
    return mode === "bot" && current === botMark;
  }

  function playTurn(index: number): void {
    if (isLocked()) return;
    if (winner || board[index]) {
      invalidMove.trigger();
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
    saveGameSave(tictactoe.id, savePayloadVersion, {
      runId,
      status: "playing",
      payload: { board, current, mode, difficulty, winner },
    });
  }

  function recordFinishedGame(): void {
    if (!winner) return;
    recordGameResult({
      runId,
      gameId: tictactoe.id,
      difficulty,
      outcome: winner === "draw" ? "draw" : mode === "bot" && winner === botMark ? "lost" : "won",
      moves: board.filter(Boolean).length,
      metadata: { mode, winner },
    });
  }

  function savePreferences(): void {
    saveGamePreferences(tictactoe.id, { difficulty, options: { mode } });
  }

  if (board.some(Boolean)) markGameStarted(shell);
  render();
  if (mode === "bot" && current === botMark && !winner) scheduleBot();
  return () => {
    scope.cleanup();
    invalidMove.cleanup();
    botMove.clear();
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

function labelFor(index: number, value: TicTacToeCell): string {
  const row = Math.floor(index / ticTacToeSize) + 1;
  const column = (index % ticTacToeSize) + 1;
  return `Row ${row}, column ${column}, ${value || "empty"}`;
}
