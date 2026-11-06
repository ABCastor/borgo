// The chart code the MCP App view runs: src/agent/chart.ts with its types stripped, read from the sources.
// The npm package has no sources to read: scripts/build-npm.ts swaps this module for the same code compiled ahead.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { ROOT } from "../agent/dataset.ts";

export function chartSource(): string {
  return stripTypeScriptTypes(readFileSync(join(ROOT, "src/agent/chart.ts"), "utf8"));
}
