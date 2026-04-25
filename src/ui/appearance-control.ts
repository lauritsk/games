import {
  getAppearanceMode,
  getResolvedAppearance,
  setAppearanceMode,
  type AppearanceMode,
} from "@ui/appearance";
import { el, setIconLabel, setSelected } from "@shared/core";

const appearanceModes = ["system", "light", "dark"] as const satisfies AppearanceMode[];

export function createAppearanceControl(): HTMLElement {
  const control = el("div", { className: "appearance-toggle surface", ariaLabel: "Color theme" });
  control.setAttribute("role", "radiogroup");
  for (const mode of appearanceModes) {
    const option = el("button", {
      className: "appearance-toggle__option interactive",
      type: "button",
    });
    option.dataset.mode = mode;
    option.setAttribute("role", "radio");
    setIconLabel(option, iconAppearanceMode(mode), labelAppearanceMode(mode));
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

function iconAppearanceMode(mode: AppearanceMode): string {
  if (mode === "system") return "⚙";
  if (mode === "light") return "☀";
  return "☾";
}
