import { button, el } from "./dom";
import { Keys, matchesKey } from "./keyboard";

export function isConfirmOpen(): boolean {
  return Boolean(document.querySelector(".confirm"));
}

export function confirmChoice(message: string, onYes: () => void, onClose?: () => void): () => void {
  if (isConfirmOpen()) return () => undefined;

  let selected = 1;
  const dialog = el("dialog", { className: "confirm", ariaLabel: message });
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

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  yes.addEventListener("click", yesAction);
  no.addEventListener("click", close);
  yes.addEventListener("pointerenter", () => select(0));
  no.addEventListener("pointerenter", () => select(1));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  document.addEventListener("keydown", onKeyDown);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  render();

  function onKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === "tab") {
      event.preventDefault();
      select(selected === 0 ? 1 : 0);
    } else if (matchesKey(event, Keys.previous)) {
      event.preventDefault();
      select(0);
    } else if (matchesKey(event, Keys.next)) {
      event.preventDefault();
      select(1);
    } else if (key === "y") {
      event.preventDefault();
      yesAction();
    } else if (key === "n" || key === "escape") {
      event.preventDefault();
      close();
    } else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      selected === 0 ? yesAction() : close();
    }
  }

  function select(next: number): void {
    if (selected === next) return;
    selected = next;
    render();
  }

  function render(): void {
    yes.dataset.selected = String(selected === 0);
    no.dataset.selected = String(selected === 1);
    (selected === 0 ? yes : no).focus();
  }

  function yesAction(): void {
    close();
    onYes();
  }

  function close(): void {
    document.removeEventListener("keydown", onKeyDown);
    if (dialog.open) dialog.close();
    dialog.remove();
    previousFocus?.focus();
    onClose?.();
  }

  return close;
}
