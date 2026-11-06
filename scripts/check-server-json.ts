// Checks server.json, Borgo's entry in the MCP Registry, against the JSON schema it names (fetched from
// static.modelcontextprotocol.io) and against package.json: the same name as mcpName, the same version.
// Usage: node scripts/check-server-json.ts
import { Ajv } from "ajv";
import addFormatsModule from "ajv-formats";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const res = await fetch(server.$schema, { signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`${server.$schema}: ${res.status} ${res.statusText}`);
const ajv = new Ajv({ strict: false, allErrors: true });
// ajv-formats is CommonJS: its function is the default export, or that export's own default.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (a: Ajv) => void;
addFormats(ajv);
const validate = ajv.compile(await res.json());

const problems: string[] = [];
if (!validate(server)) problems.push(...(validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`));
if (server.name !== pkg.mcpName) problems.push(`name ${server.name} is not package.json's mcpName ${pkg.mcpName}`);
if (server.version !== pkg.version) problems.push(`version ${server.version} is not package.json's ${pkg.version}`);
for (const p of server.packages ?? []) {
  if (p.registryType === "npm" && p.identifier !== pkg.name) problems.push(`npm package ${p.identifier} is not package.json's name ${pkg.name}`);
  if (p.registryType === "npm" && p.version !== pkg.version) problems.push(`npm package version ${p.version} is not package.json's ${pkg.version}`);
}
if (problems.length) {
  console.error(`server.json fails ${server.$schema}:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`server.json is valid against ${server.$schema} and matches package.json (${pkg.name} ${pkg.version}, ${pkg.mcpName})`);
