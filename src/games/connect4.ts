import { createDifficultyButton, createGameShell, createMountScope, createResetButton, el, handleStandardGameKey, isConfirmOpen, Keys, markGameFinished, markGameStarted, matchesKey, nextDifficulty, onDocumentKeyDown, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, syncChildren, type Difficulty, type GameDefinition } from "../core";
import { playSound } from "../sound";
import { chooseConnect4BotColumn, connect4Bot, connect4Columns, connect4Human, connect4Rows, dropConnect4DiscInPlace, findConnect4Win, newConnect4Board, type Connect4Cell, type Connect4Player, type Connect4WinLine } from "./connect4.logic";

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
  const scope = createMountScope();
  onDocumentKeyDown(onKeyDown, scope);

  const modeButton = el("button", { className: "button pill surface interactive", type: "button" });
  actions.append(modeButton);
  modeButton.addEventListener("click", () => {
    mode = mode === "bot" ? "local" : "bot";
    playSound("uiToggle");
    resetGame();
  });

  const difficultyButton = createDifficultyButton(actions, () => {
    difficulty = nextDifficulty(difficulty);
    playSound("uiToggle");
    resetGame();
  });

  createResetButton(actions, requestReset);

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
    shell.dataset.turn = String(current);
    status.textContent = statusText();
    modeButton.textContent = mode === "bot" ? "Vs bot" : "2 players";
    difficultyButton.textContent = difficulty;

    const cells = syncChildren(grid, connect4Rows * connect4Columns, (index) => {
      const column = index % connect4Columns;
      const cell = el("button", { className: "slot", type: "button" });
      cell.addEventListener("click", () => playTurn(column));
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
        if (column === selectedColumn) cell.dataset.selected = "true";
        else delete cell.dataset.selected;
        if (winningLine.some(([r, c]) => r === row && c === column)) cell.dataset.win = "true";
        else delete cell.dataset.win;
        cell.disabled = isLocked() || Boolean(winner) || moves === connect4Rows * connect4Columns || !canPlay(column);
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      mode = mode === "bot" ? "local" : "bot";
      playSound("uiToggle");
      resetGame();
      return;
    }
    if (matchesKey(event, Keys.down)) {
      event.preventDefault();
      playTurn(selectedColumn);
      return;
    }
    handleStandardGameKey(event, {
      onDirection: (direction) => {
        if (direction === "left") selectedColumn = Math.max(0, selectedColumn - 1);
        else if (direction === "right") selectedColumn = Math.min(connect4Columns - 1, selectedColumn + 1);
        else if (direction === "down") playTurn(selectedColumn);
        render();
      },
      onActivate: () => playTurn(selectedColumn),
      onNextDifficulty: () => {
        difficulty = nextDifficulty(difficulty);
        playSound("uiToggle");
        resetGame();
      },
      onPreviousDifficulty: () => {
        difficulty = previousDifficulty(difficulty);
        playSound("uiToggle");
        resetGame();
      },
      onReset: requestReset,
    });
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
    scope.cleanup();
    clearBotTimer();
    remove();
  };
}

function labelFor(row: number, column: number, value: Connect4Cell): string {
  const token = value === 0 ? "empty" : `${names[value]} disc`;
  return `Row ${row + 1}, column ${column + 1}, ${token}`;
}

