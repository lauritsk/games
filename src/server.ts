const root = new URL("..", import.meta.url);
const srcRoot = new URL("./", import.meta.url);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(new URL("index.html", root)), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/src/styles.css") {
      return new Response(Bun.file(new URL("styles.css", srcRoot)), {
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }

    if (url.pathname === "/src/main.ts") {
      const result = await Bun.build({
        entrypoints: [new URL("main.ts", srcRoot).pathname],
        target: "browser",
        minify: false,
      });
      if (!result.success) return new Response("Build failed", { status: 500 });
      return new Response(result.outputs[0], {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Classic Games running at http://localhost:${server.port}`);
