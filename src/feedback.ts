import { playSound } from "./sound";

export type InvalidMoveFeedback = {
  trigger(): void;
  cleanup(): void;
};

export function createInvalidMoveFeedback(target: HTMLElement): InvalidMoveFeedback {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    trigger() {
      playSound("gameBad");
      delete target.dataset.invalid;
      void target.offsetWidth;
      target.dataset.invalid = "true";
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        delete target.dataset.invalid;
        timer = null;
      }, 260);
    },
    cleanup() {
      if (timer) clearTimeout(timer);
      timer = null;
      delete target.dataset.invalid;
    },
  };
}
