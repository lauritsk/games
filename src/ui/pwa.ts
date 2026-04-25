import { pwaFeaturesEnabled } from "@shared/bundle-flags";

export function initializePwa(): void {
  if (!pwaFeaturesEnabled() || !("serviceWorker" in navigator) || !shouldRegisterServiceWorker())
    return;
  window.addEventListener("load", () => {
    void registerServiceWorker();
  });
}

function shouldRegisterServiceWorker(): boolean {
  return window.location.protocol === "https:";
}

async function registerServiceWorker(): Promise<void> {
  try {
    await navigator.serviceWorker.register(new URL("./service-worker.js", import.meta.url), {
      scope: "./",
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}
