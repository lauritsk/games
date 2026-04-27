import * as v from "valibot";
import {
  createGameShell,
  createMountScope,
  durationSince,
  el,
  gameLayouts,
  isConfirmOpen,
  Keys,
  matchesKey,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  parseArray,
  parseFixedArray,
  parseStartedAt,
  parseWithSchema,
  picklistSchema,
  resetGameProgress,
  setSelected,
  syncChildren,
  type Difficulty,
  type GameDefinition,
} from "@shared/core";
import { createInvalidMoveFeedback } from "@ui/feedback";
import {
  loadGamePreferences,
  parseDifficulty,
  saveGamePreferences,
} from "@games/shared/game-preferences";
import { recordGameResult } from "@features/results/game-results";
import { clearGameSave, createRunId, loadGameSave, saveGameSave } from "@games/shared/game-state";
import { createGameDifficultyControl, createResetControl } from "@games/shared/controls";
import { playSound } from "@ui/sound";
import {
  evaluateWordleGuess,
  isValidWordleGuess,
  normalizeWordleInput,
  pickWordleTarget,
  wordleConfigs,
  wordleKeyboardRows,
  wordleKeyboardState,
  type WordleConfig,
  type WordleGuess,
  type WordleLetterState,
} from "@games/wordle/logic";

const gameId = "wordle";
const savePayloadVersion = 1;
const wordleLetterStateSchema = picklistSchema(["absent", "present", "correct"] as const);
const saveWordleGuessBaseSchema = v.looseObject({
  word: v.string(),
  evaluation: v.unknown(),
});
const saveWordleBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  target: v.string(),
  guesses: v.unknown(),
  current: v.string(),
  startedAt: v.unknown(),
});

type SaveWordle = {
  difficulty: Difficulty;
  target: string;
  guesses: WordleGuess[];
  current: string;
  startedAt: number | null;
};

export const wordle: GameDefinition = {
  id: gameId,
  name: "Wordle",
  tagline: "Guess the hidden word.",
  players: "Solo",
  theme: "deep-cave",
  mount: mountWordle,
};

export function mountWordle(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(gameId);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let config = wordleConfigs[difficulty];
  let targetWord = pickWordleTarget(config);
  let guesses: WordleGuess[] = [];
  let current = "";
  let startedAt: number | null = null;
  let runId = createRunId();
  let message: string | null = null;

  const saved = loadGameSave(gameId, savePayloadVersion, parseSaveWordle);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    config = wordleConfigs[difficulty];
    targetWord = saved.payload.target;
    guesses = saved.payload.guesses;
    current = saved.payload.current;
    startedAt = saved.payload.startedAt;
  }

  const {
    shell,
    status,
    actions,
    board: panel,
    remove,
  } = createGameShell(target, {
    gameClass: "wordle-game",
    boardClass: "board--wordle",
    boardLabel: "Wordle play area",
    layout: { ...gameLayouts.squareFit, aspectRatio: "5 / 7", maxInline: "500px" },
  });
  shell.tabIndex = 0;
  panel.removeAttribute("role");
  panel.setAttribute("aria-label", "Wordle play area");

  const grid = el("div", { className: "wordle-grid", ariaLabel: "Wordle guesses" });
  grid.setAttribute("role", "grid");
  const keyboard = el("div", { className: "wordle-keyboard", ariaLabel: "Wordle keyboard" });
  keyboard.setAttribute("role", "group");
  panel.append(grid, keyboard);

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const difficultyControl = createGameDifficultyControl(actions, {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
      savePreferences();
    },
    reset: resetGame,
  });
  const requestReset = createResetControl(actions, shell, resetGame);
  const keyButtons = createKeyboard();
  onDocumentKeyDown(onKeyDown, scope);

  function resetGame(): void {
    clearGameSave(gameId);
    resetGameProgress(shell);
    runId = createRunId();
    config = wordleConfigs[difficulty];
    targetWord = pickWordleTarget(config);
    guesses = [];
    current = "";
    startedAt = null;
    message = null;
    savePreferences();
    render();
  }

  function render(): void {
    const finished = isFinished();
    panel.style.setProperty("--wordle-columns", String(config.wordLength));
    panel.style.setProperty("--wordle-rows", String(config.maxGuesses));
    status.textContent = message ?? statusText();
    difficultyControl.sync();

    const cellCount = config.wordLength * config.maxGuesses;
    const cells = syncChildren(grid, cellCount, () => el("div", { className: "wordle-cell" }));
    for (let index = 0; index < cellCount; index += 1) {
      const cell = cells[index];
      if (!cell) continue;
      const row = Math.floor(index / config.wordLength);
      const column = index % config.wordLength;
      const submitted = guesses[row];
      const currentLetter = row === guesses.length && !finished ? current[column] : undefined;
      const letter = submitted?.word[column] ?? currentLetter ?? "";
      const state = submitted?.evaluation[column] ?? (letter ? "filled" : "empty");
      cell.textContent = letter;
      cell.dataset.state = state;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", cellLabel(row, column, letter, state));
      setSelected(cell, row === guesses.length && column === current.length && !finished);
    }

    const keyState = wordleKeyboardState(guesses);
    keyButtons.forEach((button, key) => {
      if (key.length === 1) {
        const state = keyState[key];
        if (state) button.dataset.state = state;
        else delete button.dataset.state;
      }
      button.disabled = finished;
    });
  }

  function createKeyboard(): Map<string, HTMLButtonElement> {
    const buttons = new Map<string, HTMLButtonElement>();
    wordleKeyboardRows.forEach((letters, rowIndex) => {
      const row = el("div", { className: "wordle-keyboard__row" });
      if (rowIndex === 2) row.append(createKey("Enter", "Enter"));
      for (const letter of letters) row.append(createKey(letter, letter));
      if (rowIndex === 2) row.append(createKey("Backspace", "⌫"));
      keyboard.append(row);
    });
    return buttons;

    function createKey(key: string, label: string): HTMLButtonElement {
      const keyButton = el("button", {
        className: "wordle-key interactive",
        text: label,
        type: "button",
        ariaLabel: key === "Backspace" ? "Delete letter" : key,
      });
      keyButton.dataset.key = key;
      keyButton.addEventListener("click", () => handleInputKey(key));
      buttons.set(key, keyButton);
      return keyButton;
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    if (matchesKey(event, Keys.nextDifficulty)) {
      event.preventDefault();
      difficultyControl.next();
      return;
    }
    if (matchesKey(event, Keys.previousDifficulty)) {
      event.preventDefault();
      difficultyControl.previous();
      return;
    }
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      requestReset();
      return;
    }
    if (handleInputKey(event.key)) event.preventDefault();
  }

  function handleInputKey(key: string): boolean {
    const letter = normalizeWordleInput(key);
    const isInputKey =
      key === "Enter" || key === "Backspace" || key === "Delete" || letter.length === 1;
    if (!isInputKey) return false;
    if (isFinished()) return true;
    if (key === "Enter") {
      submitGuess();
      return true;
    }
    if (key === "Backspace" || key === "Delete") {
      deleteLetter();
      return true;
    }
    addLetter(letter);
    return true;
  }

  function addLetter(letter: string): void {
    if (isFinished()) return;
    if (current.length >= config.wordLength) {
      invalid("Press Enter");
      return;
    }
    ensureStarted();
    message = null;
    current += letter;
    saveCurrentGame();
    playSound("gameMove");
    render();
  }

  function deleteLetter(): void {
    if (isFinished()) return;
    if (current.length === 0) {
      invalidMove.trigger();
      return;
    }
    message = null;
    current = current.slice(0, -1);
    saveCurrentGame();
    playSound("gameMove");
    render();
  }

  function submitGuess(): void {
    if (isFinished()) return;
    if (!isValidWordleGuess(current, config)) {
      invalid(`Need ${config.wordLength} letters`);
      return;
    }
    ensureStarted();
    const evaluation = evaluateWordleGuess(current, targetWord);
    guesses = [...guesses, { word: current, evaluation }];
    current = "";

    if (evaluation.every((state) => state === "correct")) {
      finish("won");
      playSound("gameWin");
    } else if (guesses.length >= config.maxGuesses) {
      finish("lost");
      playSound("gameLose");
    } else {
      message = null;
      saveCurrentGame();
      playSound("gameGood");
    }
    render();
  }

  function finish(outcome: "won" | "lost"): void {
    markGameFinished(shell);
    message = outcome === "won" ? `Solved · ${targetWord}` : `Answer · ${targetWord}`;
    recordGameResult({
      runId,
      gameId,
      difficulty,
      outcome,
      moves: guesses.length,
      durationMs: durationSince(startedAt),
      metadata: { wordLength: config.wordLength },
    });
    clearGameSave(gameId);
  }

  function invalid(text: string): void {
    message = text;
    invalidMove.trigger();
    playSound("gameBad");
    render();
  }

  function statusText(): string {
    const attempt = Math.min(guesses.length + 1, config.maxGuesses);
    return `Guess ${attempt}/${config.maxGuesses} · ${current.length}/${config.wordLength}`;
  }

  function isFinished(): boolean {
    return shell.dataset.finished === "true";
  }

  function ensureStarted(): void {
    if (startedAt === null) startedAt = Date.now();
    markGameStarted(shell);
  }

  function saveCurrentGame(): void {
    if (isFinished() || startedAt === null) return;
    saveGameSave(gameId, savePayloadVersion, {
      runId,
      status: "playing",
      payload: { difficulty, target: targetWord, guesses, current, startedAt },
    });
  }

  function savePreferences(): void {
    saveGamePreferences(gameId, { difficulty });
  }

  function cellLabel(
    row: number,
    column: number,
    letter: string,
    state: WordleLetterState | "filled" | "empty",
  ): string {
    const prefix = `Row ${row + 1}, column ${column + 1}`;
    if (!letter) return `${prefix}, empty`;
    if (state === "filled") return `${prefix}, ${letter}`;
    return `${prefix}, ${letter}, ${state}`;
  }

  if (startedAt !== null) markGameStarted(shell);
  render();
  return () => {
    scope.cleanup();
    invalidMove.cleanup();
    remove();
  };
}

function parseSaveWordle(value: unknown): SaveWordle | null {
  const parsed = parseWithSchema(saveWordleBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  if (!difficulty) return null;
  const config = wordleConfigs[difficulty];
  const target = normalizeWordleInput(parsed.target);
  if (!isValidWordleGuess(target, config) || !isConfiguredAnswer(target, config)) return null;
  const guesses = parseGuesses(parsed.guesses, config);
  if (!guesses || guesses.length > config.maxGuesses) return null;
  const evaluatedGuesses = guesses.map(({ word }) => ({
    word,
    evaluation: evaluateWordleGuess(word, target),
  }));
  if (isTerminalGuessList(evaluatedGuesses, config)) return null;
  const current = normalizeWordleInput(parsed.current);
  if (current.length > config.wordLength) return null;
  const startedAt = parseStartedAt(parsed.startedAt);
  if (startedAt === undefined) return null;
  return { difficulty, target, guesses: evaluatedGuesses, current, startedAt };
}

function isConfiguredAnswer(word: string, config: WordleConfig): boolean {
  return config.answers.includes(word);
}

function isTerminalGuessList(guesses: readonly WordleGuess[], config: WordleConfig): boolean {
  return (
    guesses.length >= config.maxGuesses ||
    guesses.some((guess) => guess.evaluation.every((state) => state === "correct"))
  );
}

function parseGuesses(value: unknown, config: WordleConfig): WordleGuess[] | null {
  const guesses = parseArray(value, (item) => parseGuess(item, config.wordLength));
  if (!guesses) return null;
  return guesses.every((guess) => isValidWordleGuess(guess.word, config)) ? guesses : null;
}

function parseGuess(value: unknown, length: number): WordleGuess | null {
  const parsed = parseWithSchema(saveWordleGuessBaseSchema, value);
  if (!parsed) return null;
  const word = normalizeWordleInput(parsed.word);
  const evaluation = parseFixedArray(parsed.evaluation, length, parseLetterState);
  if (!evaluation) return null;
  return { word, evaluation };
}

function parseLetterState(value: unknown): WordleLetterState | null {
  return parseWithSchema(wordleLetterStateSchema, value);
}
