import index from "../index.html";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": index,
    "/index.html": index,
  },
  development: {
    hmr: true,
    console: true,
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Classic Games running at ${server.url}`);
