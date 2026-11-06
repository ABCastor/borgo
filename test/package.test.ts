// The npm package and its MCP Registry entry agree with each other and with what the sources read at runtime.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const server = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf8"));

test("package: public, both commands run the one bundle, and every file it ships exists", () => {
  assert.equal(pkg.private, undefined);
  assert.deepEqual(pkg.bin, { borgo: "build/npm/borgo.js", "where-to-live": "build/npm/borgo.js" });
  assert.equal(pkg.scripts.prepack, "node scripts/build-npm.ts");
  for (const f of pkg.files as string[]) if (!f.startsWith("build/") && !f.includes("*")) assert.ok(existsSync(join(ROOT, f)), `${f} is in files but not in the repository`);
  // What the CLI and the MCP server read beside the code: the snapshot and its parts, the map's towns, the registry.
  for (const f of ["public/data/dataset.json", "public/data/dataset-*.json", "public/data/licences.json", "public/data/map.json", "registry/", "data/cities.json", "data/countries.json"]) assert.ok(pkg.files.includes(f), `${f} must ship`);
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, "the bundle carries its dependencies");
});

test("package: server.json names the npm package, its version and the mcp command, within the registry's limits", () => {
  assert.equal(server.name, pkg.mcpName);
  assert.equal(server.version, pkg.version);
  assert.ok(server.description.length <= 100);
  const [npm, ...others] = server.packages;
  assert.equal(others.length, 0);
  assert.deepEqual({ registryType: npm.registryType, identifier: npm.identifier, version: npm.version, transport: npm.transport, args: npm.packageArguments }, { registryType: "npm", identifier: pkg.name, version: pkg.version, transport: { type: "stdio" }, args: [{ type: "positional", value: "mcp" }] });
});
