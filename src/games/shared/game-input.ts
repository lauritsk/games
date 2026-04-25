import { actionButton, setIconLabel } from "@shared/ui";
import { isConfirmOpen } from "@shared/dialog";
import { directionFromKey, Keys, matchesKey } from "@shared/keyboard";
import type { Direction } from "@shared/types";

export type StandardGameKeyHandlers = {
  onDirection?: (direction: Direction, event: KeyboardEvent) => void;
  onActivate?: (event: KeyboardEvent) => void;
  onNextDifficulty?: (event: KeyboardEvent) => void;
  onPreviousDifficulty?: (event: KeyboardEvent) => void;
  onReset?: (event: KeyboardEvent) => void;
};

export type TouchGestureHandlers = {
  onTap?: (event: PointerEvent) => void;
  onSwipe?: (direction: Direction, event: PointerEvent) => void;
  onLongPress?: (event: PointerEvent) => void;
};

export type TouchGestureOptions = {
  signal?: AbortSignal;
  pointerTypes?: readonly string[] | "all";
  swipeThreshold?: number;
  tapMaxDistance?: number;
  longPressMs?: number;
  touchAction?: string;
  suppressClick?: boolean;
};

type ActiveTouchGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  longPressed: boolean;
  startEvent: PointerEvent;
};

export function handleStandardGameKey(
  event: KeyboardEvent,
  handlers: StandardGameKeyHandlers,
): boolean {
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

export function directionFromSwipeDelta(
  deltaX: number,
  deltaY: number,
  threshold = 28,
): Direction | null {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) return null;
  if (Math.abs(deltaX) > Math.abs(deltaY)) return deltaX > 0 ? "right" : "left";
  return deltaY > 0 ? "down" : "up";
}

export function addTouchGestureControls(
  target: HTMLElement,
  handlers: TouchGestureHandlers,
  options: TouchGestureOptions = {},
): void {
  const swipeThreshold = options.swipeThreshold ?? 28;
  const tapMaxDistance = options.tapMaxDistance ?? 12;
  const longPressMs = options.longPressMs ?? 480;
  const allowedPointerTypes = options.pointerTypes ?? ["touch", "pen"];
  const previousTouchAction = target.style.touchAction;
  let active: ActiveTouchGesture | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  if (options.touchAction !== undefined) target.style.touchAction = options.touchAction;
  target.addEventListener("pointerdown", onPointerDown, { signal: options.signal });
  target.addEventListener("pointermove", onPointerMove, { signal: options.signal });
  target.addEventListener("pointerup", onPointerUp, { signal: options.signal });
  target.addEventListener("pointercancel", cancelActiveGesture, { signal: options.signal });
  options.signal?.addEventListener(
    "abort",
    () => {
      clearLongPressTimer();
      if (options.touchAction !== undefined) target.style.touchAction = previousTouchAction;
    },
    { once: true },
  );

  function onPointerDown(event: PointerEvent): void {
    if (!isAllowedPointer(event) || !event.isPrimary || event.button !== 0) return;
    active = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      longPressed: false,
      startEvent: event,
    };
    if (!handlers.onLongPress) return;
    clearLongPressTimer();
    longPressTimer = setTimeout(() => {
      if (!active) return;
      active.longPressed = true;
      suppressNextClickLikeEvents();
      handlers.onLongPress?.(active.startEvent);
    }, longPressMs);
  }

  function onPointerMove(event: PointerEvent): void {
    const gesture = activeGestureFor(event);
    if (!gesture) return;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    if (travelDistance(gesture) > tapMaxDistance) clearLongPressTimer();
  }

  function onPointerUp(event: PointerEvent): void {
    const gesture = activeGestureFor(event);
    if (!gesture) return;
    clearLongPressTimer();
    active = null;
    if (gesture.longPressed) {
      event.preventDefault();
      suppressNextClickLikeEvents();
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const direction = directionFromSwipeDelta(deltaX, deltaY, swipeThreshold);
    if (direction && handlers.onSwipe) {
      event.preventDefault();
      suppressNextClickLikeEvents();
      handlers.onSwipe(direction, event);
      return;
    }
    if (
      travelDistance({ ...gesture, lastX: event.clientX, lastY: event.clientY }) <= tapMaxDistance
    ) {
      if (!handlers.onTap) return;
      event.preventDefault();
      suppressNextClickLikeEvents();
      handlers.onTap(event);
    }
  }

  function cancelActiveGesture(event?: PointerEvent): void {
    if (event && !activeGestureFor(event)) return;
    clearLongPressTimer();
    active = null;
  }

  function clearLongPressTimer(): void {
    if (!longPressTimer) return;
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function isAllowedPointer(event: PointerEvent): boolean {
    return allowedPointerTypes === "all" || allowedPointerTypes.includes(event.pointerType);
  }

  function activeGestureFor(event: PointerEvent): ActiveTouchGesture | null {
    return active && event.pointerId === active.pointerId ? active : null;
  }

  function travelDistance(gesture: ActiveTouchGesture): number {
    return Math.hypot(gesture.lastX - gesture.startX, gesture.lastY - gesture.startY);
  }

  function suppressNextClickLikeEvents(): void {
    if (options.suppressClick === false) return;
    let cleared = false;
    const clear = (): void => {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
      target.removeEventListener("click", block, true);
      target.removeEventListener("contextmenu", block, true);
    };
    const block = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      clear();
    };
    const timer = setTimeout(clear, 520);
    target.addEventListener("click", block, true);
    target.addEventListener("contextmenu", block, true);
  }
}

export function createDifficultyButton(
  actions: HTMLElement,
  onClick: () => void,
): HTMLButtonElement {
  const difficultyButton = actionButton("");
  difficultyButton.dataset.action = "difficulty";
  difficultyButton.addEventListener("click", onClick);
  actions.append(difficultyButton);
  return difficultyButton;
}

export function createResetButton(actions: HTMLElement, onClick: () => void): HTMLButtonElement {
  const resetButton = actionButton("");
  resetButton.dataset.action = "reset";
  setIconLabel(resetButton, "✚", "New");
  resetButton.addEventListener("click", onClick);
  actions.append(resetButton);
  return resetButton;
}
