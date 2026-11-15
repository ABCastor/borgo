// The MCP server on the web (src/mcp/remote.ts, /mcp on the Worker), driven by the official SDK client over
// Streamable HTTP into the Worker's own handler: the same answers as the person's own server, the community send
// only after a yes, a per-network limit, and nothing kept but counts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadDataset, ROOT } from "../src/agent/dataset.ts";
import { createServer } from "../src/mcp/server.ts";
import { countedAs, MCP_MAX_BODY, resetMcpData, tally, VIEW_FILE } from "../src/mcp/remote.ts";
import { LOCAL_HINT, SERVER_VERSION, SHARED_TOOLS } from "../src/mcp/tools.ts";
import { viewHtml } from "../src/mcp/view.ts";
import { handle, type Env } from "../src/site/worker.ts";
import { envWith, META } from "./fake-d1.ts";

const ORIGIN = "https://borgo.abcastor.com";

/** The Worker's environment with the published data served from public/data, as the static host serves dist/data. */
function remoteEnv(limit?: (key: string) => boolean) {
  resetMcpData();
  const base = envWith();
  const reads: string[] = [];
  const env: Env & { db: typeof base.db; reads: string[] } = {
    ...base,
    reads,
    ASSETS: {
      async fetch(request) {
        const { pathname } = new URL(request.url);
        reads.push(pathname);
        if (pathname === VIEW_FILE) return new Response(viewHtml(), { headers: { "content-type": "text/plain" } });
        if (pathname.startsWith("/data/")) {
          try {
            return new Response(readFileSync(join(ROOT, "public", pathname)), { headers: { "content-type": "application/json" } });
          } catch {
            return new Response("not found", { status: 404 });
          }
        }
        return base.ASSETS.fetch(request);
      },
    },
    ...(limit ? { MCP_LIMIT: { limit: async ({ key }: { key: string }) => ({ success: limit(key) }) } } : {}),
  };
  return env;
}

/** Waits for what the Worker leaves running after its answer (the counts). */
function waiter() {
  const jobs: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void jobs.push(p), done: () => Promise.all(jobs) };
}

/** A fetch into the Worker from one network. */
function into(env: Env, w = waiter(), ip = "198.51.100.7"): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const headers = new Headers(req.headers);
    headers.set("cf-connecting-ip", ip);
    return handle(new Request(req.url, { method: req.method, headers, body: req.method === "POST" ? await req.text() : undefined }), env, w);
  }) as typeof fetch;
}

async function remoteClient(env: Env, w = waiter()) {
  const client = new Client({ name: "test-remote", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: into(env, w) }));
  return client;
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

test("remote mcp: the SDK client connects at /mcp and sees the published-data tools only", async () => {
  const env = remoteEnv();
  const client = await remoteClient(env);
  assert.equal(client.getServerVersion()?.name, "borgo");
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.deepEqual(names, [...SHARED_TOOLS]);
  for (const local of ["fetch_city", "record_observation", "list_stale", "propose_change"]) assert.ok(!(names as string[]).includes(local), `${local} needs the person's machine`);
  const how = client.getInstructions() ?? "";
  assert.match(how, /^Borgo compares/);
  assert.doesNotMatch(how, /record_observation|propose_change|list_stale/);
  assert.match(how, /npx -y @abcastor\/borgo mcp/);
  const view = await client.readResource({ uri: "ui://borgo/compare.html" });
  assert.match((view.contents[0] as { text: string }).text, /^<!doctype html>/);
  await client.close();
});

test("remote mcp: compare_cities and get_city answer exactly as the person's own server does", async () => {
  const env = remoteEnv();
  const remote = await remoteClient(env);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(loadDataset(undefined, { cache: false })).connect(b);
  const local = new Client({ name: "test-local", version: "0" });
  await local.connect(a);
  const asks = [
    { name: "compare_cities", arguments: { cities: ["Lisbon", "Berlin", "Turin"], salary: { amount: 60000, currency: "EUR" }, household: [{ passports: ["IT"] }] } },
    { name: "get_city", arguments: { city: "Lisbon", metrics: ["rent_1bed", "pm25"] } },
    { name: "net_pay", arguments: { country: "IT", city: "Milan", gross: 50000 } },
  ];
  for (const ask of asks) {
    const r = await remote.callTool(ask);
    const l = await local.callTool(ask);
    assert.equal(r.isError, undefined, text(r));
    assert.deepEqual(r.structuredContent, l.structuredContent, `${ask.name} is the same remotely`);
    assert.equal(text(r), text(l));
  }
  await remote.close();
  await local.close();
});

test("remote mcp: a place outside the published data points to the local server, never to a tool it lacks", async () => {
  const client = await remoteClient(remoteEnv());
  const miss = await client.callTool({ name: "search_cities", arguments: { query: "Ouagadougou" } });
  assert.ok(text(miss).includes(LOCAL_HINT));
  const bad = await client.callTool({ name: "get_city", arguments: { city: "Ouagadougou" } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /No city in Borgo's published data matches "Ouagadougou"/);
  assert.ok(text(bad).includes("npx -y @abcastor/borgo mcp"));
  await client.close();
});

test("remote mcp: submit_figures sends nothing without confirm, then once, through the inbox's own limits", async () => {
  const env = remoteEnv();
  const client = await remoteClient(env);
  const ask = { city: "Turin", rent: { amount: 900, bedrooms: "1", area: "centre" } };
  const draft = await client.callTool({ name: "submit_figures", arguments: ask });
  assert.match(text(draft), /^# Draft/);
  assert.equal(env.db.raw.prepare("SELECT COUNT(*) AS n FROM entries").get()!.n, 0);
  const sent = await client.callTool({ name: "submit_figures", arguments: { ...ask, confirm: true } });
  assert.match(text(sent), /^# Sent/, text(sent));
  const rows = env.db.raw.prepare("SELECT city, figure, value, via FROM entries").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ city: "turin-it", figure: "rent.1.centre", value: 900, via: "mcp" }]);
  // The inbox counted the caller's network (salted), not the Worker's.
  const salt = (env.db.raw.prepare("SELECT salt FROM salts").get() as { salt: string }).salt;
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|198.51.100.7`))).toString("hex").slice(0, 32);
  assert.deepEqual(env.db.raw.prepare("SELECT key, n FROM limits ORDER BY key").all().map((r) => ({ ...r })), [{ key: `n:${hash}`, n: 1 }, { key: `p:${hash}:turin-it`, n: 1 }]);
  const code = (sent.structuredContent as { answer: { removal: string } }).answer.removal;
  const gone = await client.callTool({ name: "remove_figures", arguments: { code } });
  assert.match(text(gone), /^Removed 1/);
  assert.ok(META.places["turin-it"]);
  await client.close();
});

test("remote mcp: counts per day and tool, errors included, and nothing about the request", async () => {
  const env = remoteEnv();
  const w = waiter();
  const client = await remoteClient(env, w);
  await client.callTool({ name: "get_city", arguments: { city: "Lisbon", metrics: ["rent_1bed"] } });
  await client.callTool({ name: "get_city", arguments: { city: "Ouagadougou" } });
  await client.close();
  await w.done();
  const rows = env.db.raw.prepare("SELECT * FROM mcp_counts ORDER BY what").all().map((r) => ({ ...r }));
  const day = new Date().toISOString().slice(0, 10);
  assert.deepEqual(rows.find((r) => r.what === "tools/call:get_city"), { day, what: "tools/call:get_city", calls: 2, errors: 1 });
  assert.ok(rows.some((r) => r.what === "initialize"));
  // Only the day, what was called and two numbers: no argument, address or answer anywhere in the database.
  const columns = env.db.raw.prepare("PRAGMA table_info(mcp_counts)").all().map((c) => (c as { name: string }).name);
  assert.deepEqual(columns, ["day", "what", "calls", "errors"]);
  const dump = JSON.stringify(rows);
  for (const leak of ["Lisbon", "Ouagadougou", "198.51.100.7", "rent_1bed"]) assert.ok(!dump.includes(leak), `${leak} is not kept`);
  assert.equal(countedAs({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "secret_tool<script>" } }), "tools/call:other");
  assert.deepEqual(tally([{ id: 1, method: "ping" }, { id: 2, method: "tools/list" }], [{ id: 1, result: {} }, { id: 2, error: { code: 1 } }]), [{ what: "ping", failed: false }, { what: "tools/list", failed: true }]);
});

test("remote mcp: logs nothing while answering", async () => {
  const env = remoteEnv();
  const said: unknown[] = [];
  const kept = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(kept) as (keyof typeof kept)[]) console[k] = (...a: unknown[]) => void said.push(a);
  try {
    const client = await remoteClient(env);
    await client.callTool({ name: "compare_cities", arguments: { cities: ["Lisbon", "Berlin"], salary: { amount: 50000 } } });
    await client.callTool({ name: "get_city", arguments: { city: "Nowhere-on-earth" } });
    await client.close();
  } finally {
    Object.assign(console, kept);
  }
  assert.deepEqual(said, []);
});

test("remote mcp: one network past its limit gets 429 and no answer; others still pass", async () => {
  const seen: string[] = [];
  const env = remoteEnv((key) => (seen.push(key), key !== "203.0.113.9"));
  const w = waiter();
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  const post = (ip: string) => into(env, w, ip)(`${ORIGIN}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body });
  const no = await post("203.0.113.9");
  assert.equal(no.status, 429);
  assert.equal(no.headers.get("retry-after"), "60");
  assert.ok(!env.reads.includes("/data/dataset.json"), "a limited request reads no data");
  const yes = await post("198.51.100.7");
  assert.equal(yes.status, 200);
  assert.deepEqual(await yes.json(), { jsonrpc: "2.0", id: 1, result: {} });
  assert.deepEqual(seen, ["203.0.113.9", "198.51.100.7"]);
  await w.done();
  assert.equal(env.db.raw.prepare("SELECT calls FROM mcp_counts WHERE what = 'limited'").get()!.calls, 1);
});

test("remote mcp: GET and DELETE are 405, preflight is open, oversize and broken bodies are refused", async () => {
  const env = remoteEnv();
  const f = into(env);
  const get = await f(`${ORIGIN}/mcp`);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST, OPTIONS");
  assert.equal((await f(`${ORIGIN}/mcp`, { method: "DELETE" })).status, 405);
  const pre = await f(`${ORIGIN}/mcp`, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  assert.match(pre.headers.get("access-control-allow-headers") ?? "", /mcp-protocol-version/);
  const big = await f(`${ORIGIN}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: `{"x":"${"a".repeat(MCP_MAX_BODY)}"}` });
  assert.equal(big.status, 413);
  const broken = await f(`${ORIGIN}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
  assert.equal(broken.status, 400);
  assert.equal(((await broken.json()) as { error: { code: number } }).error.code, -32700);
  // A client that asks for JSON only is answered in JSON.
  const json = await f(`${ORIGIN}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }) });
  assert.equal(json.status, 200);
  assert.deepEqual(await json.json(), { jsonrpc: "2.0", id: 7, result: {} });
});

test("remote mcp: one version everywhere, and server.json lists the remote beside the npm package", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  const server = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf8")) as { version: string; remotes?: { type: string; url: string }[] };
  assert.equal(SERVER_VERSION, pkg.version);
  assert.equal(server.version, pkg.version);
  assert.deepEqual(server.remotes, [{ type: "streamable-http", url: `${ORIGIN}/mcp` }]);
});
