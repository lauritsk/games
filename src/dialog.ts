import { el } from "./dom";
import { Keys, matchesKey } from "./keyboard";
import { isModalOpen, openModal } from "./modal";
import { playSound } from "./sound";
import { pillButton, setSelected } from "./ui";

export function isConfirmOpen(): boolean {
  return isModalOpen();
}

export function confirmChoice(
  message: string,
  onYes: () => void,
  onClose?: () => void,
): () => void {
  if (isModalOpen()) return () => undefined;

  let selected = 1;
  const text = el("p", { text: message });
  const actions = el("div", { className: "confirm__actions modal__actions cluster" });
  const yes = pillButton("Yes");
  const no = pillButton("No");
  actions.append(yes, no);

  const modal = openModal({
    label: message,
    size: "sm",
    className: "confirm",
    panelClassName: "confirm__panel",
    dismissible: true,
    initialFocus: () => (selected === 0 ? yes : no),
    onClose,
    children: [text, actions],
  });

  yes.addEventListener("click", yesAction);
  no.addEventListener("click", close);
  yes.addEventListener("pointerenter", () => select(0));
  no.addEventListener("pointerenter", () => select(1));
  modal.dialog.addEventListener("keydown", onKeyDown);
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
      if (selected === 0) yesAction();
      else close();
    }
  }

  function select(next: number): void {
    if (selected === next) return;
    selected = next;
    playSound("dashboardMove");
    render();
  }

  function render(): void {
    setSelected(yes, selected === 0);
    setSelected(no, selected === 1);
    (selected === 0 ? yes : no).focus();
  }

  function yesAction(): void {
    close();
    onYes();
  }

  function close(): void {
    modal.close();
  }

  return close;
}
