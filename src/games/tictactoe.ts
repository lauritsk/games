import {
  createDelayedAction,
  createGameShell,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  moveGridIndex,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  resetGameProgress,
  setBoardGrid,
  syncChildren,
  type Difficulty,
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
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

export const tictactoe: GameDefinition = {
  id: "tictactoe",
  name: "Tic-Tac-Toe",
  tagline: "Three in a row.",
  players: "Solo or local",
  theme: "deep-forest",
  mount: mountTicTacToe,
};

export function mountTicTacToe(target: HTMLElement): () => void {
  let board = newTicTacToeBoard();
  let current: Mark = humanMark;
  let mode: BotPlayMode = "bot";
  let difficulty: Difficulty = "Medium";
  let selected = 4;
  let winner: Mark | "draw" | null = null;
  let winLine: readonly number[] = [];

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
    },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const requestReset = createResetControl(actions, shell, resetGame);

  function resetGame(): void {
    botMove.clear();
    resetGameProgress(shell);
    board = newTicTacToeBoard();
    current = humanMark;
    selected = 4;
    winner = null;
    winLine = [];
    render();
  }

  function render(): void {
    status.textContent = statusText();
    modeButton.textContent = botPlayModeLabel(mode);
    difficultyButton.textContent = difficulty;

    const cells = syncChildren(grid, board.length, (index) => {
      const cell = el("button", { className: "ttt-cell", type: "button" });
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
      cell.dataset.selected = String(index === selected);
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
    if (winner)
      playSound(winner === "draw" ? "gameMajor" : winner === humanMark ? "gameWin" : "gameLose");
    else playSound("gameMove");
    render();
  }

  function scheduleBot(): void {
    botMove.start(() => {
      if (current === botMark && !winner) play(chooseTicTacToeBotMove(board, difficulty));
    }, 260);
  }

  render();
  return () => {
    scope.cleanup();
    invalidMove.cleanup();
    botMove.clear();
    remove();
  };
}

function labelFor(index: number, value: TicTacToeCell): string {
  const row = Math.floor(index / ticTacToeSize) + 1;
  const column = (index % ticTacToeSize) + 1;
  return `Row ${row}, column ${column}, ${value || "empty"}`;
}
