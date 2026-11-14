// Community figures from the CLI and the MCP server, through the real Worker over a stand-in database: an agent or a
// command sends nothing without the person's yes, and once sent the figures are reviewed and readable back.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadDataset, ROOT } from "../src/agent/dataset.ts";
import { createServer as mcpServer } from "../src/mcp/server.ts";
import { handle } from "../src/site/worker.ts";
import { envWith, workerFetch } from "./fake-d1.ts";

type Structured = { structuredContent: Record<string, any>; content: { text: string }[] };

test("MCP: submit_figures sends nothing without confirm, then sends, reviews and reads back; remove_figures takes it back", async () => {
  const env = envWith();
  const f = workerFetch(env);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcpServer(loadDataset(), { communityFetch: f }).connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  const args = { city: "Turin", rent: { amount: 950, bedrooms: "1", area: "centre" }, salary: { amount: 2400, occupation: "software" } };
  const draft = (await client.callTool({ name: "submit_figures", arguments: args })) as unknown as Structured;
  assert.equal(draft.structuredContent.sent, false);
  assert.match(draft.content[0]!.text, /Not sent[\s\S]*confirm true/);
  assert.match(draft.content[0]!.text, /no name, email, account or IP address/);
  assert.equal(f.calls.length, 0, "a draft reaches no server");
  const sent = (await client.callTool({ name: "submit_figures", arguments: { ...args, confirm: true } })) as unknown as Structured;
  assert.equal(sent.structuredContent.sent, true, sent.content[0]!.text);
  assert.deepEqual(f.calls, ["POST /api/community/submit"]);
  assert.equal((env.db.raw.prepare("SELECT via FROM entries LIMIT 1").get() as { via: string }).via, "mcp");
  const read = (await client.callTool({ name: "community_figures", arguments: { city: "turin-it" } })) as unknown as Structured;
  assert.match(read.content[0]!.text, /Rent, 1 bedroom in the centre, a month \| 950 EUR \| 1 entry/);
  const removed = (await client.callTool({ name: "remove_figures", arguments: { code: sent.structuredContent.answer.removal } })) as unknown as Structured;
  assert.equal(removed.structuredContent.removed, 2);
});

test("CLI: borgo submit prints the draft without --yes and sends with it; borgo community reads it back", async () => {
  const env = envWith();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await handle(new Request(`https://borgo.abcastor.com${req.url}`, { method: req.method, headers: { "content-type": String(req.headers["content-type"] ?? ""), "cf-connecting-ip": "192.0.2.60" }, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const cli = (...args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((ok) => {
      const p = spawn(process.execPath, [join(ROOT, "bin/borgo.ts"), ...args], { cwd: ROOT, env: { ...process.env, BORGO_ORIGIN: origin } });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("close", (status) => ok({ status, stdout, stderr }));
    });
  try {
    const draft = await cli("submit", "Turin", "--rent", "950", "--price", "cappuccino=1.6");
    assert.equal(draft.status, 0, draft.stderr);
    assert.match(draft.stdout, /# Draft[\s\S]*Not sent/);
    assert.equal((env.db.raw.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n, 0);
    const sent = await cli("submit", "Turin", "--rent", "950", "--price", "cappuccino=1.6", "--yes", "--json");
    assert.equal(sent.status, 0, sent.stderr);
    const body = JSON.parse(sent.stdout);
    assert.equal(body.sent, true);
    assert.equal(body.answer.figures.length, 2);
    const read = await cli("community", "turin-it");
    assert.match(read.stdout, /Cappuccino in a café \| 1\.6 EUR \| 1 entry/);
    const bad = await cli("submit", "Turin", "--rent", "99999", "--yes");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /plausible/);
    const gone = await cli("community", "remove", body.answer.removal);
    assert.match(gone.stdout, /Removed 2 entries/);
  } finally {
    server.close();
  }
});

test("CLI: --take-home needs --occupation, and help lists the community commands", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "bin/borgo.ts"), "submit", "Turin", "--take-home", "2400"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--occupation/);
  const h = spawnSync(process.execPath, [join(ROOT, "bin/borgo.ts"), "--help"], { cwd: ROOT, encoding: "utf8" });
  assert.match(h.stdout, /borgo submit <city>[\s\S]*borgo community <city>/);
});
