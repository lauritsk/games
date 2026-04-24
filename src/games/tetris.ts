import { createDifficultyButton, createGameShell, createMountScope, createResetButton, el, handleStandardGameKey, markGameFinished, markGameStarted, nextDifficulty, onDocumentKeyDown, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, syncChildren, type Difficulty, type Direction, type GameDefinition } from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { playSound } from "../sound";
import { moveTetrisPiece, newTetrisState, rotateTetrisPiece, tetrisColumns, tetrisDrop, tetrisGhostPiece, tetrisHardDrop, tetrisPieceCells, tetrisRows, type TetrisCell, type TetrisPoint, type TetrisState } from "./tetris.logic";

type Mode = "ready" | "playing" | "paused" | "over";
type Config = { speed: number };

const configs: Record<Difficulty, Config> = {
  Easy: { speed: 720 },
  Medium: { speed: 520 },
  Hard: { speed: 340 },
};

export const tetris: GameDefinition = {
  id: "tetris",
  name: "Tetris",
  tagline: "Stack, rotate, clear lines.",
  players: "Solo",
  theme: "outer-space",
  mount: mountTetris,
};

export function mountTetris(target: HTMLElement): () => void {
  let difficulty: Difficulty = "Medium";
  let state = newTetrisState();
  let mode: Mode = "ready";
  let timer: ReturnType<typeof setInterval> | null = null;

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "tetris-game",
    boardClass: "board--tetris",
    boardLabel: "Tetris board",
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const difficultyButton = createDifficultyButton(actions, () => {
    difficulty = nextDifficulty(difficulty);
    playSound("uiToggle");
    resetGame();
  });
  const pauseButton = el("button", { className: "button pill surface interactive", text: "Pause", type: "button" });
  pauseButton.addEventListener("click", togglePause);
  actions.append(pauseButton);
  createResetButton(actions, requestReset);
  onDocumentKeyDown(onKeyDown, scope);

  function requestReset(): void {
    playSound("uiReset");
    requestGameReset(shell, resetGame);
  }

  function resetGame(): void {
    stopTimer();
    resetGameProgress(shell);
    state = newTetrisState();
    mode = "ready";
    render();
  }

  function start(): void {
    if (mode === "over") {
      invalidMove.trigger();
      return;
    }
    if (mode === "paused") mode = "playing";
    if (mode === "ready") {
      mode = "playing";
      markGameStarted(shell);
      playSound("gameMajor");
    }
    restartTimer();
    render();
  }

  function togglePause(): void {
    if (mode === "over") return;
    if (mode === "playing") {
      mode = "paused";
      stopTimer();
      playSound("uiToggle");
    } else {
      start();
    }
    render();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      togglePause();
      return;
    }
    handleStandardGameKey(event, {
      onDirection: (direction) => handleDirection(direction),
      onActivate: () => hardDrop(),
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

  function handleDirection(direction: Direction): void {
    if (mode === "paused" || mode === "over") {
      invalidMove.trigger();
      return;
    }
    start();
    const before = state.piece;
    if (direction === "up") state = { ...state, piece: rotateTetrisPiece(state.board, state.piece) };
    else state = { ...state, piece: moveTetrisPiece(state.board, state.piece, direction) };
    if (state.piece === before) invalidMove.trigger();
    else playSound("gameMove");
    render();
  }

  function hardDrop(): void {
    if (mode === "paused" || mode === "over") {
      invalidMove.trigger();
      return;
    }
    start();
    state = tetrisHardDrop(state);
    afterDrop(true);
  }

  function tick(): void {
    state = tetrisDrop(state);
    afterDrop(false);
  }

  function afterDrop(hard: boolean): void {
    if (state.over) {
      mode = "over";
      markGameFinished(shell);
      stopTimer();
      playSound("gameLose");
    } else {
      restartTimer();
      playSound(hard ? "gameGood" : "gameMove");
    }
    render();
  }

  function render(): void {
    setBoardGrid(board, tetrisColumns, tetrisRows);
    difficultyButton.textContent = difficulty;
    pauseButton.textContent = mode === "paused" ? "Resume" : "Pause";
    status.textContent = statusText();

    const active = new Map(tetrisPieceCells(state.piece).map((cell) => [pointKey(cell), state.piece.type]));
    const ghost = new Set(tetrisPieceCells(tetrisGhostPiece(state.board, state.piece)).map(pointKey));
    const cells = syncChildren(board, tetrisRows * tetrisColumns, () => el("div", { className: "tetris-cell" }));
    cells.forEach((cell, index) => {
      const point = { row: Math.floor(index / tetrisColumns), column: index % tetrisColumns };
      const key = pointKey(point);
      const ghostOnly = ghost.has(key) && !active.has(key);
      const value = active.get(key) ?? state.board[point.row]?.[point.column] ?? "";
      cell.dataset.value = value;
      cell.dataset.active = String(active.has(key));
      cell.dataset.ghost = String(ghostOnly);
      cell.setAttribute("aria-label", labelFor(point, value, ghostOnly));
    });
  }

  function statusText(): string {
    if (mode === "ready") return `Ready · ${state.next} next`;
    if (mode === "paused") return "Paused";
    if (mode === "over") return `Over · ${state.score}`;
    return `${state.score} · L${state.level} · ${state.next}`;
  }

  function labelFor(point: TetrisPoint, value: TetrisCell, ghost: boolean): string {
    const content = ghost ? "landing preview" : value === "" ? "empty" : `${value} block`;
    return `Row ${point.row + 1}, column ${point.column + 1}, ${content}`;
  }

  function restartTimer(): void {
    if (mode !== "playing") return;
    stopTimer();
    const levelSpeed = Math.max(90, configs[difficulty].speed - (state.level - 1) * 35);
    timer = setInterval(tick, levelSpeed);
  }

  function stopTimer(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function pointKey(point: TetrisPoint): string {
    return `${point.row}:${point.column}`;
  }

  render();
  return () => {
    stopTimer();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}
