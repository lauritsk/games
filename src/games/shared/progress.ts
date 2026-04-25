import { confirmChoice } from "@shared/dialog";
import type { MountScope } from "@shared/lifecycle";

const gamePauseRequestEvent = "games:pause-request";
const gameResetRequestEvent = "games:reset-request";

export type GamePauseRequestOptions = {
  canPause(): boolean;
  isPaused?: () => boolean;
  pause(): void;
};

export function isGameInProgress(shell: HTMLElement): boolean {
  return shell.dataset.started === "true" && shell.dataset.finished !== "true";
}

export function resetGameProgress(shell: HTMLElement): void {
  shell.dataset.started = "false";
  shell.dataset.finished = "false";
}

export function markGameStarted(shell: HTMLElement): void {
  shell.dataset.started = "true";
}

export function markGameFinished(shell: HTMLElement): void {
  shell.dataset.finished = "true";
}

export function requestGameReset(shell: HTMLElement, resetGame: () => void): void {
  if (isGameInProgress(shell)) confirmChoice("Start a new game?", resetGame);
  else resetGame();
}

export function emitGameResetRequest(shell: HTMLElement): void {
  shell.dispatchEvent(new Event(gameResetRequestEvent));
}

export function onGameResetRequest(shell: HTMLElement, resetGame: () => void): void {
  shell.addEventListener(gameResetRequestEvent, () => requestGameReset(shell, resetGame));
}

export function requestGamePause(shell: HTMLElement): boolean {
  const event = new Event(gamePauseRequestEvent, { cancelable: true });
  return !shell.dispatchEvent(event);
}

export function pauseGameOnRequest(
  shell: HTMLElement,
  scope: MountScope,
  options: GamePauseRequestOptions,
): void {
  shell.addEventListener(
    gamePauseRequestEvent,
    (event) => {
      if (options.isPaused?.()) {
        event.preventDefault();
        return;
      }
      if (!options.canPause()) return;
      event.preventDefault();
      options.pause();
    },
    { signal: scope.signal },
  );
}
