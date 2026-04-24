import { button, clearNode, createGameShell, directionFromKey, el, isConfirmOpen, Keys, markGameFinished, markGameStarted, matchesKey, moveGridIndex, nextDifficulty, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, type Difficulty, type GameDefinition } from "../core";
import { playSound } from "../sound";
import { allMemoryMatched, newMemoryDeck, openUnmatchedMemoryCards, type MemoryCard } from "./memory.logic";
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
  let difficulty: Difficulty = "Medium";
  let config = configs[difficulty];
  let cards = newMemoryDeck(config.pairs);
  let selected = 0;
  let moves = 0;
  let lock = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const { shell, status, actions, board: grid, remove } = createGameShell(target, {
    gameClass: "memory-game",
    boardClass: "board--memory",
    boardLabel: "Memory board",
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
    clearPending();
    resetGameProgress(shell);
    config = configs[difficulty];
    cards = newMemoryDeck(config.pairs);
    selected = 0;
    moves = 0;
    lock = false;
    render();
  }

  function render(): void {
    clearNode(grid);
    setBoardGrid(grid, config.columns, config.rows);
    status.textContent = allMemoryMatched(cards) ? `Won · ${moves}` : `Moves ${moves}`;
    difficultyButton.textContent = difficulty;

    cards.forEach((card, index) => {
      const faceUp = card.open || card.matched;
      const tile = el("button", { className: "memory-card", ariaLabel: labelFor(card, index), type: "button" });
      tile.textContent = faceUp ? card.symbol : "?";
      tile.dataset.open = String(faceUp);
      tile.dataset.matched = String(card.matched);
      tile.dataset.selected = String(index === selected);
      tile.disabled = lock || card.open || card.matched;
      tile.addEventListener("click", () => flip(index));
      grid.append(tile);
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    const direction = directionFromKey(event);
    if (direction) {
      event.preventDefault();
      selected = moveGridIndex(selected, direction, config.columns, cards.length);
      render();
    } else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      flip(selected);
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
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      requestReset();
    }
  }

  function flip(index: number): void {
    if (lock) return;
    const card = cards[index];
    if (!card || card.open || card.matched) return;

    markGameStarted(shell);
    card.open = true;
    const open = openUnmatchedMemoryCards(cards);

    if (open.length === 2) {
      moves += 1;
      const [a, b] = open;
      if (a!.symbol === b!.symbol) {
        a!.matched = true;
        b!.matched = true;
        a!.open = false;
        b!.open = false;
        if (allMemoryMatched(cards)) {
          markGameFinished(shell);
          playSound("gameWin");
        } else playSound("gameGood");
      } else {
        playSound("gameBad");
        lock = true;
        pendingTimer = setTimeout(() => {
          a!.open = false;
          b!.open = false;
          lock = false;
          pendingTimer = null;
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

  function clearPending(): void {
    if (!pendingTimer) return;
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  render();
  return () => {
    clearPending();
    document.removeEventListener("keydown", onKeyDown);
    remove();
  };
}

