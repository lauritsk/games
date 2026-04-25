export type MountScope = {
  readonly signal: AbortSignal;
  cleanup(): void;
};

export type DelayedAction = {
  readonly pending: boolean;
  start(callback: () => void, delayMs: number): void;
  clear(): void;
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
