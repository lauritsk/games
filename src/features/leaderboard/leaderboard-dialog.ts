import { clearNode, el, pillButton, setSelected, type GameDefinition } from "@shared/core";
import { formatDate } from "@features/results/game-result-format";
import type { GameResult } from "@features/results/game-results";
import { loadGamePreferences } from "@games/shared/game-preferences";
import {
  fetchLeaderboard,
  isLeaderboardEligible,
  leaderboardMetricText,
  leaderboardResultMetricText,
  submitLeaderboardScore,
  type LeaderboardEntry,
} from "@features/leaderboard/leaderboard";
import { openModal, type ModalController } from "@shared/modal";
import { playSound } from "@ui/sound";
import type { Difficulty } from "@shared/types";

export type LeaderboardDialog = {
  show(game: GameDefinition, highlight?: GameResult): void;
  close(): void;
};

const difficulties: Difficulty[] = ["Easy", "Medium", "Hard"];

export function createLeaderboardDialog(): LeaderboardDialog {
  let cleanup: (() => void) | null = null;

  function close(): void {
    cleanup?.();
  }

  function show(game: GameDefinition, highlight?: GameResult): void {
    close();
    let modal: ModalController | null = null;
    const title = el("h2", {
      className: "leaderboard-dialog__title",
      text: `${game.name} leaderboard`,
    });
    const summary = el("div", { className: "leaderboard-dialog__summary" });
    const filters = el("div", { className: "leaderboard-dialog__filters cluster" });
    const body = el("div", { className: "leaderboard-dialog__scroll" });
    const actions = el("div", { className: "leaderboard-dialog__actions modal__actions cluster" });
    const closeButton = pillButton("Close");
    let selectedDifficulty =
      highlight?.difficulty ?? loadGamePreferences(game.id).difficulty ?? "Medium";
    let submittedEntry: LeaderboardEntry | undefined;

    closeButton.addEventListener("click", closeDialog);
    actions.append(closeButton);

    if (highlight && isLeaderboardEligible(highlight)) {
      summary.append(
        createSubmitForm(game, highlight, body, (entry) => {
          submittedEntry = entry;
          selectedDifficulty = entry.difficulty ?? selectedDifficulty;
          renderFilters();
        }),
      );
    }

    renderFilters();
    body.append(el("p", { className: "muted", text: "Loading leaderboard…" }));

    modal = openModal({
      label: `${game.name} leaderboard`,
      size: "md",
      theme: game.theme,
      className: "leaderboard-dialog",
      panelClassName: "leaderboard-dialog__panel",
      dismissible: true,
      onClose: () => {
        if (cleanup === closeDialog) cleanup = null;
      },
      children: [title, summary, filters, body, actions],
    });
    cleanup = closeDialog;
    void refreshScores();

    function renderFilters(): void {
      clearNode(filters);
      for (const difficulty of difficulties) {
        const button = pillButton(difficulty);
        setSelected(button, difficulty === selectedDifficulty);
        button.addEventListener("click", () => {
          selectedDifficulty = difficulty;
          renderFilters();
          void refreshScores();
        });
        filters.append(button);
      }
    }

    async function refreshScores(): Promise<void> {
      const submitted =
        submittedEntry?.difficulty === selectedDifficulty ? submittedEntry : undefined;
      await loadScores(game.id, body, selectedDifficulty, submitted);
    }

    function closeDialog(): void {
      if (cleanup !== closeDialog) return;
      cleanup = null;
      modal?.close();
    }
  }

  return { show, close };
}

function createSubmitForm(
  game: GameDefinition,
  result: GameResult,
  list: HTMLElement,
  onSubmitted: (entry: LeaderboardEntry) => void,
): HTMLElement {
  const form = el("form", { className: "leaderboard-submit" });
  const label = el("label", { className: "leaderboard-submit__label" });
  const input = el("input", { className: "leaderboard-submit__input" });
  input.name = "username";
  input.setAttribute("autocomplete", "nickname");
  input.setAttribute("aria-label", "Display name");
  input.maxLength = 16;
  input.placeholder = "Display name";
  const submit = pillButton(`Submit ${leaderboardResultMetricText(result)}`);
  submit.type = "submit";
  const status = el("p", { className: "leaderboard-submit__status muted" });
  status.hidden = true;
  status.setAttribute("aria-live", "polite");

  label.append(input);
  const controls = el("div", { className: "leaderboard-submit__controls" });
  controls.append(label, submit);
  form.append(controls, status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = "Submitting…";
    status.hidden = true;
    const response = await submitLeaderboardScore(result, input.value);
    if (!response.ok) {
      submit.disabled = false;
      submit.textContent = `Submit ${leaderboardResultMetricText(result)}`;
      status.hidden = false;
      status.textContent = response.error;
      return;
    }
    playSound("gameGood");
    status.hidden = false;
    status.textContent = `Rank #${response.rank}`;
    submit.textContent = "Submitted";
    onSubmitted(response.entry);
    await loadScores(game.id, list, response.entry.difficulty, response.entry);
  });
  return form;
}

async function loadScores(
  gameId: string,
  container: HTMLElement,
  difficulty?: GameResult["difficulty"],
  submitted?: LeaderboardEntry,
): Promise<void> {
  const response = await fetchLeaderboard(gameId, { difficulty, limit: 10 });
  clearNode(container);
  if (!response.ok) {
    container.append(el("p", { className: "muted", text: response.error }));
    return;
  }
  container.append(renderEntries(response.entries, submitted));
}

function renderEntries(entries: LeaderboardEntry[], submitted?: LeaderboardEntry): HTMLElement {
  if (entries.length === 0 && !submitted) {
    return el("p", { className: "muted", text: "No public entries yet." });
  }
  const list = el("ol", { className: "leaderboard-list" });
  for (const entry of entries) {
    list.append(renderEntry(entry));
  }
  if (submitted && !entries.some((entry) => entry.id === submitted.id)) {
    const item = renderEntry(submitted);
    item.classList.add("leaderboard-list__item--submitted");
    list.append(item);
  }
  return list;
}

function renderEntry(entry: LeaderboardEntry): HTMLLIElement {
  const item = el("li", { className: "leaderboard-list__item" });
  const rank = el("span", { className: "leaderboard-list__rank", text: `#${entry.rank ?? "?"}` });
  const main = el("span", { className: "leaderboard-list__main" });
  main.append(
    el("strong", { text: entry.username }),
    el("span", { text: leaderboardMetricText(entry) }),
  );
  const detail = el("span", {
    className: "leaderboard-list__detail",
    text: entry.difficulty ?? "",
  });
  const time = el("time", {
    className: "leaderboard-list__time",
    text: formatDate(entry.createdAt),
  });
  item.append(rank, main, detail, time);
  return item;
}
