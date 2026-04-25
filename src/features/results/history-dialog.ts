import { el, pillButton, type GameDefinition } from "@shared/core";
import {
  bestSummaryText,
  formatDate,
  formatOutcome,
  resultDetails,
} from "@features/results/game-result-format";
import { clearGameResults, listGameResults, type GameResult } from "@features/results/game-results";
import { openModal, type ModalController } from "@shared/modal";
import { playSound } from "@ui/sound";

export type GameHistoryDialog = {
  show(game: GameDefinition, highlight?: GameResult): void;
  close(): void;
};

export type GameHistoryDialogOptions = {
  resultActions?: (
    game: GameDefinition,
    result: GameResult,
    closeCurrent: () => void,
  ) => HTMLElement[];
  onNewGameShortcut?: (game: GameDefinition, result: GameResult, closeCurrent: () => void) => void;
};

export function createGameHistoryDialog(options: GameHistoryDialogOptions = {}): GameHistoryDialog {
  let cleanup: (() => void) | null = null;

  function close(): void {
    cleanup?.();
  }

  function show(game: GameDefinition, highlight?: GameResult): void {
    close();
    let clearArmed = false;
    let modal: ModalController | null = null;
    const results = listGameResults(game.id);
    const title = el("h2", {
      className: "history-dialog__title popup-title",
      text: highlight ? "Result saved" : `${game.name} history`,
    });
    const details = el("div", { className: "history-dialog__details" });
    const historyScroll = el("div", { className: "history-dialog__scroll" });
    const actions = el("div", { className: "history-dialog__actions modal__actions cluster" });
    const clear = pillButton("Clear");
    const closeButton = pillButton("Close");

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
    if (highlight) actions.append(...(options.resultActions?.(game, highlight, closeDialog) ?? []));
    actions.append(clear, closeButton);

    modal = openModal({
      label: `${game.name} result history`,
      size: "md",
      theme: game.theme,
      className: "history-dialog",
      panelClassName: "history-dialog__panel",
      dismissible: true,
      onClose: () => {
        if (cleanup === closeDialog) cleanup = null;
      },
      children: [title, details, historyScroll, actions],
    });
    cleanup = closeDialog;
    if (highlight) modal.dialog.addEventListener("keydown", onResultKeyDown);
    focusHistoryTop();
    requestAnimationFrame(focusHistoryTop);

    function focusHistoryTop(): void {
      if (!modal?.dialog.isConnected) return;
      historyScroll.scrollTop = 0;
      modal.panel.focus({ preventScroll: true });
    }

    function closeDialog(): void {
      if (cleanup !== closeDialog) return;
      cleanup = null;
      modal?.close();
    }

    function onResultKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== "n" || !highlight || !options.onNewGameShortcut) return;
      event.preventDefault();
      event.stopPropagation();
      options.onNewGameShortcut(game, highlight, closeDialog);
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
