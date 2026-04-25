import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import {
  canRequestMultiplayerRematch,
  canStartMultiplayerMatch,
  multiplayerRematchActionLabel,
} from "@features/multiplayer/multiplayer-actions";
import {
  emptyMultiplayerSeatSnapshots,
  multiplayerJoinedSeatCount,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";
import { MultiplayerHub, type MultiplayerSocketData } from "@server/multiplayer";

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

type TestSocket = ServerWebSocket<MultiplayerSocketData> & {
  sent: string[];
  published: string[];
};

function fakeSocket(data: MultiplayerSocketData): TestSocket {
  const sent: string[] = [];
  const published: string[] = [];
  return {
    data,
    sent,
    published,
    send(message: string) {
      sent.push(message);
      return 0;
    },
    publish(_topic: string, message: string) {
      published.push(message);
      return 0;
    },
    subscribe() {},
    close() {},
  } as unknown as TestSocket;
}

function lastSentJson(socket: TestSocket): Record<string, unknown> {
  const message = socket.sent.at(-1);
  if (!message) throw new Error("No socket message sent");
  return JSON.parse(message) as Record<string, unknown>;
}

describe("multiplayer client helpers", () => {
  test("gate start and rematch actions from shared room state", () => {
    const seats = emptyMultiplayerSeatSnapshots();
    const session = {
      code: "ABC234",
      gameId: "tictactoe",
      playerId: "p1-id",
      playerToken: "token",
      seat: "p1",
    } satisfies MultiplayerSession;

    seats.p1.joined = true;
    expect(multiplayerJoinedSeatCount(seats)).toBe(1);
    expect(
      canStartMultiplayerMatch({
        session,
        seat: "p1",
        connectionStatus: "connected",
        roomStatus: "lobby",
        seats,
      }),
    ).toBe(false);

    seats.p2.joined = true;
    expect(multiplayerJoinedSeatCount(seats)).toBe(2);
    expect(
      canStartMultiplayerMatch({
        session,
        seat: "p1",
        connectionStatus: "connected",
        roomStatus: "lobby",
        seats,
      }),
    ).toBe(true);
    expect(canRequestMultiplayerRematch(true, "p1", false)).toBe(true);
    expect(canRequestMultiplayerRematch(true, "p2", false)).toBe(true);
    expect(canRequestMultiplayerRematch(true, "p2", true)).toBe(false);
    expect(canRequestMultiplayerRematch(false, "p1", false)).toBe(false);
    expect(multiplayerRematchActionLabel("p1", false)).toBe("Start rematch");
    expect(multiplayerRematchActionLabel("p2", false)).toBe("Ready rematch");
    expect(multiplayerRematchActionLabel("p2", true)).toBe("Ready");
  });
});

describe("multiplayer API", () => {
  test("creates and joins short-code rooms", async () => {
    const hub = new MultiplayerHub();
    const create = await hub.handleHttp(
      new Request("http://local/api/multiplayer/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId: "tictactoe" }),
      }),
    );
    expect(create?.status).toBe(200);
    const created = await json(create!);
    const session = created.session as {
      code: string;
      seat: string;
      playerId: string;
      playerToken: string;
    };
    expect(session.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(session.seat).toBe("p1");

    const join = await hub.handleHttp(
      new Request("http://local/api/multiplayer/rooms/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: session.code.toLowerCase() }),
      }),
    );
    expect(join?.status).toBe(200);
    const joined = await json(join!);
    expect((joined.session as { seat: string }).seat).toBe("p2");
    hub.dispose();
  });

  test("starts rooms with a countdown after host start", async () => {
    const hub = new MultiplayerHub();
    const created = await hub.createRoom("tictactoe");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = await hub.joinRoom(created.session.code);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const p1 = fakeSocket({
      code: created.session.code,
      playerId: created.session.playerId,
      seat: "p1",
    });
    hub.onOpen(p1);
    const lobbySnapshot = lastSentJson(p1);
    expect(lobbySnapshot.type).toBe("snapshot");
    const lobbyRoom = lobbySnapshot.room as { status: string; revision: number };
    expect(lobbyRoom.status).toBe("lobby");
    expect(lobbyRoom.revision).toBe(1);

    hub.onMessage(p1, JSON.stringify({ type: "start", revision: 1 }));
    const snapshot = lastSentJson(p1);
    expect(snapshot.type).toBe("snapshot");
    const room = snapshot.room as { status: string; countdownEndsAt: number; revision: number };
    expect(room.status).toBe("countdown");
    expect(room.revision).toBe(2);
    expect(room.countdownEndsAt).toBeGreaterThan(Date.now());

    hub.onMessage(
      p1,
      JSON.stringify({ type: "action", revision: 2, action: { type: "place", index: 0 } }),
    );
    const error = lastSentJson(p1);
    expect(error.type).toBe("error");
    expect(error.error).toBe("Room is not ready");
    hub.dispose();
  });

  test("rematches finished rooms without creating a new session", async () => {
    const hub = new MultiplayerHub({ countdownMs: 0 });
    const created = await hub.createRoom("tictactoe");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = await hub.joinRoom(created.session.code);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const p1 = fakeSocket({
      code: created.session.code,
      playerId: created.session.playerId,
      seat: "p1",
    });
    const p2 = fakeSocket({
      code: joined.session.code,
      playerId: joined.session.playerId,
      seat: "p2",
    });
    hub.onOpen(p1);
    hub.onOpen(p2);
    hub.onMessage(p1, JSON.stringify({ type: "start", revision: 1 }));

    const play = (socket: TestSocket, revision: number, index: number): void => {
      hub.onMessage(
        socket,
        JSON.stringify({ type: "action", revision, action: { type: "place", index } }),
      );
    };

    play(p1, 2, 0);
    play(p2, 3, 3);
    play(p1, 4, 1);
    play(p2, 5, 4);
    play(p1, 6, 2);

    hub.onMessage(p1, JSON.stringify({ type: "rematch", revision: 7 }));
    const waiting = lastSentJson(p1);
    expect(waiting.type).toBe("error");
    expect(waiting.error).toBe("Waiting for another player to ready");
    expect((waiting.room as { status: string; revision: number }).status).toBe("finished");
    expect((waiting.room as { revision: number }).revision).toBe(8);

    hub.onMessage(p2, JSON.stringify({ type: "rematch", revision: 8 }));
    const ready = lastSentJson(p2);
    expect(ready.type).toBe("snapshot");
    const readyRoom = ready.room as {
      status: string;
      revision: number;
      seats: { p1: { ready: boolean }; p2: { ready: boolean } };
    };
    expect(readyRoom.status).toBe("finished");
    expect(readyRoom.revision).toBe(9);
    expect(readyRoom.seats.p1.ready).toBe(true);
    expect(readyRoom.seats.p2.ready).toBe(true);

    hub.onMessage(p2, JSON.stringify({ type: "rematch", revision: 9 }));
    const nonHostRepeat = lastSentJson(p2);
    expect((nonHostRepeat.room as { status: string }).status).toBe("finished");

    hub.onMessage(p1, JSON.stringify({ type: "rematch", revision: 9 }));

    const message = lastSentJson(p1);
    expect(message.type).toBe("snapshot");
    const room = message.room as { status: string; revision: number; state: unknown };
    expect(room.status).toBe("playing");
    expect(room.revision).toBe(10);
    const state = room.state as { board: string[]; moves: number; winner: string | null };
    expect(state.moves).toBe(0);
    expect(state.winner).toBeNull();
    expect(state.board.every((cell) => cell === "")).toBe(true);
    hub.dispose();
  });

  test("supports four-player Snake lobbies before host start", async () => {
    const hub = new MultiplayerHub({ countdownMs: 0 });
    const created = await hub.createRoom("snake");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const p2 = await hub.joinRoom(created.session.code);
    const p3 = await hub.joinRoom(created.session.code);
    const p4 = await hub.joinRoom(created.session.code);
    const p5 = await hub.joinRoom(created.session.code);
    expect(p2.ok).toBe(true);
    expect(p3.ok).toBe(true);
    expect(p4.ok).toBe(true);
    if (p2.ok) expect(p2.session.seat).toBe("p2");
    if (p3.ok) expect(p3.session.seat).toBe("p3");
    if (p4.ok) expect(p4.session.seat).toBe("p4");
    expect(p5).toEqual({ ok: false, error: "Room not found or unavailable" });

    const p1Socket = fakeSocket({
      code: created.session.code,
      playerId: created.session.playerId,
      seat: "p1",
    });
    hub.onMessage(p1Socket, JSON.stringify({ type: "start", revision: 3 }));

    const message = lastSentJson(p1Socket);
    expect(message.type).toBe("snapshot");
    const room = message.room as { status: string; revision: number; state: unknown };
    expect(room.status).toBe("playing");
    expect(room.revision).toBe(4);
    const state = room.state as { players: Array<{ seat: string; alive: boolean }> };
    expect(state.players.map((player) => player.seat)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(state.players.every((player) => player.alive)).toBe(true);
    hub.dispose();
  });

  test("rejects third players and bad socket tokens", async () => {
    const hub = new MultiplayerHub();
    const created = await hub.createRoom("connect4");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = await hub.joinRoom(created.session.code);
    expect(joined.ok).toBe(true);
    const third = await hub.joinRoom(created.session.code);
    expect(third).toEqual({ ok: false, error: "Room not found or unavailable" });

    const bad = await hub.prepareUpgrade(
      new Request(
        `http://local/api/multiplayer/socket?code=${created.session.code}&playerId=${created.session.playerId}&token=bad`,
      ),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.response.status).toBe(401);
    hub.dispose();
  });
});
