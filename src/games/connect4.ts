import { button, clearNode, confirmChoice, createGameShell, el, isConfirmOpen, matchesKey, nextDifficulty, previousDifficulty, type Difficulty, type GameDefinition } from "../core";

type Player = 1 | 2;
type Cell = Player | 0;
type WinLine = [number, number][];
type Mode = "bot" | "local";

const rows = 6;
const columns = 7;
const connect = 4;

const human: Player = 1;
const bot: Player = 2;
const names: Record<Player, string> = { 1: "Red", 2: "Gold" };

export const connect4: GameDefinition = {
  id: "connect4",
  name: "Connect 4",
  tagline: "Drop discs. Stack four. Keep it light.",
  players: "Solo vs bot",
  theme: "deep-ocean",
  mount: mountConnect4,
};

export function mountConnect4(target: HTMLElement): () => void {
  let board = newBoard();
  let current: Player = 1;
  let winner: Player | null = null;
  let winningLine: WinLine = [];
  let moves = 0;
  let mode: Mode = "bot";
  let difficulty: Difficulty = "Medium";
  let selectedColumn = Math.floor(columns / 2);
  let botTimer: ReturnType<typeof setTimeout> | null = null;

  const { shell, status, actions, board: grid, remove } = createGameShell(target, {
    gameClass: "connect4",
    boardClass: "board--connect4",
    boardLabel: "Connect 4 board",
  });
  shell.tabIndex = 0;
  document.addEventListener("keydown", onKeyDown);

  const modeButton = button("", "button pill surface interactive");
  const difficultyButton = button("", "button pill surface interactive");
  const reset = button("New", "button pill surface interactive");
  actions.append(modeButton, difficultyButton, reset);

  modeButton.addEventListener("click", () => {
    mode = mode === "bot" ? "local" : "bot";
    resetGame();
  });

  difficultyButton.addEventListener("click", () => {
    difficulty = nextDifficulty(difficulty);
    resetGame();
  });

  reset.addEventListener("click", requestReset);

  function requestReset(): void {
    if (shell.dataset.started === "true" && shell.dataset.finished !== "true") confirmChoice("Start a new game?", resetGame);
    else resetGame();
  }

  function resetGame(): void {
    clearBotTimer();
    shell.dataset.started = "false";
    shell.dataset.finished = "false";
    board = newBoard();
    current = human;
    winner = null;
    winningLine = [];
    moves = 0;
    selectedColumn = Math.floor(columns / 2);
    render();
  }

  function render(): void {
    clearNode(grid);
    shell.dataset.turn = String(current);
    status.textContent = statusText();
    modeButton.textContent = mode === "bot" ? "Vs bot" : "2 players";
    difficultyButton.textContent = difficulty;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
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
        cell.disabled = isLocked() || Boolean(winner) || moves === rows * columns || !canPlay(column);
        cell.addEventListener("click", () => playTurn(column));
        grid.append(cell);
      }
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    const key = event.key.toLowerCase();
    if (matchesKey(event, ["arrowleft", "h"])) {
      event.preventDefault();
      selectedColumn = Math.max(0, selectedColumn - 1);
      render();
    } else if (matchesKey(event, ["arrowright", "l"])) {
      event.preventDefault();
      selectedColumn = Math.min(columns - 1, selectedColumn + 1);
      render();
    } else if (matchesKey(event, [" ", "enter", "arrowdown", "j"])) {
      event.preventDefault();
      playTurn(selectedColumn);
    } else if (matchesKey(event, ["+", "=", ">"])) {
      event.preventDefault();
      difficulty = nextDifficulty(difficulty);
      resetGame();
    } else if (matchesKey(event, ["-", "_", "<"])) {
      event.preventDefault();
      difficulty = previousDifficulty(difficulty);
      resetGame();
    } else if (key === "m") {
      event.preventDefault();
      mode = mode === "bot" ? "local" : "bot";
      resetGame();
    } else if (key === "n") {
      event.preventDefault();
      requestReset();
    }
  }

  function statusText(): string {
    if (moves === rows * columns) return "Draw";
    if (mode === "local") return winner ? `${names[winner]} wins` : `${names[current]} turn`;
    if (winner === human) return "You win";
    if (winner === bot) return "Bot wins";
    return current === human ? "Your turn" : "Bot thinking";
  }

  function isLocked(): boolean {
    return mode === "bot" && current === bot;
  }

  function playTurn(column: number): void {
    if (isLocked()) return;
    play(column);
    if (mode === "bot" && !winner && current === bot) scheduleBot();
  }

  function play(column: number): void {
    if (winner || !canPlay(column)) return;
    const row = dropDisc(board, column, current);
    if (row === null) return;

    shell.dataset.started = "true";
    moves += 1;
    const line = findWin(board, row, column, current);
    if (line) {
      winner = current;
      winningLine = line;
    } else {
      current = current === human ? bot : human;
    }
    if (winner || moves === rows * columns) shell.dataset.finished = "true";
    render();
  }

  function scheduleBot(): void {
    clearBotTimer();
    botTimer = setTimeout(() => {
      botTimer = null;
      if (current === bot && !winner) play(chooseBotColumn(board, difficulty));
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

function newBoard(): Cell[][] {
  return Array.from({ length: rows }, () => Array<Cell>(columns).fill(0));
}

function chooseBotColumn(board: Cell[][], difficulty: Difficulty): number {
  const valid = playableColumns(board);
  if (difficulty === "Easy") return randomMove(valid);

  const tactical = findTacticalMove(board, bot, valid) ?? findTacticalMove(board, human, valid);
  if (tactical !== null) return tactical;

  if (difficulty === "Hard") return safeShapeMove(board, valid) ?? bestShapeMove(board, valid) ?? randomMove(valid);
  return bestShapeMove(board, valid) ?? randomMove(valid);
}

function randomMove(valid: number[]): number {
  return valid[Math.floor(Math.random() * valid.length)] ?? 0;
}

function safeShapeMove(board: Cell[][], valid: number[]): number | null {
  return valid
    .filter((column) => !givesImmediateWin(board, column))
    .sort((a, b) => scoreMove(board, b, bot) - scoreMove(board, a, bot))[0] ?? null;
}

function givesImmediateWin(board: Cell[][], column: number): boolean {
  const test = cloneBoard(board);
  const row = dropDisc(test, column, bot);
  if (row === null) return true;
  return findTacticalMove(test, human, playableColumns(test)) !== null;
}

function playableColumns(board: Cell[][]): number[] {
  return Array.from({ length: columns }, (_, column) => column).filter((column) => board[0]?.[column] === 0);
}

function findTacticalMove(board: Cell[][], player: Player, valid: number[]): number | null {
  for (const column of valid) {
    const test = cloneBoard(board);
    const row = dropDisc(test, column, player);
    if (row !== null && findWin(test, row, column, player)) return column;
  }
  return null;
}

function bestShapeMove(board: Cell[][], valid: number[]): number | null {
  const center = Math.floor(columns / 2);
  return [...valid].sort((a, b) => scoreMove(board, b, bot) - scoreMove(board, a, bot) || Math.abs(a - center) - Math.abs(b - center))[0] ?? null;
}

function scoreMove(board: Cell[][], column: number, player: Player): number {
  const test = cloneBoard(board);
  const row = dropDisc(test, column, player);
  if (row === null) return -Infinity;
  return longestLine(test, row, column, player) * 10 - Math.abs(column - Math.floor(columns / 2));
}

function longestLine(board: Cell[][], row: number, column: number, player: Player): number {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;
  return Math.max(...directions.map(([dr, dc]) => 1 + walk(board, row, column, dr, dc, player).length + walk(board, row, column, -dr, -dc, player).length));
}

function dropDisc(board: Cell[][], column: number, player: Player): number | null {
  for (let row = rows - 1; row >= 0; row -= 1) {
    if (board[row]?.[column] === 0) {
      board[row]![column] = player;
      return row;
    }
  }
  return null;
}

function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map((row) => [...row]);
}

function labelFor(row: number, column: number, value: Cell): string {
  const token = value === 0 ? "empty" : `${names[value]} disc`;
  return `Row ${row + 1}, column ${column + 1}, ${token}`;
}

function findWin(board: Cell[][], row: number, column: number, player: Player): WinLine | null {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;

  for (const [dr, dc] of directions) {
    const line: WinLine = [[row, column]];
    line.push(...walk(board, row, column, dr, dc, player));
    line.push(...walk(board, row, column, -dr, -dc, player));
    if (line.length >= connect) return line;
  }
  return null;
}

function walk(board: Cell[][], row: number, column: number, dr: number, dc: number, player: Player): WinLine {
  const line: WinLine = [];
  let r = row + dr;
  let c = column + dc;
  while (r >= 0 && r < rows && c >= 0 && c < columns && board[r]?.[c] === player) {
    line.push([r, c]);
    r += dr;
    c += dc;
  }
  return line;
}
