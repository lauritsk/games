import {
  getAppearanceMode,
  getResolvedAppearance,
  setAppearanceMode,
  type AppearanceMode,
} from "./appearance";
import { el, setSelected } from "./core";

const appearanceModes = ["system", "light", "dark"] as const satisfies AppearanceMode[];

export function createAppearanceControl(): HTMLElement {
  const control = el("div", { className: "appearance-toggle surface", ariaLabel: "Color theme" });
  control.setAttribute("role", "radiogroup");
  for (const mode of appearanceModes) {
    const option = el("button", {
      className: "appearance-toggle__option interactive",
      text: labelAppearanceMode(mode),
      type: "button",
    });
    option.dataset.mode = mode;
    option.setAttribute("role", "radio");
    option.addEventListener("click", () => setAppearanceMode(mode));
    control.append(option);
  }
  updateAppearanceControl(control);
  return control;
}

export function updateAppearanceControl(control: HTMLElement): void {
  const currentMode = getAppearanceMode();
  control.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((option) => {
    const selected = option.dataset.mode === currentMode;
    setSelected(option, selected);
    option.setAttribute("aria-checked", String(selected));
    option.title = currentMode === "system" ? `System: ${getResolvedAppearance()}` : "";
  });
}

function labelAppearanceMode(mode: AppearanceMode): string {
  if (mode === "system") return "System";
  if (mode === "light") return "Light";
  return "Dark";
}
