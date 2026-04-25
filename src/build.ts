import { $ } from "bun";

const mode = Bun.argv[2] ?? "client";
const outdirArg = Bun.argv[3];

type BundleFlags = {
  online: boolean;
  pwa: boolean;
  staticLite: boolean;
};

const flags = bundleFlags();

switch (mode) {
  case "client":
    await buildClient(outdirArg ?? "dist", flags);
    break;
  case "server":
    await buildServer(outdirArg ?? "/tmp/games-server-build", flags);
    break;
  case "production":
    await buildServer(outdirArg ?? "dist", flags);
    break;
  case "single":
    await buildSingle(outdirArg ?? "dist-single", { ...flags, pwa: false });
    break;
  case "analyze":
    await buildAnalyze(outdirArg ?? "dist-analyze", flags);
    break;
  default:
    throw new Error(`Unknown build mode: ${mode}`);
}

async function buildClient(outdir: string, buildFlags: BundleFlags): Promise<void> {
  await cleanDir(outdir);
  await runBuild(
    ["./index.html", "--outdir", outdir, "--minify", "--splitting", "--env=GAMES_BUNDLE_*"],
    buildFlags,
  );
  if (buildFlags.pwa) {
    await runBuild(
      ["./src/ui/service-worker.js", "--outdir", outdir, "--minify", "--entry-naming=[name].[ext]"],
      buildFlags,
    );
  }
  await copyPublicAssets(outdir);
}

async function buildServer(outdir: string, buildFlags: BundleFlags): Promise<void> {
  await cleanDir(outdir);
  await runBuild(
    [
      "./src/server/index.ts",
      "--outdir",
      outdir,
      "--target",
      "bun",
      "--root",
      ".",
      "--minify",
      "--splitting",
      "--entry-naming=server.[ext]",
      "--env=GAMES_BUNDLE_*",
    ],
    buildFlags,
  );
  if (buildFlags.pwa) {
    await runBuild(
      ["./src/ui/service-worker.js", "--outdir", outdir, "--minify", "--entry-naming=[name].[ext]"],
      buildFlags,
    );
  }
  await copyPublicAssets(outdir);
  await $`cp -R migrations ${outdir}/migrations`;
}

async function buildSingle(outdir: string, buildFlags: BundleFlags): Promise<void> {
  await cleanDir(outdir);
  await runBuild(
    [
      "./index.html",
      "--compile",
      "--target=browser",
      "--outdir",
      outdir,
      "--minify",
      "--env=GAMES_BUNDLE_*",
    ],
    buildFlags,
  );
}

async function buildAnalyze(outdir: string, buildFlags: BundleFlags): Promise<void> {
  await cleanDir(outdir);
  await $`mkdir -p reports/build`;
  await runBuild(
    [
      "./index.html",
      "--outdir",
      outdir,
      "--minify",
      "--splitting",
      "--metafile=reports/build/client.metafile.json",
      "--metafile-md=reports/build/client.metafile.md",
      "--env=GAMES_BUNDLE_*",
    ],
    buildFlags,
  );
  await copyPublicAssets(outdir);
}

async function cleanDir(path: string): Promise<void> {
  await $`rm -rf ${path}`;
  await $`mkdir -p ${path}`;
}

async function copyPublicAssets(outdir: string): Promise<void> {
  await Bun.write(`${outdir}/favicon.svg`, Bun.file("src/ui/favicon.svg"));
}

async function runBuild(args: string[], buildFlags: BundleFlags): Promise<void> {
  const proc = Bun.spawn(["bun", "build", ...args], {
    env: buildEnv(buildFlags),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`bun build failed with exit code ${code}`);
}

function buildEnv(buildFlags: BundleFlags): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    GAMES_BUNDLE_ONLINE: String(buildFlags.online),
    GAMES_BUNDLE_PWA: String(buildFlags.pwa),
    GAMES_BUNDLE_STATIC_LITE: String(buildFlags.staticLite),
  };
}

function bundleFlags(): BundleFlags {
  const staticLite = envBool("GAMES_BUNDLE_STATIC_LITE", false);
  return {
    staticLite,
    online: staticLite ? false : envBool("GAMES_BUNDLE_ONLINE", true),
    pwa: staticLite ? false : envBool("GAMES_BUNDLE_PWA", true),
  };
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}
