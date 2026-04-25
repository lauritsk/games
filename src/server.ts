import index from "../index.html";
import { createSyncApiHandler } from "./server/api";

const isProduction = process.env["NODE_ENV"] === "production";
const publicDir = process.env.PUBLIC_DIR ?? "public";

function safePath(pathname: string): string | null {
  const path = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(path);

  if (decodedPath.includes("\0") || decodedPath.split("/").includes("..")) {
    return null;
  }

  return `${publicDir}${decodedPath}`;
}

function contentType(path: string): string | undefined {
  if (path.endsWith(".html")) return "text/html;charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript;charset=utf-8";
  if (path.endsWith(".css")) return "text/css;charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".webmanifest")) return "application/manifest+json;charset=utf-8";
  return undefined;
}

const syncApi = createSyncApiHandler();

async function appResponse(request: Request): Promise<Response> {
  const apiResponse = await syncApi(request);
  if (apiResponse) return apiResponse;
  return isProduction ? staticResponse(request) : new Response("Not found", { status: 404 });
}

async function staticResponse(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const path = safePath(pathname);

  if (path === null) {
    return new Response("Not found", { status: 404 });
  }

  const file = Bun.file(path);

  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  const type = contentType(path);

  return new Response(file, {
    headers: type === undefined ? undefined : { "content-type": type },
  });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: isProduction
    ? undefined
    : {
        "/": index,
        "/index.html": index,
      },
  development: {
    hmr: true,
    console: true,
  },
  fetch: appResponse,
});

console.log(`Games running at ${server.url}`);
