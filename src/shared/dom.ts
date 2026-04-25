type ElementOptions = {
  className?: string;
  text?: string;
  ariaLabel?: string;
  type?: "button" | "submit" | "reset";
};

const instantButtonActivationMs = 520;

type NativeClickSuppression = {
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

const nativeClickSuppressions = new WeakMap<Document, NativeClickSuppression>();

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
  if (element instanceof HTMLButtonElement) addInstantButtonActivation(element);
  return element;
}

function addInstantButtonActivation(element: HTMLButtonElement): void {
  element.addEventListener("pointerdown", (event) => {
    if (!shouldActivateInstantly(element, event)) return;
    event.preventDefault();
    element.focus({ preventScroll: true });
    element.click();
    suppressNextNativeClick(element.ownerDocument);
  });
}

function suppressNextNativeClick(ownerDocument: Document): void {
  const suppression = nativeClickSuppression(ownerDocument);
  suppression.active = true;
  if (suppression.timer) clearTimeout(suppression.timer);
  suppression.timer = setTimeout(() => {
    suppression.active = false;
    suppression.timer = null;
  }, instantButtonActivationMs);
}

function nativeClickSuppression(ownerDocument: Document): NativeClickSuppression {
  const existing = nativeClickSuppressions.get(ownerDocument);
  if (existing) return existing;
  const suppression: NativeClickSuppression = { active: false, timer: null };
  ownerDocument.addEventListener(
    "click",
    (event) => {
      if (!suppression.active || !event.isTrusted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppression.active = false;
      if (!suppression.timer) return;
      clearTimeout(suppression.timer);
      suppression.timer = null;
    },
    { capture: true },
  );
  nativeClickSuppressions.set(ownerDocument, suppression);
  return suppression;
}

function shouldActivateInstantly(element: HTMLButtonElement, event: PointerEvent): boolean {
  if (element.disabled || element.classList.contains("game-cell")) return false;
  if (!event.isPrimary || event.button !== 0) return false;
  return (
    event.pointerType === "mouse" || event.pointerType === "touch" || event.pointerType === "pen"
  );
}

export function button(text: string, className = "button"): HTMLButtonElement {
  return el("button", { className, text, type: "button" });
}

export function syncChildren<T extends HTMLElement>(
  container: HTMLElement,
  count: number,
  create: (index: number) => T,
): T[] {
  while (container.children.length > count) container.lastElementChild?.remove();
  while (container.children.length < count) container.append(create(container.children.length));
  return Array.from(container.children) as T[];
}
