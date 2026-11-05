// Reads the registry from disk (Node: CLI, MCP, pipeline, tests). The browser gets the same entries from
// public/data/registry.json, written by pipeline/build-data.ts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { METRICS } from "../core/metrics.ts";
import type { Dataset, Source } from "../core/types.ts";
import { partFiles, withParts, type PartFile } from "./licences.ts";
import { toSource, validateEntry, type RegistryEntry } from "./schema.ts";

export const REGISTRY_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../registry");

/** The person's own number, which overrides a source: always a valid source of a figure. */
export const YOU: Source = { id: "you", name: "Your own number", publisher: "You", url: "", licence: "Yours", redistributable: true };

export function loadRegistry(dir = REGISTRY_DIR): { entries: RegistryEntry[]; errors: string[] } {
  const ids = new Set(Object.keys(METRICS));
  const entries: RegistryEntry[] = [];
  const errors: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let e: RegistryEntry;
    try {
      e = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (err) {
      errors.push(`${file}: not valid JSON (${(err as Error).message})`);
      continue;
    }
    errors.push(...validateEntry(e, ids, file));
    entries.push(e);
  }
  return { entries, errors };
}

/** Sources by id, as the dataset carries them. */
export function registrySources(entries: RegistryEntry[]): Record<string, Source> {
  return Object.fromEntries([...entries.map((e) => [e.id, toSource(e)] as const), ["you", YOU] as const]);
}

/**
 * The published dataset as the engine reads it: dataset.json plus the files beside it that hold figures under other
 * terms (ODbL, WHO), merged. A part file that is missing costs only its figures.
 */
export function loadPublishedDataset(path: string): Dataset {
  const data = JSON.parse(readFileSync(path, "utf8")) as Dataset;
  const dir = dirname(path);
  const files = partFiles(data)
    .map((f) => join(dir, f.replace(/^data\//, "")))
    .filter((f) => existsSync(f))
    .map((f) => JSON.parse(readFileSync(f, "utf8")) as PartFile);
  return withParts(data, files);
}
