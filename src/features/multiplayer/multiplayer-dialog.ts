import { clearNode, el, openModal, pillButton, type GameDefinition } from "@shared/core";
import {
  createMultiplayerRoom,
  fetchMultiplayerStatus,
  joinMultiplayerRoom,
  spectateMultiplayerRoom,
} from "@features/multiplayer/multiplayer";
import {
  normalizeMultiplayerCode,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";
import { multiplayerPlayerDescriptor } from "@features/multiplayer/multiplayer-presence";
import type { ModalController } from "@shared/modal";
import { playSound } from "@ui/sound";

export type MultiplayerDialog = {
  show(
    game: GameDefinition,
    onSession: (session: MultiplayerSession) => void,
    getSettings?: () => unknown,
  ): void;
  close(): void;
};

export function createMultiplayerDialog(): MultiplayerDialog {
  let cleanup: (() => void) | null = null;

  function close(): void {
    cleanup?.();
  }

  function show(
    game: GameDefinition,
    onSession: (session: MultiplayerSession) => void,
    getSettings?: () => unknown,
  ): void {
    close();
    let modal: ModalController | null = null;
    let created = false;
    const title = el("h2", {
      className: "multiplayer-dialog__title popup-title",
      text: `${game.name} online`,
    });
    const summary = el("p", {
      className: "muted",
      text: "Create a private online room or join one with a code.",
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
      summary.textContent = "Create a private online room or join one with a code.";
      clearNode(body);
      body.append(el("p", { className: "muted", text: "Checking server…" }));
      const status = await fetchMultiplayerStatus();
      clearNode(body);
      if (!status.ok) {
        body.append(el("p", { className: "muted", text: status.error }));
        return;
      }

      const create = pillButton("Create room");
      create.classList.add("multiplayer-dialog__option-action");
      const start = el("div", { className: "multiplayer-dialog__choices" });
      const createOption = el("section", { className: "section-card multiplayer-dialog__option" });
      createOption.append(
        el("h3", { className: "multiplayer-dialog__option-title", text: "Create room" }),
        el("p", {
          className: "multiplayer-dialog__option-copy muted",
          text: "Start a private room and share its code.",
        }),
        create,
      );
      const joinOption = el("section", { className: "section-card multiplayer-dialog__option" });
      const form = el("form", { className: "multiplayer-dialog__join" });
      const input = el("input", { className: "form-control" });
      input.placeholder = "Enter code";
      input.maxLength = 12;
      input.setAttribute("aria-label", "Room code");
      const join = pillButton("Join room");
      join.type = "submit";
      form.append(input, join);
      const spectate = pillButton("Spectate");
      spectate.type = "button";
      form.append(spectate);
      joinOption.append(
        el("h3", { className: "multiplayer-dialog__option-title", text: "Join room" }),
        el("p", {
          className: "multiplayer-dialog__option-copy muted",
          text: "Use the room code from another player, or watch without taking a seat.",
        }),
        form,
      );
      const statusLine = el("p", { className: "multiplayer-dialog__status muted" });
      statusLine.setAttribute("aria-live", "polite");
      start.append(createOption, joinOption);
      body.append(start, statusLine);

      input.addEventListener("input", () => {
        input.value = normalizeMultiplayerCode(input.value);
      });
      create.addEventListener("click", async () => {
        create.disabled = true;
        statusLine.textContent = "Creating room…";
        const response = await createMultiplayerRoom(game.id, getSettings?.());
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
        spectate.disabled = true;
        statusLine.textContent = "Joining room…";
        const response = await joinMultiplayerRoom(input.value);
        if (!response.ok) {
          join.disabled = false;
          spectate.disabled = false;
          statusLine.textContent = response.error;
          return;
        }
        playSound("gameGood");
        onSession(response.session);
        closeDialog();
      });
      spectate.addEventListener("click", async () => {
        join.disabled = true;
        spectate.disabled = true;
        statusLine.textContent = "Opening spectator view…";
        const response = await spectateMultiplayerRoom(input.value);
        if (!response.ok) {
          join.disabled = false;
          spectate.disabled = false;
          statusLine.textContent = response.error;
          return;
        }
        playSound("gameGood");
        onSession(response.session);
        closeDialog();
      });
    }

    function renderCreated(session: MultiplayerSession): void {
      summary.textContent = "Share this code. The match starts when enough players join.";
      clearNode(body);
      const code = el("div", {
        className: "room-code multiplayer-dialog__code",
        text: session.code,
      });
      const descriptor = multiplayerPlayerDescriptor(game.id, session.seat);
      const assignment = el("div", { className: "multiplayer-dialog__assignment" });
      assignment.style.setProperty("--player-color", descriptor.color);
      assignment.append(
        el("span", { className: "player-swatch", ariaLabel: descriptor.colorName }),
        el("span", {
          text: `You are ${descriptor.label} · ${descriptor.colorName}`,
        }),
      );
      const help = el("p", {
        className: "multiplayer-dialog__room-copy muted",
        text: "Share this code. Keep this page open while you wait.",
      });
      const copy = pillButton("Copy code");
      const codeHeader = el("div", { className: "multiplayer-dialog__code-header" });
      codeHeader.append(el("span", { text: "Room code" }), copy);
      const codeCard = el("div", { className: "section-card multiplayer-dialog__code-card" });
      codeCard.append(codeHeader, code);
      copy.addEventListener("click", async () => {
        await navigator.clipboard?.writeText(session.code).catch(() => undefined);
        copy.textContent = "Copied";
      });
      const room = el("div", { className: "multiplayer-dialog__room" });
      room.append(codeCard, assignment, help);
      body.append(room);
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
