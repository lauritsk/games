import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite-plus";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { createSyncApiHandler } from "@server/api";
import { apiError } from "@server/api-contract";
import {
  MultiplayerHub,
  type MultiplayerSocketData,
  type MultiplayerWebSocket,
} from "@server/multiplayer";

const isProduction = process.env["NODE_ENV"] === "production";
const port = Number(process.env["PORT"] ?? 3000);
const root = process.cwd();
const clientDist = resolve(root, "dist");

const syncApi = createSyncApiHandler();
const multiplayer = new MultiplayerHub();
const vite = isProduction
  ? undefined
  : await createViteServer({ root, server: { middlewareMode: true }, appType: "spa" });
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

const server = createServer(async (req, res) => {
  try {
    const response = await routeRequest(req, res, vite);
    if (response) await sendWebResponse(res, response);
  } catch (error) {
    vite?.ssrFixStacktrace(error as Error);
    console.error(error);
    await sendWebResponse(res, apiError("Request failed", 500));
  }
});

server.on("upgrade", async (req, socket, head) => {
  try {
    const request = nodeRequest(req);
    const url = new URL(request.url);
    if (url.pathname !== "/api/multiplayer/socket") {
      socket.destroy();
      return;
    }
    const prepared = await multiplayer.prepareUpgrade(request);
    if (!prepared.ok) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const gameWs = attachData(ws, prepared.data);
      multiplayer.onOpen(gameWs);
      wss.emit("connection", gameWs, req);
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws: GameWebSocket) => {
  ws.on("message", (message) => multiplayer.onMessage(ws, rawDataToMessage(message)));
  ws.on("close", () => multiplayer.onClose(ws));
});

server.listen(port, () => {
  console.log(`Games running at http://localhost:${port}`);
});

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  viteServer: ViteDevServer | undefined,
): Promise<Response | undefined> {
  const request = nodeRequest(req);
  const apiResponse =
    (await multiplayer.handleHttp(request)) ?? (await syncApi(request)) ?? apiFallback(request);
  if (apiResponse) return apiResponse;

  if (viteServer) {
    await new Promise<void>((resolvePromise, reject) => {
      viteServer.middlewares(req, res, (error?: unknown) => {
        if (error) reject(error);
        else resolvePromise();
      });
    });
    return undefined;
  }

  return staticResponse(request);
}

function apiFallback(request: Request): Response | null {
  return new URL(request.url).pathname.startsWith("/api/") ? apiError("Not found", 404) : null;
}

function nodeRequest(req: IncomingMessage): Request {
  const protocol = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers.host ?? `localhost:${port}`;
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  return new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
    duplex: "half",
  } as RequestInit);
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body) res.write(chunk);
  res.end();
}

async function staticResponse(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const filePath = safeStaticPath(pathname === "/" ? "/index.html" : pathname);
  const response = filePath ? await fileResponse(filePath) : null;
  return (
    response ?? (await fileResponse(join(clientDist, "index.html"))) ?? apiError("Not found", 404)
  );
}

function safeStaticPath(pathname: string): string | null {
  const candidate = resolve(clientDist, `.${normalize(pathname)}`);
  return candidate.startsWith(clientDist) ? candidate : null;
}

async function fileResponse(path: string): Promise<Response | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return new Response(createReadStream(path) as unknown as BodyInit, {
      headers: { "content-type": contentType(path) },
    });
  } catch {
    return null;
  }
}

function contentType(path: string): string {
  return (
    {
      ".css": "text/css;charset=utf-8",
      ".html": "text/html;charset=utf-8",
      ".js": "text/javascript;charset=utf-8",
      ".json": "application/json;charset=utf-8",
      ".svg": "image/svg+xml",
      ".webmanifest": "application/manifest+json;charset=utf-8",
    }[extname(path)] ?? "application/octet-stream"
  );
}

type GameWebSocket = WebSocket & MultiplayerWebSocket<MultiplayerSocketData>;

function attachData(ws: WebSocket, data: MultiplayerSocketData): GameWebSocket {
  const gameWs = ws as GameWebSocket;
  gameWs.data = data;
  gameWs.publishText = (_topic, message) => gameWs.send(message);
  gameWs.subscribe = () => {};
  gameWs.subscriptions = [];
  gameWs.isSubscribed = () => false;
  return gameWs;
}

function rawDataToMessage(message: RawData): string | Buffer {
  if (typeof message === "string") return message;
  const chunks = (Array.isArray(message) ? message : [message]).map((chunk) =>
    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
  );
  return Buffer.concat(chunks);
}
