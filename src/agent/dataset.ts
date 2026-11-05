// Loads the dataset for agents and terminals: the committed snapshot (built first when a fresh checkout has none)
// plus every place this person has fetched into their own cache (src/fetch/node/cache.ts).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dataset } from "../core/types.ts";
import { withFetched } from "../fetch/index.ts";
import { loadCachedCities } from "../fetch/node/cache.ts";
import { loadPublishedDataset } from "../registry/load.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATASET_PATH = join(ROOT, "public/data/dataset.json");

/** Runs a pipeline script with the same Node, its output kept off stdout (stdout may be an MCP channel). */
export function runScript(rel: string): { ok: boolean; output: string } {
  const r = spawnSync(process.execPath, [join(ROOT, rel)], { cwd: ROOT, encoding: "utf8" });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

export function loadDataset(path = process.env.BORGO_DATASET ?? process.env.WHERE_TO_LIVE_DATASET ?? DATASET_PATH, opts: { cache?: boolean } = {}): Dataset {
  if (!existsSync(path) && path === DATASET_PATH) {
    const r = runScript("pipeline/build-data.ts");
    if (!r.ok) throw new Error(`The dataset is missing and could not be built:\n${r.output}`);
  }
  // dataset.json plus the files beside it whose figures travel under other terms (ODbL, WHO).
  const snapshot = loadPublishedDataset(path);
  return opts.cache === false ? snapshot : withFetched(snapshot, loadCachedCities());
}
