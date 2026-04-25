import { describe, expect, test } from "bun:test";
import { MultiplayerHub } from "../src/server/multiplayer";

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

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
