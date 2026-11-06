// Builds the npm package's one program: bin/borgo.ts and everything it imports, the MCP SDK and zod included,
// bundled into build/npm/borgo.js as plain JavaScript, so `npx -y borgo` runs on Node without type stripping
// and installs no dependencies. The licences of the bundled packages go beside it (THIRD-PARTY-LICENSES.txt).
// The bundle sits two folders below the package root, as src/<dir>/<file>.ts does below the repository, so every
// path the sources build from import.meta.url (the dataset, the registry, the map) still lands on the package root.
// Runs before every npm pack and npm publish (prepack in package.json).
import { build, transform } from "esbuild";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "build/npm");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { engines: { node: string } };
const target = `node${/\d+/.exec(pkg.engines.node)![0]}`;

// The MCP App view runs src/agent/chart.ts in the host's iframe: compile it now, as the sources strip it at runtime.
const chart = (await transform(readFileSync(join(ROOT, "src/agent/chart.ts"), "utf8"), { loader: "ts", format: "esm", target: "es2022" })).code;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const result = await build({
  absWorkingDir: ROOT,
  entryPoints: ["bin/borgo.ts"],
  outfile: join(OUT, "borgo.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target,
  metafile: true,
  legalComments: "none",
  // One file is the whole program, so it is always the main module: src/mcp/stdio.ts must not start a server on load.
  define: { "import.meta.main": "false" },
  // The bundled CommonJS packages (express, ajv) call require for Node's own modules.
  banner: { js: 'import { createRequire as __borgoRequire } from "node:module";\nconst require = __borgoRequire(import.meta.url);' },
  plugins: [{
    name: "compiled-chart",
    setup(b) {
      b.onLoad({ filter: /src[\\/]mcp[\\/]chart-source\.ts$/ }, () => ({ contents: `export const chartSource = () => ${JSON.stringify(chart)};`, loader: "js" }));
    },
  }],
});

// Every bundled package with its licence text, as their licences ask.
const packages = new Map<string, string>();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /^(.*node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/@][^\\/]*)[\\/]/.exec(input);
  if (m) packages.set(m[1]!, m[1]!);
}
const notices: string[] = [];
for (const dir of [...packages.keys()].sort()) {
  const abs = join(ROOT, dir);
  const meta = JSON.parse(readFileSync(join(abs, "package.json"), "utf8")) as { name: string; version: string; license?: string };
  const file = readdirSync(abs).find((f) => /^licen[cs]e/i.test(f));
  if (!file) throw new Error(`${meta.name} has no licence file to ship beside the bundle.`);
  notices.push(`${meta.name} ${meta.version} (${meta.license ?? "see below"})\n\n${readFileSync(join(abs, file), "utf8").trim()}\n`);
}
await writeFile(join(OUT, "THIRD-PARTY-LICENSES.txt"), `The npm package's build/npm/borgo.js bundles these packages, each under its own licence.\n\n${notices.join(`\n${"-".repeat(80)}\n\n`)}`);

const size = readFileSync(join(OUT, "borgo.js")).length;
if (!existsSync(join(OUT, "borgo.js")) || !readFileSync(join(OUT, "borgo.js"), "utf8").startsWith("#!/usr/bin/env node")) throw new Error("build/npm/borgo.js must start with its #! line.");
console.log(`built build/npm/borgo.js (${(size / 1024).toFixed(0)} KB, target ${target}) with ${notices.length} bundled packages`);
