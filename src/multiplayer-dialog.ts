import { clearNode, el, openModal, pillButton, type GameDefinition } from "./core";
import { createMultiplayerRoom, fetchMultiplayerStatus, joinMultiplayerRoom } from "./multiplayer";
import { normalizeMultiplayerCode, type MultiplayerSession } from "./multiplayer-protocol";
import type { ModalController } from "./modal";
import { playSound } from "./sound";

export type MultiplayerDialog = {
  show(game: GameDefinition, onSession: (session: MultiplayerSession) => void): void;
  close(): void;
};

export function createMultiplayerDialog(): MultiplayerDialog {
  let cleanup: (() => void) | null = null;

  function close(): void {
    cleanup?.();
  }

  function show(game: GameDefinition, onSession: (session: MultiplayerSession) => void): void {
    close();
    let modal: ModalController | null = null;
    let created = false;
    const title = el("h2", { className: "multiplayer-dialog__title", text: `${game.name} online` });
    const summary = el("p", {
      className: "muted",
      text: "Create a private 1v1 room or join one with a code.",
    });
    const body = el("div", { className: "multiplayer-dialog__body" });
    const actions = el("div", { className: "modal__actions cluster" });
    const closeButton = pillButton("Close");
    closeButton.addEventListener("click", closeDialog);
    actions.append(closeButton);

    modal = openModal({
      label: `${game.name} online`,
      size: "md",
      theme: game.theme,
      className: "multiplayer-dialog",
      panelClassName: "multiplayer-dialog__panel",
      dismissible: true,
      onClose: () => {
        if (cleanup === closeDialog) cleanup = null;
      },
      children: [title, summary, body, actions],
    });
    cleanup = closeDialog;
    void renderStart();

    async function renderStart(): Promise<void> {
      clearNode(body);
      body.append(el("p", { className: "muted", text: "Checking server…" }));
      const status = await fetchMultiplayerStatus();
      clearNode(body);
      if (!status.ok) {
        body.append(el("p", { className: "muted", text: status.error }));
        return;
      }

      const create = pillButton("Create room");
      const form = el("form", { className: "multiplayer-dialog__join" });
      const input = el("input", { className: "leaderboard-submit__input" });
      input.placeholder = "Room code";
      input.maxLength = 12;
      input.setAttribute("aria-label", "Room code");
      const join = pillButton("Join room");
      join.type = "submit";
      const statusLine = el("p", { className: "muted" });
      statusLine.setAttribute("aria-live", "polite");
      form.append(input, join);
      body.append(create, form, statusLine);

      input.addEventListener("input", () => {
        input.value = normalizeMultiplayerCode(input.value);
      });
      create.addEventListener("click", async () => {
        create.disabled = true;
        statusLine.textContent = "Creating room…";
        const response = await createMultiplayerRoom(game.id);
        if (!response.ok) {
          create.disabled = false;
          statusLine.textContent = response.error;
          return;
        }
        created = true;
        playSound("gameGood");
        onSession(response.session);
        renderCreated(response.session);
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        join.disabled = true;
        statusLine.textContent = "Joining room…";
        const response = await joinMultiplayerRoom(input.value);
        if (!response.ok) {
          join.disabled = false;
          statusLine.textContent = response.error;
          return;
        }
        playSound("gameGood");
        onSession(response.session);
        closeDialog();
      });
    }

    function renderCreated(session: MultiplayerSession): void {
      clearNode(body);
      const code = el("div", { className: "multiplayer-dialog__code", text: session.code });
      const help = el("p", {
        className: "muted",
        text: "Share this code. Keep this page open while you wait.",
      });
      const copy = pillButton("Copy code");
      copy.addEventListener("click", async () => {
        await navigator.clipboard?.writeText(session.code).catch(() => undefined);
        copy.textContent = "Copied";
      });
      body.append(code, help, copy);
    }

    function closeDialog(): void {
      if (cleanup !== closeDialog) return;
      cleanup = null;
      modal?.close();
      if (!created) playSound("uiToggle");
    }
  }

  return { show, close };
}
