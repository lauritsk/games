import { createDifficultyButton, createGameShell, createMountScope, createResetButton, el, handleStandardGameKey, markGameFinished, markGameStarted, nextDifficulty, onDocumentKeyDown, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, syncChildren, type Difficulty, type Direction, type GameDefinition } from "../core";
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

  const scope = createMountScope();
  const difficultyButton = createDifficultyButton(actions, () => {
    difficulty = nextDifficulty(difficulty);
    playSound("uiToggle");
    resetGame();
  });
  createResetButton(actions, requestReset);
  onDocumentKeyDown(onKeyDown, scope);

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
    setBoardGrid(grid, size);
    status.textContent = over ? `Done · ${score}` : String(score);
    difficultyButton.textContent = difficulty;

    const values = board.flat();
    const tiles = syncChildren(grid, values.length, () => el("div", { className: "tile tile-2048" }));
    values.forEach((value, index) => {
      const tile = tiles[index];
      if (!tile) return;
      tile.textContent = value ? String(value) : "";
      tile.dataset.value = String(value);
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    handleStandardGameKey(event, {
      onDirection: (direction) => {
        if (!over) move(direction);
      },
      onActivate: requestReset,
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
    scope.cleanup();
    remove();
  };
}

