import { button } from "./dom";

export const uiClass = {
  action: "button pill surface interactive",
  pill: "pill surface interactive",
  touchAction: "touch-control pill surface interactive",
} as const;

export function actionButton(text: string): HTMLButtonElement {
  return button(text, uiClass.action);
}

export function pillButton(text: string): HTMLButtonElement {
  return button(text, uiClass.pill);
}

export function setSelected(element: HTMLElement, selected: boolean): void {
  element.dataset.selected = String(selected);
}
