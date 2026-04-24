import {
  createGameShell,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  resetGameProgress,
  setBoardGrid,
  syncChildren,
  type Difficulty,
  type Direction,
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { playSound } from "../sound";
import { changeDifficulty, createDifficultyControl, createResetControl } from "./controls";
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

  const {
    shell,
    status,
    actions,
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "game-2048",
    boardClass: "board--2048",
    boardLabel: "2048 board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const difficultyControl = {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
    },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const requestReset = createResetControl(actions, shell, resetGame);
  onDocumentKeyDown(onKeyDown, scope);

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
    const tiles = syncChildren(grid, values.length, () =>
      el("div", { className: "tile tile-2048" }),
    );
    values.forEach((value, index) => {
      const tile = tiles[index];
      if (!tile) return;
      tile.textContent = value ? String(value) : "";
      tile.dataset.value = String(value);
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    handleStandardGameKey(event, {
      onDirection: (direction) => move(direction),
      onActivate: requestReset,
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function move(direction: Direction): void {
    if (over) {
      invalidMove.trigger();
      return;
    }
    const result = slide2048(board, direction);
    if (!result.changed) {
      invalidMove.trigger();
      return;
    }
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
    invalidMove.cleanup();
    remove();
  };
}
