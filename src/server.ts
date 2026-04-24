import { renderIndexHtml } from "./html";

const srcRoot = new URL("./", import.meta.url);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return htmlResponse(renderIndexHtml("/src/main.ts", "/src/styles.css"));
    }

    if (url.pathname === "/favicon.svg") {
      return typedResponse(Bun.file(new URL("favicon.svg", srcRoot)), "image/svg+xml; charset=utf-8");
    }

    if (url.pathname === "/src/styles.css") {
      return typedResponse(Bun.file(new URL("styles.css", srcRoot)), "text/css; charset=utf-8");
    }

    if (url.pathname === "/src/main.ts") {
      const result = await Bun.build({
        entrypoints: [new URL("main.ts", srcRoot).pathname],
        target: "browser",
        minify: false,
      });
      if (!result.success) return new Response("Build failed", { status: 500 });
      const output = result.outputs[0];
      if (!output) return new Response("Build output missing", { status: 500 });
      return typedResponse(output, "text/javascript; charset=utf-8");
    }

    return new Response("Not found", { status: 404 });
  },
});

function htmlResponse(body: string): Response {
  return typedResponse(body, "text/html; charset=utf-8");
}

function typedResponse(body: BodyInit, contentType: string): Response {
  return new Response(body, { headers: { "content-type": contentType } });
}

console.log(`Classic Games running at http://localhost:${server.port}`);
