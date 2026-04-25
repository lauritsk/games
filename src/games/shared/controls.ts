import {
  actionButton,
  createDifficultyButton,
  createResetButton,
  nextDifficulty,
  previousDifficulty,
  requestGameReset,
  type Difficulty,
} from "@shared/core";
import { playSound } from "@ui/sound";

export type DifficultyControl = {
  get(): Difficulty;
  set(difficulty: Difficulty): void;
  reset(): void;
};

export type BotPlayMode = "bot" | "local";

export function nextBotPlayMode(mode: BotPlayMode): BotPlayMode {
  return mode === "bot" ? "local" : "bot";
}

export function botPlayModeLabel(mode: BotPlayMode): string {
  return mode === "bot" ? "Vs bot" : "2 players";
}

export type ToggleControl<TValue extends string> = {
  get(): TValue;
  set(value: TValue): void;
  next(value: TValue): TValue;
  label(value: TValue): string;
  reset(): void;
};

export function createDifficultyControl(
  actions: HTMLElement,
  control: DifficultyControl,
): HTMLButtonElement {
  return createDifficultyButton(actions, () => changeDifficulty(control, "next"));
}

export function changeDifficulty(control: DifficultyControl, direction: "next" | "previous"): void {
  control.set(
    direction === "next" ? nextDifficulty(control.get()) : previousDifficulty(control.get()),
  );
  playSound("uiToggle");
  control.reset();
}

export function createModeControl<TValue extends string>(
  actions: HTMLElement,
  control: ToggleControl<TValue>,
): HTMLButtonElement {
  const modeButton = actionButton(control.label(control.get()));
  modeButton.addEventListener("click", () => toggleMode(control));
  actions.append(modeButton);
  return modeButton;
}

export function toggleMode<TValue extends string>(control: ToggleControl<TValue>): void {
  control.set(control.next(control.get()));
  playSound("uiToggle");
  control.reset();
}

export function createResetControl(
  actions: HTMLElement,
  shell: HTMLElement,
  resetGame: () => void,
): () => void {
  const requestReset = (): void => {
    playSound("uiReset");
    requestGameReset(shell, resetGame);
  };
  createResetButton(actions, requestReset);
  return requestReset;
}
