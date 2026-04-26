import * as v from "valibot";
import {
  actionButton,
  button,
  directionFromKey,
  setIconLabel,
  el,
  syncChildren,
  finiteNumberSchema,
  parseWithSchema,
  uiClass,
  type Direction,
  type MountScope,
} from "@shared/core";

export type FixedStepLoop = {
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  stop(): void;
  readonly running: boolean;
};

export function startFixedStepLoop(
  update: () => void,
  render: () => void,
  fps: number,
): FixedStepLoop {
  let timer: ReturnType<typeof setInterval> | null = null;
  const delay = Math.max(1, Math.round(1000 / fps));

  const loop = {
    start(): void {
      if (timer) return;
      timer = setInterval(() => {
        update();
        render();
      }, delay);
    },
    pause(): void {
      loop.stop();
    },
    resume(): void {
      loop.start();
    },
    reset(): void {
      loop.stop();
    },
    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    get running(): boolean {
      return timer !== null;
    },
  };

  loop.start();
  return loop;
}

export type Rect = { x: number; y: number; width: number; height: number };
export type Circle = { x: number; y: number; radius: number };
export type Vector = { x: number; y: number };

const rectSchema = v.object({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: finiteNumberSchema,
  height: finiteNumberSchema,
});

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function wrap(value: number, min: number, max: number): number {
  const size = max - min;
  if (size <= 0) return min;
  const wrapped = ((((value - min) % size) + size) % size) + min;
  return wrapped < min || wrapped >= max ? min : wrapped;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function parseRect(value: unknown): Rect | null {
  return parseWithSchema(rectSchema, value);
}

export function circleIntersectsRect(circle: Circle, rect: Rect): boolean {
  const closestX = clamp(circle.x, rect.x, rect.x + rect.width);
  const closestY = clamp(circle.y, rect.y, rect.y + rect.height);
  return (circle.x - closestX) ** 2 + (circle.y - closestY) ** 2 <= circle.radius ** 2;
}

export function vectorAdd(a: Vector, b: Vector): Vector {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vectorScale(vector: Vector, scale: number): Vector {
  return { x: vector.x * scale, y: vector.y * scale };
}

export function positionPercent(element: HTMLElement, rect: Rect): void {
  element.style.left = `${rect.x}%`;
  element.style.top = `${rect.y}%`;
  element.style.width = `${rect.width}%`;
  element.style.height = `${rect.height}%`;
}

export function circlePercentRect(circle: Circle, aspectRatio = 1): Rect {
  const diameter = circle.radius * 2;
  const height = diameter * aspectRatio;
  return {
    x: circle.x - circle.radius,
    y: circle.y - height / 2,
    width: diameter,
    height,
  };
}

export function positionCirclePercent(element: HTMLElement, circle: Circle): void {
  positionPercent(element, circlePercentRect(circle, parentAspectRatio(element)));
}

function parentAspectRatio(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  const rect = parent.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 1;
  return rect.width / rect.height;
}

export function syncPositionedChildren(
  container: HTMLElement,
  count: number,
  className: string,
  apply: (child: HTMLElement, index: number) => void,
): HTMLElement[] {
  const children = syncChildren(container, count, () => el("div", { className }));
  children.forEach(apply);
  return children;
}

export function startArcadeMode<TMode extends string>(
  mode: TMode,
  options: {
    blocked: readonly TMode[];
    ready: TMode;
    playing: TMode;
    paused?: TMode;
    onBlocked(): void;
    onFirstStart(): void;
  },
): TMode | null {
  if (options.blocked.includes(mode)) {
    options.onBlocked();
    return null;
  }
  if (mode === options.ready) options.onFirstStart();
  if (mode === options.playing || mode === options.ready || mode === options.paused)
    return options.playing;
  return mode;
}

export function arcadePauseTransition<TMode extends string>(
  mode: TMode,
  blocked: readonly TMode[],
  playing: TMode,
): "pause" | "resume" | null {
  if (blocked.includes(mode)) return null;
  return mode === playing ? "pause" : "resume";
}

export type ArcadeModeController = {
  start(): void;
  togglePause(): void;
};

export type ArcadeModeControllerOptions<TMode extends string> = {
  getMode(): TMode;
  setMode(mode: TMode): void;
  blockedStart: readonly TMode[];
  blockedPause: readonly TMode[];
  ready: TMode;
  playing: TMode;
  paused: TMode;
  onBlockedStart(): void;
  onFirstStart(): void;
  onPlaying(): void;
  onPause(): void;
  afterChange(): void;
};

export function createArcadeModeController<TMode extends string>(
  options: ArcadeModeControllerOptions<TMode>,
): ArcadeModeController {
  function start(): void {
    const nextMode = startArcadeMode(options.getMode(), {
      blocked: options.blockedStart,
      ready: options.ready,
      playing: options.playing,
      paused: options.paused,
      onBlocked: options.onBlockedStart,
      onFirstStart: options.onFirstStart,
    });
    if (!nextMode) return;
    options.setMode(nextMode);
    if (nextMode === options.playing) options.onPlaying();
    options.afterChange();
  }

  function togglePause(): void {
    const transition = arcadePauseTransition(
      options.getMode(),
      options.blockedPause,
      options.playing,
    );
    if (!transition) return;
    if (transition === "pause") {
      options.setMode(options.paused);
      options.onPause();
      options.afterChange();
      return;
    }
    start();
  }

  return { start, togglePause };
}

export type HeldKeyInput = {
  isHeld(direction: "left" | "right" | "up" | "down"): boolean;
  horizontal(): -1 | 0 | 1;
  vertical(): -1 | 0 | 1;
  clear(): void;
  destroy(): void;
};

export function createHeldKeyInput(
  scope: MountScope,
  onPress?: (direction: Direction, event: KeyboardEvent) => void,
): HeldKeyInput {
  const held = new Set<Direction>();
  document.addEventListener("keydown", onKeyDown, { signal: scope.signal });
  document.addEventListener("keyup", onKeyUp, { signal: scope.signal });
  window.addEventListener("blur", clear, { signal: scope.signal });

  function onKeyDown(event: KeyboardEvent): void {
    const direction = keyDirection(event);
    if (!direction) return;
    event.preventDefault();
    held.add(direction);
    onPress?.(direction, event);
  }

  function onKeyUp(event: KeyboardEvent): void {
    const direction = keyDirection(event);
    if (direction) held.delete(direction);
  }

  function clear(): void {
    held.clear();
  }

  return {
    isHeld: (direction) => held.has(direction),
    horizontal: () => (held.has("left") === held.has("right") ? 0 : held.has("left") ? -1 : 1),
    vertical: () => (held.has("up") === held.has("down") ? 0 : held.has("up") ? -1 : 1),
    clear,
    destroy: clear,
  };
}

export function keyDirection(event: KeyboardEvent): Direction | null {
  return directionFromKey(event);
}

export type BoardOverlay = {
  element: HTMLButtonElement;
  setVisible(visible: boolean, title?: string, helper?: string): void;
};

export type BoardOverlayOptions = {
  title: string;
  helper?: string;
  className?: string;
  onClick?: () => void;
};

export type PauseOverlay = BoardOverlay;

export function createBoardOverlay(
  target: HTMLElement,
  options: BoardOverlayOptions,
): BoardOverlay {
  const panel = el("span", { className: "board-overlay__panel popup-panel surface" });
  const title = el("span", { className: "board-overlay__title popup-title", text: options.title });
  const helper = el("span", {
    className: "board-overlay__helper popup-copy",
    text: options.helper ?? "",
  });
  panel.append(title, helper);

  const element = button("", ["board-overlay", options.className].filter(Boolean).join(" "));
  element.hidden = true;
  element.append(panel);
  if (options.onClick) element.addEventListener("click", options.onClick);
  target.append(element);
  return {
    element,
    setVisible(visible, nextTitle = options.title, nextHelper = options.helper ?? ""): void {
      element.hidden = !visible;
      title.textContent = nextTitle;
      helper.textContent = nextHelper;
      helper.hidden = nextHelper.length === 0;
    },
  };
}

export function createPauseOverlay(board: HTMLElement, onResume: () => void): PauseOverlay {
  return createBoardOverlay(board, {
    title: "Paused",
    helper: "Click here or press P to resume",
    onClick: onResume,
  });
}

export function createPauseButton(actions: HTMLElement, onToggle: () => void): HTMLButtonElement {
  const pauseButton = actionButton("");
  pauseButton.dataset.action = "pause";
  setIconLabel(pauseButton, "⏸", "Pause");
  pauseButton.addEventListener("click", onToggle);
  actions.append(pauseButton);
  return pauseButton;
}

export function createTouchControls(
  target: HTMLElement,
  handlers: Partial<Record<Direction | "fire", () => void>>,
): HTMLElement {
  const controls = el("div", { className: "touch-controls" });
  const entries: Array<[Direction | "fire", string]> = [
    ["left", "◀"],
    ["up", "▲"],
    ["fire", "●"],
    ["right", "▶"],
    ["down", "▼"],
  ];
  for (const [action, label] of entries) {
    if (!handlers[action]) continue;
    const control = button(label, uiClass.touchAction);
    control.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handlers[action]?.();
    });
    controls.append(control);
  }
  target.append(controls);
  return controls;
}
