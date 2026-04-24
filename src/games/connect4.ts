import { button, clearNode, createGameShell, el, isConfirmOpen, Keys, markGameFinished, markGameStarted, matchesKey, nextDifficulty, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, type Difficulty, type GameDefinition } from "../core";
import { playSound } from "../sound";
import { chooseConnect4BotColumn, connect4Bot, connect4Columns, connect4Human, connect4Rows, dropConnect4Disc, findConnect4Win, newConnect4Board, type Connect4Cell, type Connect4Player, type Connect4WinLine } from "./connect4.logic";

type Mode = "bot" | "local";

const names: Record<Connect4Player, string> = { 1: "Red", 2: "Gold" };

export const connect4: GameDefinition = {
  id: "connect4",
  name: "Connect 4",
  tagline: "Drop discs. Stack four. Keep it light.",
  players: "Solo vs bot",
  theme: "deep-ocean",
  mount: mountConnect4,
};

export function mountConnect4(target: HTMLElement): () => void {
  let board = newConnect4Board();
  let current: Connect4Player = 1;
  let winner: Connect4Player | null = null;
  let winningLine: Connect4WinLine = [];
  let moves = 0;
  let mode: Mode = "bot";
  let difficulty: Difficulty = "Medium";
  let selectedColumn = Math.floor(connect4Columns / 2);
  let botTimer: ReturnType<typeof setTimeout> | null = null;

  const { shell, status, actions, board: grid, remove } = createGameShell(target, {
    gameClass: "connect4",
    boardClass: "board--connect4",
    boardLabel: "Connect 4 board",
  });
  shell.tabIndex = 0;
  setBoardGrid(grid, connect4Columns, connect4Rows);
  document.addEventListener("keydown", onKeyDown);

  const modeButton = button("", "button pill surface interactive");
  const difficultyButton = button("", "button pill surface interactive");
  const reset = button("New", "button pill surface interactive");
  actions.append(modeButton, difficultyButton, reset);

  modeButton.addEventListener("click", () => {
    mode = mode === "bot" ? "local" : "bot";
    playSound("uiToggle");
    resetGame();
  });

  difficultyButton.addEventListener("click", () => {
    difficulty = nextDifficulty(difficulty);
    playSound("uiToggle");
    resetGame();
  });

  reset.addEventListener("click", requestReset);

  function requestReset(): void {
    playSound("uiReset");
    requestGameReset(shell, resetGame);
  }

  function resetGame(): void {
    clearBotTimer();
    resetGameProgress(shell);
    board = newConnect4Board();
    current = connect4Human;
    winner = null;
    winningLine = [];
    moves = 0;
    selectedColumn = Math.floor(connect4Columns / 2);
    render();
  }

  function render(): void {
    clearNode(grid);
    shell.dataset.turn = String(current);
    status.textContent = statusText();
    modeButton.textContent = mode === "bot" ? "Vs bot" : "2 players";
    difficultyButton.textContent = difficulty;

    for (let row = 0; row < connect4Rows; row += 1) {
      for (let column = 0; column < connect4Columns; column += 1) {
        const value = board[row]?.[column] ?? 0;
        const cell = el("button", {
          className: "slot",
          ariaLabel: labelFor(row, column, value),
          type: "button",
        });
        cell.dataset.player = String(value);
        cell.dataset.row = String(row);
        cell.dataset.column = String(column);
        if (column === selectedColumn) cell.dataset.selected = "true";
        if (winningLine.some(([r, c]) => r === row && c === column)) cell.dataset.win = "true";
        cell.disabled = isLocked() || Boolean(winner) || moves === connect4Rows * connect4Columns || !canPlay(column);
        cell.addEventListener("click", () => playTurn(column));
        grid.append(cell);
      }
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    const key = event.key.toLowerCase();
    if (matchesKey(event, Keys.left)) {
      event.preventDefault();
      selectedColumn = Math.max(0, selectedColumn - 1);
      render();
    } else if (matchesKey(event, Keys.right)) {
      event.preventDefault();
      selectedColumn = Math.min(connect4Columns - 1, selectedColumn + 1);
      render();
    } else if (matchesKey(event, [...Keys.activate, ...Keys.down])) {
      event.preventDefault();
      playTurn(selectedColumn);
    } else if (matchesKey(event, Keys.nextDifficulty)) {
      event.preventDefault();
      difficulty = nextDifficulty(difficulty);
      playSound("uiToggle");
      resetGame();
    } else if (matchesKey(event, Keys.previousDifficulty)) {
      event.preventDefault();
      difficulty = previousDifficulty(difficulty);
      playSound("uiToggle");
      resetGame();
    } else if (key === "m") {
      event.preventDefault();
      mode = mode === "bot" ? "local" : "bot";
      playSound("uiToggle");
      resetGame();
    } else if (key === "n") {
      event.preventDefault();
      requestReset();
    }
  }

  function statusText(): string {
    if (moves === connect4Rows * connect4Columns) return "Draw";
    if (mode === "local") return winner ? `${names[winner]} wins` : `${names[current]} turn`;
    if (winner === connect4Human) return "You win";
    if (winner === connect4Bot) return "Bot wins";
    return current === connect4Human ? "Your turn" : "Bot thinking";
  }

  function isLocked(): boolean {
    return mode === "bot" && current === connect4Bot;
  }

  function playTurn(column: number): void {
    if (isLocked()) return;
    play(column);
    if (mode === "bot" && !winner && current === connect4Bot) scheduleBot();
  }

  function play(column: number): void {
    if (winner || !canPlay(column)) return;
    const row = dropConnect4Disc(board, column, current);
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
    if (winner || moves === connect4Rows * connect4Columns) markGameFinished(shell);
    if (winner) playSound(winner === connect4Human ? "gameWin" : "gameLose");
    else if (moves === connect4Rows * connect4Columns) playSound("gameMajor");
    else playSound("gameMove");
    render();
  }

  function scheduleBot(): void {
    clearBotTimer();
    botTimer = setTimeout(() => {
      botTimer = null;
      if (current === connect4Bot && !winner) play(chooseConnect4BotColumn(board, difficulty));
    }, 360);
  }

  function clearBotTimer(): void {
    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
  }

  function canPlay(column: number): boolean {
    return board[0]?.[column] === 0;
  }

  render();

  return () => {
    document.removeEventListener("keydown", onKeyDown);
    clearBotTimer();
    remove();
  };
}

function labelFor(row: number, column: number, value: Connect4Cell): string {
  const token = value === 0 ? "empty" : `${names[value]} disc`;
  return `Row ${row + 1}, column ${column + 1}, ${token}`;
}

