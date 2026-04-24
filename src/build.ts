import { mkdir, rm, writeFile } from "node:fs/promises";
import { renderIndexHtml } from "./html";

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
await Bun.write(new URL("favicon.svg", dist), Bun.file(new URL("favicon.svg", import.meta.url)));

const script = result.outputs.find((output) => output.path.endsWith(".js"));
if (!script) throw new Error("Missing JavaScript output");

const scriptName = script.path.split("/").at(-1);
if (!scriptName) throw new Error("Missing JavaScript file name");

await writeFile(new URL("index.html", dist), renderIndexHtml(`/assets/${scriptName}`, "/assets/styles.css"));

console.log("Built dist");
