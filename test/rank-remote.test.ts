import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadDataset } from "../src/agent/dataset.ts";
import { createServer } from "../src/mcp/server.ts";
import type { Ranking } from "../src/agent/rank.ts";
import { remoteHarness, EXAMPLES } from "./mcp-harness.ts";

test("rank_cities: three real questions run through remote HTTP and match local stdio tools", async () => {
  const remote = await remoteHarness();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer(loadDataset(undefined, { cache: false }));
  await server.connect(b);
  const local = new Client({ name: "rank-local", version: "1" });
  await local.connect(a);
  try {
    const tools = (await remote.client.listTools()).tools;
    const tool = tools.find((t) => t.name === "rank_cities")!;
    assert.equal((tool._meta?.ui as { resourceUri: string }).resourceUri, "ui://borgo/compare.html");
    const expected = ["Los Angeles", "Naples", "Tokyo"];
    for (const [i, example] of EXAMPLES.entries()) {
      const ask = { name: "rank_cities", arguments: example.arguments };
      const result = await remote.client.callTool(ask);
      assert.notEqual(result.isError, true);
      const r = result.structuredContent as unknown as Ranking;
      assert.equal(r.rows[0]!.name, expected[i], example.question);
      assert.equal(r.rows.length, 5);
      assert.deepEqual(result, await local.callTool(ask));
      assert.ok(r.rows.every((row) => row.sources.length > 0));
    }
    const bad = await remote.client.callTool({ name: "rank_cities", arguments: { metric: "nice_bins_air" } });
    assert.equal(bad.isError, true);
    const invalid = await remote.client.callTool({ name: "rank_cities", arguments: { metric: "rent_1bed", limit: 0 } });
    assert.equal(invalid.isError, true);
  } finally { await remote.close(); await local.close(); await server.close(); }
});
