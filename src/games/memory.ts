import {
  createDelayedAction,
  createGameShell,
  durationSince,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  isRecord,
  markGameFinished,
  markGameStarted,
  moveGridIndex,
  onDocumentKeyDown,
  parseStartedAt,
  resetGameProgress,
  setBoardGrid,
  setSelected,
  syncChildren,
  type Difficulty,
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { loadGamePreferences, parseDifficulty, saveGamePreferences } from "../game-preferences";
import { recordGameResult } from "../game-results";
import {
  clearGameSave,
  createAutosave,
  createRunId,
  loadGameSave,
  saveGameSave,
} from "../game-state";
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
const savePayloadVersion = 1;

type SaveMemory = {
  difficulty: Difficulty;
  cards: MemoryCard[];
  selected: number;
  moves: number;
  startedAt: number | null;
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
  let startedAt: number | null = null;
  let runId = createRunId();

  const saved = loadGameSave(memory.id, savePayloadVersion, parseSaveMemory);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    config = configs[difficulty];
    cards = saved.payload.cards;
    selected = saved.payload.selected;
    moves = saved.payload.moves;
    startedAt = saved.payload.startedAt;
  }

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
  const autosave = createAutosave({ gameId: memory.id, scope, save: saveCurrentGame });

  function resetGame(): void {
    pendingFlip.clear();
    clearGameSave(memory.id);
    resetGameProgress(shell);
    runId = createRunId();
    config = configs[difficulty];
    cards = newMemoryDeck(config.pairs);
    selected = 0;
    moves = 0;
    lock = false;
    startedAt = null;
    savePreferences();
    render();
  }

  function render(): void {
    setBoardGrid(grid, config.columns, config.rows);
    status.textContent = allMemoryMatched(cards) ? `Won · ${moves}` : `Moves ${moves}`;
    difficultyButton.textContent = difficulty;

    const tiles = syncChildren(grid, cards.length, (index) => {
      const tile = el("button", { className: "game-cell memory-card", type: "button" });
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
      setSelected(tile, index === selected);
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

    ensureStarted();
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
          recordGameResult({
            runId,
            gameId: memory.id,
            difficulty,
            outcome: "completed",
            moves,
            durationMs: durationMs(),
          });
          clearGameSave(memory.id);
          playSound("gameWin");
        } else {
          saveCurrentGame();
          playSound("gameGood");
        }
      } else {
        playSound("gameBad");
        lock = true;
        pendingFlip.start(() => {
          a.open = false;
          b.open = false;
          lock = false;
          saveCurrentGame();
          render();
        }, 650);
      }
    } else {
      saveCurrentGame();
      playSound("gameMove");
    }

    render();
  }

  function labelFor(card: MemoryCard, index: number): string {
    const row = Math.floor(index / config.columns) + 1;
    const column = (index % config.columns) + 1;
    if (card.matched) return `Row ${row}, column ${column}, matched ${card.symbol}`;
    if (card.open) return `Row ${row}, column ${column}, open ${card.symbol}`;
    return `Row ${row}, column ${column}, hidden card`;
  }

  function ensureStarted(): void {
    if (startedAt === null) startedAt = Date.now();
    markGameStarted(shell);
  }

  function saveCurrentGame(): void {
    if (startedAt === null) return;
    if (allMemoryMatched(cards)) {
      clearGameSave(memory.id);
      return;
    }
    saveGameSave(memory.id, savePayloadVersion, {
      runId,
      status: "playing",
      payload: { difficulty, cards: cardsForSave(), selected, moves, startedAt },
    });
  }

  function cardsForSave(): MemoryCard[] {
    const open = openUnmatchedMemoryCards(cards);
    const closePendingMismatch = lock && open.length === 2 && open[0]?.symbol !== open[1]?.symbol;
    return cards.map((card) => ({
      ...card,
      open: closePendingMismatch && card.open && !card.matched ? false : card.open,
    }));
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(memory.id, { difficulty });
  }

  if (startedAt !== null) markGameStarted(shell);
  render();
  return () => {
    autosave.flush();
    pendingFlip.clear();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}

function parseSaveMemory(value: unknown): SaveMemory | null {
  if (!isRecord(value)) return null;
  const difficulty = parseDifficulty(value.difficulty);
  if (!difficulty) return null;
  const config = configs[difficulty];
  const cards = parseCards(value.cards, config.pairs * 2);
  if (!cards) return null;
  if (typeof value.selected !== "number" || value.selected < 0 || value.selected >= cards.length)
    return null;
  if (typeof value.moves !== "number" || !Number.isInteger(value.moves) || value.moves < 0)
    return null;
  const startedAt = parseStartedAt(value.startedAt);
  if (startedAt === undefined) return null;
  return {
    difficulty,
    cards,
    selected: value.selected,
    moves: value.moves,
    startedAt,
  };
}

function parseCards(value: unknown, length: number): MemoryCard[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const cards = value.map(parseCard);
  return cards.every((card): card is MemoryCard => card !== null) ? cards : null;
}

function parseCard(value: unknown): MemoryCard | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "number" || !Number.isInteger(value.id)) return null;
  if (typeof value.symbol !== "string") return null;
  if (typeof value.open !== "boolean" || typeof value.matched !== "boolean") return null;
  return { id: value.id, symbol: value.symbol, open: value.open, matched: value.matched };
}
