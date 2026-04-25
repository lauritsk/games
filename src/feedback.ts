import { createDelayedAction } from "./lifecycle";
import { playSound } from "./sound";

export type InvalidMoveFeedback = {
  trigger(): void;
  cleanup(): void;
};

export function createInvalidMoveFeedback(target: HTMLElement): InvalidMoveFeedback {
  const invalidReset = createDelayedAction();

  return {
    trigger() {
      playSound("gameBad");
      delete target.dataset.invalid;
      void target.offsetWidth;
      target.dataset.invalid = "true";
      invalidReset.start(() => {
        delete target.dataset.invalid;
      }, 260);
    },
    cleanup() {
      invalidReset.clear();
      delete target.dataset.invalid;
    },
  };
}
