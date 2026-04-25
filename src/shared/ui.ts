import { button } from "@shared/dom";
import type { Difficulty } from "@shared/types";

export const uiClass = {
  action: "button interactive",
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

export function setIconLabel(element: HTMLElement, icon: string, label: string): void {
  element.textContent = icon;
  element.setAttribute("aria-label", label);
  element.title = label;
}

export function difficultyIcon(difficulty: Difficulty): string {
  if (difficulty === "Easy") return "▮▯▯";
  if (difficulty === "Medium") return "▮▮▯";
  return "▮▮▮";
}

export function setDifficultyIconLabel(
  element: HTMLElement,
  difficulty: Difficulty | "Online",
): void {
  if (difficulty === "Online") {
    setIconLabel(element, "🌐", "Online");
    return;
  }
  setIconLabel(element, difficultyIcon(difficulty), difficulty);
}
