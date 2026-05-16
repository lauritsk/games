import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite-plus";

const root = process.env["PWD"] ?? process.cwd();
const src = resolve(root, "src");

function resolveTsModule(path: string): string {
  if (existsSync(path) && statSync(path).isFile()) return path;
  if (existsSync(`${path}.ts`)) return `${path}.ts`;
  if (existsSync(`${path}/index.ts`)) return `${path}/index.ts`;
  return path;
}

function tsconfigAliases(): Plugin {
  const prefixes: Record<string, string> = {
    "@app/": `${src}/app/`,
    "@features/": `${src}/features/`,
    "@games/": `${src}/games/`,
    "@server/": `${src}/server/`,
    "@shared/": `${src}/shared/`,
    "@ui/": `${src}/ui/`,
  };
  return {
    name: "games-tsconfig-aliases",
    enforce: "pre",
    resolveId(source) {
      if (source === "@games") return resolveTsModule(`${src}/games/index.ts`);
      if (source === "@server") return resolveTsModule(`${src}/server/index.ts`);
      for (const [prefix, replacement] of Object.entries(prefixes)) {
        if (source.startsWith(prefix))
          return resolveTsModule(`${replacement}${source.slice(prefix.length)}`);
      }
      return undefined;
    },
  };
}

export default defineConfig({
  plugins: [tsconfigAliases()],
  test: {
    include: ["test/*.test.ts"],
  },
  lint: {},
  fmt: { ignorePatterns: [] },
});
