#!/usr/bin/env node
import { run } from "../src/cli/main.ts";

await run(process.argv.slice(2));
