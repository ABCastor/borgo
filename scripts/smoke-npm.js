// Installs the npm package from its tarball into a clean temporary prefix, outside the repository, and runs it as
// a person would: `borgo --help`, `borgo compare Lisbon Berlin`, `where-to-live --help`, and the MCP server over
// stdio (initialize, tools/list, one compare_cities call, the chart view). Plain JavaScript, so any Node the package
// claims to support can run it: the package runs on the Node that runs this script.
// Usage: node scripts/smoke-npm.js <borgo-x.y.z.tgz>     (make the tarball with: npm pack)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const tarball = process.argv[2];
if (!tarball) {
  console.error("usage: node scripts/smoke-npm.js <tarball from npm pack>");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "borgo-smoke-"));
const prefix = join(dir, "prefix");
const bin = (name) => (process.platform === "win32" ? join(prefix, `${name}.cmd`) : join(prefix, "bin", name));
// A fresh home with no Borgo settings: the cache resolves to its default place in that home.
const env = { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` };
for (const k of ["BORGO_HOME", "WHERE_TO_LIVE_HOME", "XDG_CACHE_HOME", "BORGO_DATASET", "WHERE_TO_LIVE_DATASET"]) delete env[k];

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed++;
}
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
  return { status: r.status, out: r.stdout ?? "", err: `${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
}

try {
  console.log(`node ${process.version}, tarball ${resolve(tarball)}, in ${dir}`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const install = run(npm, ["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", resolve(tarball)]);
  check("npm install --global from the tarball", install.status === 0, install.status === 0 ? "" : install.err.slice(-2000));
  if (install.status !== 0) throw new Error("not installed");

  const help = run(bin("borgo"), ["--help"]);
  check("borgo --help", help.status === 0 && help.out.includes("borgo compare"), help.status === 0 ? "" : help.err.slice(-2000));

  const other = run(bin("where-to-live"), ["--help"]);
  check("where-to-live --help", other.status === 0 && other.out.includes("borgo compare"), other.status === 0 ? "" : other.err.slice(-2000));

  const text = run(bin("borgo"), ["compare", "Lisbon", "Berlin"]);
  check("borgo compare Lisbon Berlin", text.status === 0 && /Lisbon/.test(text.out) && /Berlin/.test(text.out), text.status === 0 ? text.out.split("\n").find((l) => l.startsWith("**")) ?? "" : text.err.slice(-2000));

  const json = run(bin("borgo"), ["compare", "Lisbon", "Berlin", "--json"]);
  let names = [];
  try {
    names = JSON.parse(json.out).ranking.map((r) => r.name);
  } catch {}
  check("borgo compare Lisbon Berlin --json", json.status === 0 && names.length === 2 && names.includes("Lisbon") && names.includes("Berlin"), names.join(", ") || json.err.slice(-2000));

  const clone = run(bin("borgo"), ["data", "build"]);
  check("borgo data build says it needs a clone", clone.status === 1 && /clone/.test(clone.err), clone.err.trim().slice(0, 200));

  await mcp();
} catch (e) {
  check("smoke test ran to the end", false, e.message);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);

/** The MCP server over stdio, as a client starts it: `borgo mcp`, newline-delimited JSON-RPC. */
async function mcp() {
  const child = spawn(bin("borgo"), ["mcp"], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const waiting = new Map();
  let buffer = "";
  child.stdout.on("data", (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    }
  });
  let next = 1;
  const request = (method, params) =>
    new Promise((ok, fail) => {
      const id = next++;
      const timer = setTimeout(() => fail(new Error(`${method}: no answer in 60 s. ${stderr.slice(-1000)}`)), 60_000);
      waiting.set(id, (m) => (clearTimeout(timer), ok(m)));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const exited = new Promise((ok) => child.on("exit", (code) => ok(code)));
  try {
    const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "borgo-smoke", version: "0" } });
    check("mcp initialize", init.result?.serverInfo?.name !== undefined && !!init.result?.capabilities?.tools, `${init.result?.serverInfo?.name} ${init.result?.serverInfo?.version}, protocol ${init.result?.protocolVersion}`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    const list = await request("tools/list", {});
    const tools = (list.result?.tools ?? []).map((t) => t.name);
    check("mcp tools/list", tools.includes("compare_cities") && tools.includes("fetch_city"), `${tools.length} tools`);

    const call = await request("tools/call", { name: "compare_cities", arguments: { cities: ["Lisbon", "Berlin"] } });
    const ranked = (call.result?.structuredContent?.ranking ?? []).map((r) => r.name);
    check("mcp tools/call compare_cities", !call.result?.isError && ranked.length === 2 && ranked.includes("Lisbon"), ranked.join(", ") || JSON.stringify(call).slice(0, 500));

    const view = await request("resources/read", { uri: "ui://borgo/compare.html" });
    const html = view.result?.contents?.[0]?.text ?? "";
    check("mcp chart view", /function compareSvg/.test(html) && !/:\s*ChartInput\b/.test(html), `${html.length} characters`);
  } finally {
    child.stdin.end();
    const code = await Promise.race([exited, new Promise((ok) => setTimeout(() => ok("timeout"), 5_000))]);
    if (code === "timeout") child.kill();
    check("mcp server exits cleanly when stdin closes", code === 0, `exit ${code}`);
  }
}
