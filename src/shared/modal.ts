import { el } from "@shared/dom";
import type { GameTheme } from "@shared/types";

export type ModalSize = "sm" | "md" | "lg";

export type ModalOptions = {
  label: string;
  size?: ModalSize;
  theme?: GameTheme;
  className?: string;
  panelClassName?: string;
  dismissible?: boolean;
  initialFocus?: HTMLElement | (() => HTMLElement | null);
  onClose?: () => void;
  children?: Node[];
};

export type ModalController = {
  dialog: HTMLDialogElement;
  panel: HTMLDivElement;
  close(): void;
};

export type SingletonModalHandle = {
  readonly isCurrent: boolean;
  release(): void;
};

export type SingletonModalLifecycle = {
  close(): void;
  track(closeCurrent: () => void): SingletonModalHandle;
};

export function createSingletonModalLifecycle(): SingletonModalLifecycle {
  let closeCurrent: (() => void) | null = null;

  return {
    close() {
      closeCurrent?.();
    },
    track(nextClose) {
      closeCurrent = nextClose;
      return {
        get isCurrent() {
          return closeCurrent === nextClose;
        },
        release() {
          if (closeCurrent === nextClose) closeCurrent = null;
        },
      };
    },
  };
}

export function isModalOpen(): boolean {
  return Boolean(document.querySelector('[data-modal="true"]'));
}

export function openModal(options: ModalOptions): ModalController {
  const size = options.size ?? "md";
  const dismissible = options.dismissible ?? true;
  const dialog = el("dialog", {
    className: classNames("modal", `modal--${size}`, options.className),
    ariaLabel: options.label,
  });
  dialog.dataset.modal = "true";
  dialog.setAttribute("aria-modal", "true");

  const panel = el("div", {
    className: classNames(
      "modal__panel popup-panel surface",
      options.theme ? `theme-${options.theme}` : undefined,
      options.panelClassName,
    ),
  });
  panel.tabIndex = -1;
  panel.append(...(options.children ?? []));
  dialog.append(panel);

  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;

  dialog.addEventListener("click", onBackdropClick);
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  dialog.addEventListener("cancel", onCancel);
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  focusInitial();
  requestAnimationFrame(focusInitial);

  function onBackdropClick(event: MouseEvent): void {
    if (dismissible && event.target === dialog) close();
  }

  function onCancel(event: Event): void {
    event.preventDefault();
    if (dismissible) close();
  }

  function focusInitial(): void {
    if (!dialog.isConnected) return;
    const target = resolveInitialFocus(options.initialFocus) ?? panel;
    target.focus({ preventScroll: true });
  }

  function close(): void {
    if (closed) return;
    closed = true;
    dialog.removeEventListener("click", onBackdropClick);
    dialog.removeEventListener("cancel", onCancel);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    options.onClose?.();
  }

  return { dialog, panel, close };
}

function resolveInitialFocus(
  initialFocus: HTMLElement | (() => HTMLElement | null) | undefined,
): HTMLElement | null {
  if (!initialFocus) return null;
  return typeof initialFocus === "function" ? initialFocus() : initialFocus;
}

function classNames(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
