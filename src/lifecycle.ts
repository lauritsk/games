export type MountScope = {
  readonly signal: AbortSignal;
  cleanup(): void;
};

export type DelayedAction = {
  readonly pending: boolean;
  start(callback: () => void, delayMs: number): void;
  clear(): void;
};

export type FocusLossPauseOptions = {
  isActive(): boolean;
  pause(): void;
};

export function createMountScope(): MountScope {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    cleanup: () => controller.abort(),
  };
}

export function onDocumentKeyDown(
  handler: (event: KeyboardEvent) => void,
  scope: MountScope,
): void {
  document.addEventListener("keydown", handler, { signal: scope.signal });
}

export function pauseOnFocusLoss(scope: MountScope, options: FocusLossPauseOptions): void {
  const pauseIfActive = (): void => {
    if (options.isActive()) options.pause();
  };
  window.addEventListener("blur", pauseIfActive, { signal: scope.signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) pauseIfActive();
    },
    { signal: scope.signal },
  );
}

export function createDelayedAction(): DelayedAction {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    start(callback, delayMs): void {
      clear();
      timer = setTimeout(() => {
        timer = null;
        callback();
      }, delayMs);
    },
    clear,
    get pending(): boolean {
      return timer !== null;
    },
  };
}
