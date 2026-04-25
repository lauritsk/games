import { button, el, type GameDefinition } from "./core";
import { bestSummaryText, formatDate, formatOutcome, resultDetails } from "./game-result-format";
import { clearGameResults, listGameResults, type GameResult } from "./game-results";
import { playSound } from "./sound";

export type GameHistoryDialog = {
  show(game: GameDefinition, highlight?: GameResult): void;
  close(): void;
};

export function createGameHistoryDialog(): GameHistoryDialog {
  let cleanup: (() => void) | null = null;

  function close(): void {
    cleanup?.();
  }

  function show(game: GameDefinition, highlight?: GameResult): void {
    close();
    let clearArmed = false;
    const results = listGameResults(game.id);
    const dialog = el("dialog", {
      className: "history-dialog",
      ariaLabel: `${game.name} result history`,
    });
    const panel = el("div", { className: "history-dialog__panel surface theme-" + game.theme });
    panel.tabIndex = -1;
    const title = el("h2", {
      className: "history-dialog__title",
      text: highlight ? "Result saved" : `${game.name} history`,
    });
    const details = el("div", { className: "history-dialog__details" });
    const historyScroll = el("div", { className: "history-dialog__scroll" });
    const actions = el("div", { className: "history-dialog__actions cluster" });
    const clear = button("Clear", "pill surface interactive");
    const closeButton = button("Close", "pill surface interactive");
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (highlight) details.append(resultSummary(highlight));
    const best = bestSummaryText(game.id);
    if (best) details.append(el("p", { className: "history-dialog__best", text: best }));
    historyScroll.append(resultList(results));
    clear.disabled = results.length === 0;
    clear.addEventListener("click", () => {
      if (!clearArmed) {
        clearArmed = true;
        clear.textContent = "Confirm clear";
        clear.dataset.danger = "true";
        return;
      }
      clearGameResults(game.id);
      playSound("uiToggle");
      closeDialog();
    });
    closeButton.addEventListener("click", closeDialog);
    document.addEventListener("keydown", onModalDocumentKeyDown, { capture: true });
    dialog.addEventListener("click", onModalBackdropClick);
    dialog.addEventListener("keydown", onModalKeyDown);
    dialog.addEventListener("cancel", (dialogEvent) => {
      dialogEvent.preventDefault();
      closeDialog();
    });
    actions.append(clear, closeButton);
    panel.append(title, details, historyScroll, actions);
    dialog.append(panel);
    document.body.append(dialog);
    cleanup = closeDialog;
    dialog.setAttribute("aria-modal", "true");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    focusHistoryTop();
    requestAnimationFrame(focusHistoryTop);

    function onModalDocumentKeyDown(event: KeyboardEvent): void {
      const key = event.key.toLowerCase();
      if (key !== "escape" && key !== "n") return;
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
    }

    function onModalBackdropClick(event: MouseEvent): void {
      if (event.target === dialog) closeDialog();
    }

    function onModalKeyDown(event: KeyboardEvent): void {
      event.stopPropagation();
    }

    function focusHistoryTop(): void {
      if (!dialog.isConnected) return;
      panel.scrollTop = 0;
      historyScroll.scrollTop = 0;
      panel.focus({ preventScroll: true });
    }

    function closeDialog(): void {
      if (cleanup !== closeDialog) return;
      cleanup = null;
      document.removeEventListener("keydown", onModalDocumentKeyDown, { capture: true });
      if (dialog.open) dialog.close();
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
  }

  return { show, close };
}

function resultSummary(result: GameResult): HTMLElement {
  const summary = el("div", { className: "history-dialog__summary" });
  summary.append(
    el("strong", { text: formatOutcome(result.outcome) }),
    el("span", { text: resultDetails(result).join(" · ") || "Result recorded" }),
  );
  return summary;
}

function resultList(results: GameResult[]): HTMLElement {
  if (results.length === 0) return el("p", { className: "muted", text: "No results yet." });
  const list = el("ol", { className: "history-list" });
  results.slice(0, 10).forEach((result) => {
    const item = el("li", { className: "history-list__item" });
    item.append(
      el("span", { className: "history-list__main", text: formatOutcome(result.outcome) }),
      el("span", { className: "history-list__detail", text: resultDetails(result).join(" · ") }),
      el("time", { className: "history-list__time", text: formatDate(result.finishedAt) }),
    );
    list.append(item);
  });
  return list;
}
