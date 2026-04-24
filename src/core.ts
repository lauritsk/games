export type GameTheme = "deep-cave" | "deep-ocean" | "outer-space" | "deep-forest";

export type GameDefinition = {
  id: string;
  name: string;
  tagline: string;
  players: string;
  theme: GameTheme;
  mount(target: HTMLElement): () => void;
};

type ElementOptions = {
  className?: string;
  text?: string;
  ariaLabel?: string;
  type?: "button" | "submit" | "reset";
};

export type GameShellOptions = {
  gameClass: string;
  boardClass: string;
  boardLabel: string;
  statusLabel?: string;
};

export type GameShell = {
  shell: HTMLElement;
  top: HTMLDivElement;
  actions: HTMLDivElement;
  status: HTMLParagraphElement;
  board: HTMLDivElement;
  remove(): void;
};

export function clearNode(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.ariaLabel) element.setAttribute("aria-label", options.ariaLabel);
  if (options.type && element instanceof HTMLButtonElement) element.type = options.type;
  return element;
}

export function button(text: string, className = "button"): HTMLButtonElement {
  return el("button", { className, text, type: "button" });
}

export function confirmChoice(message: string, onYes: () => void, onClose?: () => void): () => void {
  if (document.querySelector(".confirm")) return () => undefined;

  let selected = 1;
  const dialog = el("div", { className: "confirm", ariaLabel: message });
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const panel = el("div", { className: "confirm__panel surface" });
  const text = el("p", { text: message });
  const actions = el("div", { className: "confirm__actions cluster" });
  const yes = button("Yes", "pill surface interactive");
  const no = button("No", "pill surface interactive");
  actions.append(yes, no);
  panel.append(text, actions);
  dialog.append(panel);
  document.body.append(dialog);

  yes.addEventListener("click", yesAction);
  no.addEventListener("click", close);
  document.addEventListener("keydown", onKeyDown);
  render();

  function onKeyDown(event: KeyboardEvent): void {
    event.stopImmediatePropagation();
    const key = event.key.toLowerCase();
    if (["arrowleft", "arrowup", "h", "k"].includes(key)) {
      event.preventDefault();
      selected = 0;
      render();
    } else if (["arrowright", "arrowdown", "l", "j"].includes(key)) {
      event.preventDefault();
      selected = 1;
      render();
    } else if (key === "y") {
      event.preventDefault();
      yesAction();
    } else if (key === "n" || key === "escape") {
      event.preventDefault();
      close();
    } else if (key === "enter" || key === " ") {
      event.preventDefault();
      selected === 0 ? yesAction() : close();
    }
  }

  function render(): void {
    yes.dataset.selected = String(selected === 0);
    no.dataset.selected = String(selected === 1);
  }

  function yesAction(): void {
    close();
    onYes();
  }

  function close(): void {
    document.removeEventListener("keydown", onKeyDown);
    dialog.remove();
    onClose?.();
  }

  return close;
}

export function createGameShell(target: HTMLElement, options: GameShellOptions): GameShell {
  const shell = el("section", { className: `game ${options.gameClass}` });
  shell.dataset.started = "false";
  shell.dataset.finished = "false";
  const top = el("div", { className: "game__top cluster" });
  const status = el("p", {
    className: "status pill surface",
    ariaLabel: options.statusLabel ?? "Game status",
  });
  const actions = el("div", { className: "game__actions cluster" });
  const board = el("div", { className: `board ${options.boardClass}`, ariaLabel: options.boardLabel });
  board.setAttribute("role", "grid");

  top.append(status, actions);
  shell.append(top, board);
  target.append(shell);

  return {
    shell,
    top,
    actions,
    status,
    board,
    remove: () => shell.remove(),
  };
}
