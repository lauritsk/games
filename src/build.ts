import { mkdir, rm, writeFile } from "node:fs/promises";

const appRoot = new URL("..", import.meta.url);
const dist = new URL("dist/", appRoot);
const assets = new URL("assets/", dist);

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

const result = await Bun.build({
  entrypoints: [new URL("main.ts", import.meta.url).pathname],
  outdir: assets.pathname,
  target: "browser",
  minify: true,
  sourcemap: "external",
  naming: "[name]-[hash].[ext]",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await Bun.write(new URL("styles.css", assets), Bun.file(new URL("styles.css", import.meta.url)));

const script = result.outputs.find((output) => output.path.endsWith(".js"));
if (!script) throw new Error("Missing JavaScript output");

const scriptName = script.path.split("/").at(-1);
if (!scriptName) throw new Error("Missing JavaScript file name");

await writeFile(
  new URL("index.html", dist),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#fff7df" />
    <title>Classic Games</title>
    <link rel="stylesheet" href="/assets/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/assets/${scriptName}"></script>
  </body>
</html>
`,
);

console.log("Built dist");
