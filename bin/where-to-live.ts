#!/usr/bin/env node
// The same command as bin/borgo.ts, under its other name.
import { run } from "../src/cli/main.ts";

await run(process.argv.slice(2));
