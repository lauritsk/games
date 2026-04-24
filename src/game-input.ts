import { button } from "./dom";
import { isConfirmOpen } from "./dialog";
import { directionFromKey, Keys, matchesKey } from "./keyboard";
import type { Direction } from "./types";

export type StandardGameKeyHandlers = {
  onDirection?: (direction: Direction, event: KeyboardEvent) => void;
  onActivate?: (event: KeyboardEvent) => void;
  onNextDifficulty?: (event: KeyboardEvent) => void;
  onPreviousDifficulty?: (event: KeyboardEvent) => void;
  onReset?: (event: KeyboardEvent) => void;
};

export function handleStandardGameKey(event: KeyboardEvent, handlers: StandardGameKeyHandlers): boolean {
  if (isConfirmOpen()) return true;
  const direction = directionFromKey(event);
  if (direction && handlers.onDirection) {
    event.preventDefault();
    handlers.onDirection(direction, event);
    return true;
  }
  if (matchesKey(event, Keys.activate) && handlers.onActivate) {
    event.preventDefault();
    handlers.onActivate(event);
    return true;
  }
  if (matchesKey(event, Keys.nextDifficulty) && handlers.onNextDifficulty) {
    event.preventDefault();
    handlers.onNextDifficulty(event);
    return true;
  }
  if (matchesKey(event, Keys.previousDifficulty) && handlers.onPreviousDifficulty) {
    event.preventDefault();
    handlers.onPreviousDifficulty(event);
    return true;
  }
  if (event.key.toLowerCase() === "n" && handlers.onReset) {
    event.preventDefault();
    handlers.onReset(event);
    return true;
  }
  return false;
}

export function createDifficultyButton(actions: HTMLElement, onClick: () => void): HTMLButtonElement {
  const difficultyButton = button("", "button pill surface interactive");
  difficultyButton.addEventListener("click", onClick);
  actions.append(difficultyButton);
  return difficultyButton;
}

export function createResetButton(actions: HTMLElement, onClick: () => void): HTMLButtonElement {
  const resetButton = button("New", "button pill surface interactive");
  resetButton.addEventListener("click", onClick);
  actions.append(resetButton);
  return resetButton;
}
