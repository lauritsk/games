import { button, clearNode, createGameShell, directionFromKey, el, isConfirmOpen, Keys, markGameFinished, markGameStarted, matchesKey, nextDifficulty, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, type Difficulty, type Direction, type GameDefinition } from "../core";
import { playSound } from "../sound";
import { addRandom2048Tile, canMove2048, slide2048, start2048Board } from "./2048.logic";

const sizes: Record<Difficulty, number> = { Easy: 3, Medium: 4, Hard: 5 };

export const game2048: GameDefinition = {
  id: "2048",
  name: "2048",
  tagline: "Slide tiles. Merge numbers.",
  players: "Solo",
  theme: "outer-space",
  mount: mount2048,
};

export function mount2048(target: HTMLElement): () => void {
  let difficulty: Difficulty = "Medium";
  let size = sizes[difficulty];
  let board = start2048Board(size);
  let score = 0;
  let over = false;

  const { shell, status, actions, board: grid, remove } = createGameShell(target, {
    gameClass: "game-2048",
    boardClass: "board--2048",
    boardLabel: "2048 board",
  });
  shell.tabIndex = 0;

  const difficultyButton = button("", "button pill surface interactive");
  const reset = button("New", "button pill surface interactive");
  actions.append(difficultyButton, reset);

  difficultyButton.addEventListener("click", () => {
    difficulty = nextDifficulty(difficulty);
    playSound("uiToggle");
    resetGame();
  });
  reset.addEventListener("click", requestReset);
  document.addEventListener("keydown", onKeyDown);

  function requestReset(): void {
    playSound("uiReset");
    requestGameReset(shell, resetGame);
  }

  function resetGame(): void {
    resetGameProgress(shell);
    size = sizes[difficulty];
    board = start2048Board(size);
    score = 0;
    over = false;
    render();
  }

  function render(): void {
    clearNode(grid);
    setBoardGrid(grid, size);
    status.textContent = over ? `Done · ${score}` : String(score);
    difficultyButton.textContent = difficulty;

    for (const value of board.flat()) {
      const tile = el("div", { className: "tile tile-2048", text: value ? String(value) : "" });
      tile.dataset.value = String(value);
      grid.append(tile);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    const key = event.key.toLowerCase();
    const direction = directionFromKey(event);
    if (direction && !over) {
      event.preventDefault();
      move(direction);
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
    } else if (key === "n") {
      event.preventDefault();
      requestReset();
    } else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      requestReset();
    }
  }

  function move(direction: Direction): void {
    const result = slide2048(board, direction);
    if (!result.changed) return;
    markGameStarted(shell);
    board = addRandom2048Tile(result.board);
    score += result.score;
    over = !canMove2048(board);
    if (over) markGameFinished(shell);
    playSound(over ? "gameLose" : result.score > 0 ? "gameGood" : "gameMove");
    render();
  }

  render();
  return () => {
    document.removeEventListener("keydown", onKeyDown);
    remove();
  };
}

