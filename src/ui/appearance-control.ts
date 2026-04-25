import {
  getAppearanceMode,
  getResolvedAppearance,
  setAppearanceMode,
  type AppearanceMode,
} from "@ui/appearance";
import { el, setIconLabel } from "@shared/core";

const appearanceModes = ["system", "light", "dark"] as const satisfies AppearanceMode[];

export function createAppearanceControl(): HTMLButtonElement {
  const control = el("button", {
    className: "appearance-toggle top-bar__action",
    type: "button",
  });
  control.addEventListener("click", () =>
    setAppearanceMode(nextAppearanceMode(getAppearanceMode())),
  );
  updateAppearanceControl(control);
  return control;
}

export function updateAppearanceControl(control: HTMLElement): void {
  const currentMode = getAppearanceMode();
  setIconLabel(
    control,
    iconAppearanceMode(currentMode),
    `Color theme: ${labelAppearanceMode(currentMode)}`,
  );
  control.dataset.mode = currentMode;
  control.dataset.resolved = getResolvedAppearance();
  control.title = `Color theme: ${labelAppearanceMode(currentMode)}. Click for ${labelAppearanceMode(
    nextAppearanceMode(currentMode),
  )}.`;
}

function nextAppearanceMode(mode: AppearanceMode): AppearanceMode {
  const index = appearanceModes.indexOf(mode);
  return appearanceModes[(index + 1) % appearanceModes.length] ?? "system";
}

function labelAppearanceMode(mode: AppearanceMode): string {
  if (mode === "system") return "System";
  if (mode === "light") return "Light";
  return "Dark";
}

function iconAppearanceMode(mode: AppearanceMode): string {
  if (mode === "system") return "🖥";
  if (mode === "light") return "☀";
  return "☾";
}
