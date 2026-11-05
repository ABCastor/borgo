// The repository as the proposal checks see it, read from disk (Node: the workflow, the CLI, the MCP server, tests).
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { METRICS } from "../core/metrics.ts";
import type { City, Country } from "../core/types.ts";
import { loadRegistry } from "../registry/load.ts";
import type { Correction, CorrectionsFile } from "./apply.ts";
import type { RepoView } from "./proposal.ts";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Files a proposal may name: anything committed, never dependencies, build output or git's own files. */
const OUTSIDE = /^(node_modules|dist|\.git|public\/data)(\/|$)/;

export function repoView(root = REPO_ROOT): RepoView {
  const cities = JSON.parse(readFileSync(join(root, "data/cities.json"), "utf8")) as City[];
  const countries = JSON.parse(readFileSync(join(root, "data/countries.json"), "utf8")) as Record<string, Country>;
  return {
    metrics: METRICS,
    cities: new Map(cities.map((c) => [c.id, c.country])),
    currency: (country) => countries[country]?.currency,
    registry: loadRegistry(join(root, "registry")).entries,
    read(path) {
      const abs = resolve(root, path);
      const rel = relative(root, abs);
      if (rel.startsWith("..") || OUTSIDE.test(rel) || !existsSync(abs)) return null;
      const st = statSync(abs);
      if (!st.isFile() || st.size > 2_000_000) return null;
      return readFileSync(abs, "utf8");
    },
  };
}

/** The corrections accepted so far (data/corrections.json), for list_stale. */
export function loadCorrections(root = REPO_ROOT): Correction[] {
  const path = join(root, "data/corrections.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as CorrectionsFile).corrections : [];
}
