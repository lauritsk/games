export type MountScope = {
  readonly signal: AbortSignal;
  cleanup(): void;
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
