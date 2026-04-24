import { button, clearNode, createGameShell, el, isConfirmOpen, Keys, markGameFinished, markGameStarted, matchesKey, nextDifficulty, previousDifficulty, requestGameReset, resetGameProgress, type Difficulty, type GameDefinition } from "../core";

type Mark = "X" | "O";
type Cell = Mark | "";
type Mode = "bot" | "local";

const size = 3;
const human: Mark = "X";
const bot: Mark = "O";
const lines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export const tictactoe: GameDefinition = {
  id: "tictactoe",
  name: "Tic-Tac-Toe",
  tagline: "Three in a row.",
  players: "Solo or local",
  theme: "deep-forest",
  mount: mountTicTacToe,
};

export function mountTicTacToe(target: HTMLElement): () => void {
  let board = newBoard();
  let current: Mark = human;
  let mode: Mode = "bot";
  let difficulty: Difficulty = "Medium";
  let selected = 4;
  let winner: Mark | "draw" | null = null;
  let winLine: readonly number[] = [];
  let botTimer: ReturnType<typeof setTimeout> | null = null;

  const { shell, status, actions, board: grid, remove } = createGameShell(target, {
    gameClass: "tictactoe",
    boardClass: "board--tictactoe",
    boardLabel: "Tic-Tac-Toe board",
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
    requestGameReset(shell, resetGame);
  }

  function resetGame(): void {
    clearBotTimer();
    resetGameProgress(shell);
    board = newBoard();
    current = human;
    selected = 4;
    winner = null;
    winLine = [];
    render();
  }

  function render(): void {
    clearNode(grid);
    status.textContent = statusText();
    modeButton.textContent = mode === "bot" ? "Vs bot" : "2 players";
    difficultyButton.textContent = difficulty;

    board.forEach((value, index) => {
      const cell = el("button", { className: "ttt-cell", text: value, ariaLabel: labelFor(index, value), type: "button" });
      cell.dataset.selected = String(index === selected);
      cell.dataset.mark = value;
      if (winLine.includes(index)) cell.dataset.win = "true";
      cell.disabled = isLocked() || Boolean(winner) || value !== "";
      cell.addEventListener("click", () => playTurn(index));
      grid.append(cell);
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    const key = event.key.toLowerCase();
    if (matchesKey(event, Keys.up)) {
      event.preventDefault();
      selected = Math.max(0, selected - size);
      render();
    } else if (matchesKey(event, Keys.right)) {
      event.preventDefault();
      selected = Math.min(board.length - 1, selected + 1);
      render();
    } else if (matchesKey(event, Keys.down)) {
      event.preventDefault();
      selected = Math.min(board.length - 1, selected + size);
      render();
    } else if (matchesKey(event, Keys.left)) {
      event.preventDefault();
      selected = Math.max(0, selected - 1);
      render();
    } else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      playTurn(selected);
    } else if (matchesKey(event, Keys.nextDifficulty)) {
      event.preventDefault();
      difficulty = nextDifficulty(difficulty);
      resetGame();
    } else if (matchesKey(event, Keys.previousDifficulty)) {
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
    if (winner === "draw") return "Draw";
    if (mode === "local") return winner ? `${winner} wins` : `${current} turn`;
    if (winner === human) return "You win";
    if (winner === bot) return "Bot wins";
    return current === human ? "Your turn" : "Bot thinking";
  }

  function isLocked(): boolean {
    return mode === "bot" && current === bot;
  }

  function playTurn(index: number): void {
    if (isLocked() || winner || board[index]) return;
    play(index);
    if (mode === "bot" && !winner && current === bot) scheduleBot();
  }

  function play(index: number): void {
    if (winner || board[index]) return;
    markGameStarted(shell);
    board[index] = current;
    const result = getWinner(board);
    if (result) {
      winner = result.winner;
      winLine = result.line;
      markGameFinished(shell);
    } else if (board.every(Boolean)) {
      winner = "draw";
      markGameFinished(shell);
    } else {
      current = current === human ? bot : human;
    }
    render();
  }

  function scheduleBot(): void {
    clearBotTimer();
    botTimer = setTimeout(() => {
      botTimer = null;
      if (current === bot && !winner) play(chooseBotMove(board, difficulty));
    }, 260);
  }

  function clearBotTimer(): void {
    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
  }

  render();
  return () => {
    document.removeEventListener("keydown", onKeyDown);
    clearBotTimer();
    remove();
  };
}

function newBoard(): Cell[] {
  return Array<Cell>(9).fill("");
}

function chooseBotMove(board: Cell[], difficulty: Difficulty): number {
  const open = openCells(board);
  if (difficulty === "Easy") return random(open);
  return winningMove(board, bot) ?? winningMove(board, human) ?? (difficulty === "Hard" ? minimaxMove(board) : centerCornerSide(board, open));
}

function winningMove(board: Cell[], mark: Mark): number | null {
  for (const index of openCells(board)) {
    const test = [...board];
    test[index] = mark;
    if (getWinner(test)?.winner === mark) return index;
  }
  return null;
}

function minimaxMove(board: Cell[]): number {
  let best = -Infinity;
  let move = openCells(board)[0] ?? 0;
  for (const index of openCells(board)) {
    const test = [...board];
    test[index] = bot;
    const score = minimax(test, false);
    if (score > best) {
      best = score;
      move = index;
    }
  }
  return move;
}

function minimax(board: Cell[], maximizing: boolean): number {
  const result = getWinner(board);
  if (result?.winner === bot) return 10;
  if (result?.winner === human) return -10;
  if (board.every(Boolean)) return 0;

  const scores = openCells(board).map((index) => {
    const test = [...board];
    test[index] = maximizing ? bot : human;
    return minimax(test, !maximizing);
  });
  return maximizing ? Math.max(...scores) : Math.min(...scores);
}

function centerCornerSide(board: Cell[], open: number[]): number {
  return [4, 0, 2, 6, 8, 1, 3, 5, 7].find((index) => open.includes(index)) ?? random(open);
}

function openCells(board: Cell[]): number[] {
  return board.flatMap((value, index) => value ? [] : [index]);
}

function random(values: number[]): number {
  return values[Math.floor(Math.random() * values.length)] ?? 0;
}

function getWinner(board: Cell[]): { winner: Mark; line: readonly number[] } | null {
  for (const line of lines) {
    const [a, b, c] = line;
    const value = board[a];
    if (value && value === board[b] && value === board[c]) return { winner: value, line };
  }
  return null;
}

function labelFor(index: number, value: Cell): string {
  const row = Math.floor(index / size) + 1;
  const column = (index % size) + 1;
  return `Row ${row}, column ${column}, ${value || "empty"}`;
}
