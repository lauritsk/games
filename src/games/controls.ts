import { createDifficultyButton, createResetButton, nextDifficulty, previousDifficulty, requestGameReset, type Difficulty } from "../core";
import { playSound } from "../sound";

export type DifficultyControl = {
  get(): Difficulty;
  set(difficulty: Difficulty): void;
  reset(): void;
};

export function createDifficultyControl(actions: HTMLElement, control: DifficultyControl): HTMLButtonElement {
  return createDifficultyButton(actions, () => changeDifficulty(control, "next"));
}

export function changeDifficulty(control: DifficultyControl, direction: "next" | "previous"): void {
  control.set(direction === "next" ? nextDifficulty(control.get()) : previousDifficulty(control.get()));
  playSound("uiToggle");
  control.reset();
}

export function createResetControl(actions: HTMLElement, shell: HTMLElement, resetGame: () => void): () => void {
  const requestReset = (): void => {
    playSound("uiReset");
    requestGameReset(shell, resetGame);
  };
  createResetButton(actions, requestReset);
  return requestReset;
}
