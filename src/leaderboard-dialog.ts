import { clearNode, el, pillButton, type GameDefinition } from "./core";
import { formatDate, resultDetails } from "./game-result-format";
import type { GameResult } from "./game-results";
import {
  fetchLeaderboard,
  isLeaderboardEligible,
  leaderboardMetricText,
  leaderboardResultMetricText,
  submitLeaderboardScore,
  type LeaderboardEntry,
} from "./leaderboard";
import { openModal, type ModalController } from "./modal";
import { playSound } from "./sound";

export type LeaderboardDialog = {
  show(game: GameDefinition, highlight?: GameResult): void;
  close(): void;
};

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
    const body = el("div", { className: "leaderboard-dialog__scroll" });
    const actions = el("div", { className: "leaderboard-dialog__actions modal__actions cluster" });
    const closeButton = pillButton("Close");

    closeButton.addEventListener("click", closeDialog);
    actions.append(closeButton);

    if (highlight && isLeaderboardEligible(highlight)) {
      summary.append(createSubmitForm(game, highlight, body));
    } else {
      summary.append(el("p", { className: "muted", text: "Top 10 public scores." }));
    }

    body.append(el("p", { className: "muted", text: "Loading scores…" }));

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
      children: [title, summary, body, actions],
    });
    cleanup = closeDialog;
    void loadScores(game.id, body, highlight?.difficulty);

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
): HTMLElement {
  const form = el("form", { className: "leaderboard-submit" });
  const intro = el("p", {
    className: "leaderboard-submit__intro",
    text: `Submit ${leaderboardResultMetricText(result)} to the public board.`,
  });
  const label = el("label", { className: "leaderboard-submit__label" });
  const labelText = el("span", { text: "Display name" });
  const input = el("input", { className: "leaderboard-submit__input" });
  input.name = "username";
  input.setAttribute("autocomplete", "nickname");
  input.maxLength = 16;
  input.placeholder = "AAA";
  const submit = pillButton("Submit score");
  submit.type = "submit";
  const status = el("p", { className: "leaderboard-submit__status muted" });

  label.append(labelText, input);
  form.append(intro, label, submit, status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Submitting…";
    const response = await submitLeaderboardScore(result, input.value);
    if (!response.ok) {
      submit.disabled = false;
      status.textContent = response.error;
      return;
    }
    playSound("gameGood");
    status.textContent = `Submitted at rank #${response.rank}.`;
    submit.textContent = "Submitted";
    await loadScores(game.id, list, result.difficulty);
  });
  return form;
}

async function loadScores(
  gameId: string,
  container: HTMLElement,
  difficulty?: GameResult["difficulty"],
): Promise<void> {
  const response = await fetchLeaderboard(gameId, { difficulty, limit: 10 });
  clearNode(container);
  if (!response.ok) {
    container.append(el("p", { className: "muted", text: response.error }));
    return;
  }
  container.append(renderEntries(response.entries));
}

function renderEntries(entries: LeaderboardEntry[]): HTMLElement {
  if (entries.length === 0) return el("p", { className: "muted", text: "No public scores yet." });
  const list = el("ol", { className: "leaderboard-list" });
  for (const entry of entries) {
    const item = el("li", { className: "leaderboard-list__item" });
    const rank = el("span", { className: "leaderboard-list__rank", text: `#${entry.rank ?? "?"}` });
    const main = el("span", { className: "leaderboard-list__main" });
    main.append(
      el("strong", { text: entry.username }),
      el("span", { text: leaderboardMetricText(entry) }),
    );
    const detailParts = resultDetails({
      id: entry.id,
      runId: entry.id,
      gameId: entry.gameId,
      finishedAt: entry.createdAt,
      outcome: entry.outcome as GameResult["outcome"],
      difficulty: entry.difficulty,
      score: entry.score,
      moves: entry.moves,
      durationMs: entry.durationMs,
      level: entry.level,
    });
    const detail = el("span", {
      className: "leaderboard-list__detail",
      text: detailParts.filter((part) => part !== leaderboardMetricText(entry)).join(" · "),
    });
    const time = el("time", {
      className: "leaderboard-list__time",
      text: formatDate(entry.createdAt),
    });
    item.append(rank, main, detail, time);
    list.append(item);
  }
  return list;
}
