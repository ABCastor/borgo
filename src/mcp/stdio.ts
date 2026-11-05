// Runs the MCP server over stdio. Stdout is the protocol channel: nothing else may print to it.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadDataset } from "../agent/dataset.ts";
import { createServer } from "./server.ts";

export async function serve(): Promise<void> {
  const server = createServer(loadDataset());
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) await serve();
