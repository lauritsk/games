import index from "../../index.html";
import { createSyncApiHandler } from "@server/api";
import { MultiplayerHub, type MultiplayerSocketData } from "@server/multiplayer";

const isProduction = process.env["NODE_ENV"] === "production";

const syncApi = createSyncApiHandler();
const multiplayer = new MultiplayerHub();

async function apiResponse(request: Request): Promise<Response> {
  return (await multiplayer.handleHttp(request)) ?? (await syncApi(request)) ?? apiNotFound();
}

async function multiplayerSocketResponse(
  request: Request,
  server: Bun.Server<MultiplayerSocketData>,
): Promise<Response | undefined> {
  const prepared = await multiplayer.prepareUpgrade(request);
  if (!prepared.ok) return prepared.response;
  if (server.upgrade(request, { data: prepared.data })) return undefined;
  return new Response("Upgrade failed", { status: 400 });
}

function apiNotFound(): Response {
  return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
    status: 404,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function serviceWorkerResponse(): Promise<Response> {
  const path = isProduction ? "service-worker.js" : "src/ui/service-worker.js";
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, { headers: { "content-type": "text/javascript;charset=utf-8" } });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": index,
    "/index.html": index,
    "/service-worker.js": serviceWorkerResponse,
    "/api/sync/status": { GET: apiResponse },
    "/api/sync": { GET: apiResponse, POST: apiResponse },
    "/api/leaderboard": { GET: apiResponse, POST: apiResponse },
    "/api/multiplayer/status": { GET: apiResponse },
    "/api/multiplayer/rooms": { POST: apiResponse },
    "/api/multiplayer/rooms/join": { POST: apiResponse },
    "/api/multiplayer/rooms/spectate": { POST: apiResponse },
    "/api/multiplayer/socket": { GET: multiplayerSocketResponse },
    "/api/*": apiResponse,
  },
  development: isProduction
    ? false
    : {
        hmr: true,
        console: true,
      },
  fetch: () => new Response("Not found", { status: 404 }),
  websocket: {
    idleTimeout: 120,
    maxPayloadLength: 4096,
    publishToSelf: true,
    open: (ws: Bun.ServerWebSocket<MultiplayerSocketData>) => multiplayer.onOpen(ws),
    message: (ws: Bun.ServerWebSocket<MultiplayerSocketData>, message) =>
      multiplayer.onMessage(ws, message),
    close: (ws: Bun.ServerWebSocket<MultiplayerSocketData>) => multiplayer.onClose(ws),
  },
});

console.log(`Games running at ${server.url}`);
