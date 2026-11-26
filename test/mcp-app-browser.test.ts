// The MCP App view in a real browser against a host stub (test/mcp-app-host.ts): every interaction and the JSON-RPC it
// sends (test/mcp-app-scenarios.ts). Needs Playwright (PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs, optionally
// BROWSER=chromium|webkit|firefox); without it these tests are skipped, not passed, and say so.
import { after, before, test } from "node:test";
import { borgoServer, launch, loadPlaywright, type Server } from "./mcp-app-host.ts";
import { SCENARIOS } from "./mcp-app-scenarios.ts";

const playwright = await loadPlaywright();
const skip = playwright ? false : "Playwright is not installed: set PLAYWRIGHT_MODULE to its index.mjs to run the browser tests";
let browser: any;
let server: Server;
before(async () => {
  if (!playwright) return;
  browser = await launch(playwright);
  server = await borgoServer();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

for (const theme of ["light", "dark"] as const)
  for (const s of SCENARIOS) test(`${theme}: ${s.name}`, { skip, timeout: 120_000 }, () => s.run({ browser, server, theme }));
