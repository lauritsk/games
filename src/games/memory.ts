import {
  createDelayedAction,
  createGameShell,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  markGameFinished,
  markGameStarted,
  moveGridIndex,
  onDocumentKeyDown,
  resetGameProgress,
  setBoardGrid,
  syncChildren,
  type Difficulty,
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { loadGamePreferences, parseDifficulty, saveGamePreferences } from "../game-preferences";
import { playSound } from "../sound";
import { changeDifficulty, createDifficultyControl, createResetControl } from "./controls";
import {
  allMemoryMatched,
  newMemoryDeck,
  openUnmatchedMemoryCards,
  type MemoryCard,
} from "./memory.logic";
type Config = { pairs: number; columns: number; rows: number };

const configs: Record<Difficulty, Config> = {
  Easy: { pairs: 6, columns: 4, rows: 3 },
  Medium: { pairs: 8, columns: 4, rows: 4 },
  Hard: { pairs: 12, columns: 6, rows: 4 },
};

export const memory: GameDefinition = {
  id: "memory",
  name: "Memory",
  tagline: "Flip cards. Match pairs.",
  players: "Solo",
  theme: "deep-ocean",
  mount: mountMemory,
};

export function mountMemory(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(memory.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let config = configs[difficulty];
  let cards = newMemoryDeck(config.pairs);
  let selected = 0;
  let moves = 0;
  let lock = false;

  const {
    shell,
    status,
    actions,
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "memory-game",
    boardClass: "board--memory",
    boardLabel: "Memory board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const pendingFlip = createDelayedAction();
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
  onDocumentKeyDown(onKeyDown, scope);

  function resetGame(): void {
    pendingFlip.clear();
    resetGameProgress(shell);
    config = configs[difficulty];
    cards = newMemoryDeck(config.pairs);
    selected = 0;
    moves = 0;
    lock = false;
    savePreferences();
    render();
  }

  function render(): void {
    setBoardGrid(grid, config.columns, config.rows);
    status.textContent = allMemoryMatched(cards) ? `Won · ${moves}` : `Moves ${moves}`;
    difficultyButton.textContent = difficulty;

    const tiles = syncChildren(grid, cards.length, (index) => {
      const tile = el("button", { className: "memory-card", type: "button" });
      tile.addEventListener("click", () => flip(index));
      tile.addEventListener("pointerenter", () => {
        if (selected === index) return;
        selected = index;
        render();
      });
      return tile;
    });
    cards.forEach((card, index) => {
      const faceUp = card.open || card.matched;
      const tile = tiles[index];
      if (!tile) return;
      tile.setAttribute("aria-label", labelFor(card, index));
      tile.textContent = faceUp ? card.symbol : "?";
      tile.dataset.open = String(faceUp);
      tile.dataset.matched = String(card.matched);
      tile.dataset.selected = String(index === selected);
      tile.disabled = false;
      tile.setAttribute("aria-disabled", String(lock || card.open || card.matched));
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    handleStandardGameKey(event, {
      onDirection: (direction) => {
        selected = moveGridIndex(selected, direction, config.columns, cards.length);
        render();
      },
      onActivate: () => flip(selected),
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function flip(index: number): void {
    if (lock) {
      invalidMove.trigger();
      return;
    }
    const card = cards[index];
    if (!card || card.open || card.matched) {
      invalidMove.trigger();
      return;
    }

    markGameStarted(shell);
    card.open = true;
    const open = openUnmatchedMemoryCards(cards);

    if (open.length === 2) {
      moves += 1;
      const [a, b] = open;
      if (!a || !b) return;
      if (a.symbol === b.symbol) {
        a.matched = true;
        b.matched = true;
        a.open = false;
        b.open = false;
        if (allMemoryMatched(cards)) {
          markGameFinished(shell);
          playSound("gameWin");
        } else playSound("gameGood");
      } else {
        playSound("gameBad");
        lock = true;
        pendingFlip.start(() => {
          a.open = false;
          b.open = false;
          lock = false;
          render();
        }, 650);
      }
    } else playSound("gameMove");

    render();
  }

  function labelFor(card: MemoryCard, index: number): string {
    const row = Math.floor(index / config.columns) + 1;
    const column = (index % config.columns) + 1;
    if (card.matched) return `Row ${row}, column ${column}, matched ${card.symbol}`;
    if (card.open) return `Row ${row}, column ${column}, open ${card.symbol}`;
    return `Row ${row}, column ${column}, hidden card`;
  }

  function savePreferences(): void {
    saveGamePreferences(memory.id, { difficulty });
  }

  render();
  return () => {
    pendingFlip.clear();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}
