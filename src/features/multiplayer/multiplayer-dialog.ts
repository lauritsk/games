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
import type { ModalController } from "@shared/modal";
import { playSound } from "@ui/sound";

type MultiplayerSessionResponse =
  | { ok: true; session: MultiplayerSession }
  | { ok: false; error: string };

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
    const body = el("div", { className: "multiplayer-dialog__body" });

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
      children: [body],
    });
    cleanup = closeDialog;
    void renderStart();

    async function renderStart(): Promise<void> {
      clearNode(body);
      body.append(
        el("p", { className: "multiplayer-dialog__status muted", text: "Checking server…" }),
      );
      const status = await fetchMultiplayerStatus();
      clearNode(body);
      if (!status.ok) {
        body.append(el("p", { className: "muted", text: status.error }));
        return;
      }

      const create = pillButton("Create room");
      create.classList.add("multiplayer-dialog__create");
      const divider = el("div", { className: "multiplayer-dialog__divider" });
      divider.setAttribute("aria-hidden", "true");
      const form = el("form", { className: "multiplayer-dialog__join" });
      const input = el("input", { className: "form-control" });
      input.placeholder = "Enter code";
      input.maxLength = 12;
      input.setAttribute("aria-label", "Room code");
      const joinActions = el("div", { className: "multiplayer-dialog__join-actions" });
      const join = pillButton("Join room");
      join.type = "submit";
      const spectate = pillButton("Spectate");
      spectate.type = "button";
      joinActions.append(join, spectate);
      form.append(input, joinActions);
      const statusLine = el("p", { className: "multiplayer-dialog__status muted" });
      statusLine.setAttribute("aria-live", "polite");
      body.append(create, divider, form, statusLine);

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
        acceptSession(response.session);
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await enterExistingRoom(() => joinMultiplayerRoom(input.value), "Joining room…");
      });
      spectate.addEventListener("click", async () => {
        await enterExistingRoom(
          () => spectateMultiplayerRoom(input.value),
          "Opening spectator view…",
        );
      });

      async function enterExistingRoom(
        requestSession: () => Promise<MultiplayerSessionResponse>,
        pendingText: string,
      ): Promise<void> {
        setExistingRoomBusy(true);
        statusLine.textContent = pendingText;
        const response = await requestSession();
        if (!response.ok) {
          setExistingRoomBusy(false);
          statusLine.textContent = response.error;
          return;
        }
        acceptSession(response.session);
      }

      function setExistingRoomBusy(disabled: boolean): void {
        join.disabled = disabled;
        spectate.disabled = disabled;
      }

      function acceptSession(session: MultiplayerSession): void {
        created = true;
        playSound("gameGood");
        onSession(session);
        closeDialog();
      }
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
