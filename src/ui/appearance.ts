export type AppearanceMode = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

type AppearanceChangeListener = (mode: AppearanceMode, resolved: ResolvedAppearance) => void;

const storageKey = "games:appearance";
const modes = new Set<AppearanceMode>(["system", "light", "dark"]);
const listeners = new Set<AppearanceChangeListener>();

let mode = readStoredAppearance();

export function getAppearanceMode(): AppearanceMode {
  return mode;
}

export function getResolvedAppearance(): ResolvedAppearance {
  return resolveAppearance(mode, systemPrefersDark());
}

export function setAppearanceMode(nextMode: AppearanceMode): void {
  mode = nextMode;
  if (nextMode === "system") localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, nextMode);
  applyAppearance();
}

export function onAppearanceChange(listener: AppearanceChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initializeAppearance(): void {
  applyAppearance();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyAppearance);
}

export function resolveAppearance(
  appearanceMode: AppearanceMode,
  systemPrefersDark: boolean,
): ResolvedAppearance {
  if (appearanceMode === "system") return systemPrefersDark ? "dark" : "light";
  return appearanceMode;
}

export function parseAppearanceMode(value: string | null): AppearanceMode {
  return value && modes.has(value as AppearanceMode) ? (value as AppearanceMode) : "system";
}

function readStoredAppearance(): AppearanceMode {
  if (typeof localStorage === "undefined") return "system";
  return parseAppearanceMode(localStorage.getItem(storageKey));
}

function systemPrefersDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyAppearance(): void {
  const resolved = getResolvedAppearance();
  document.documentElement.dataset.appearance = resolved;
  document.documentElement.style.colorScheme = resolved;
  listeners.forEach((listener) => listener(mode, resolved));
}
