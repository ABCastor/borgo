// An SDK client into the actual remote Streamable HTTP handler, with published assets read from disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ROOT } from "../src/agent/dataset.ts";
import { mcpRemote, resetMcpData, VIEW_FILE } from "../src/mcp/remote.ts";
import { viewHtml } from "../src/mcp/view.ts";

export async function remoteHarness() {
  resetMcpData();
  const jobs: Promise<unknown>[] = [];
  const wait = { waitUntil: (p: Promise<unknown>) => void jobs.push(p) };
  const env = { ASSETS: { async fetch(req: Request) {
    const path = new URL(req.url).pathname;
    if (path === VIEW_FILE) return new Response(viewHtml());
    try { return new Response(readFileSync(join(ROOT, "public", path)), { headers: { "content-type": "application/json" } }); }
    catch { return new Response("Not found", { status: 404 }); }
  } } };
  const into = (async (input: RequestInfo | URL, init?: RequestInit) => mcpRemote(new Request(input, init), env, wait, async () => new Response("No community calls in this harness", { status: 501 }))) as typeof fetch;
  const client = new Client({ name: "rank-remote-harness", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://borgo.abcastor.com/mcp"), { fetch: into }));
  return { client, close: async () => { await client.close(); await Promise.all(jobs); } };
}

export const EXAMPLES = [
  { question: "List cities by number of nice days a year.", arguments: { criterion: "nice_days", view: "months", limit: 5 } },
  { question: "What is the cheapest rent in Europe with over 2,500 sun hours?", arguments: { metric: "rent_1bed", order: "asc", filters: { region: "europe", ranges: [{ metric: "sunshine_hours", min: 2500 }] }, view: "ranked", limit: 5 } },
  { question: "Where does EUR 80,000 a year leave the most after tax and rent? Show it on a world map.", arguments: { criterion: "after_tax_rent", salary: { amount: 80000, currency: "EUR" }, view: "world", limit: 5 } },
];
