// The person's own cache, for the CLI and MCP server: fetched places with every figure's provenance, and large files
// downloaded once. Lives outside the repository ($BORGO_HOME, default ~/.cache/borgo; $WHERE_TO_LIVE_HOME is still read) and is never
// committed or uploaded.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BulkCache } from "../context.ts";
import type { CityFetch } from "../index.ts";

export function cacheHome(): string {
  return process.env.BORGO_HOME ?? process.env.WHERE_TO_LIVE_HOME ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "borgo");
}

const citiesDir = () => join(cacheHome(), "cities");

function writeAtomic(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function saveCity(f: CityFetch): string {
  mkdirSync(citiesDir(), { recursive: true });
  const path = join(citiesDir(), `${f.city.id}.json`);
  writeAtomic(path, JSON.stringify(f, null, 2) + "\n");
  return path;
}

export function loadCity(id: string): CityFetch | null {
  const path = join(citiesDir(), `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CityFetch;
}

/** Every place this person has fetched. A damaged file is skipped, not fatal. */
export function loadCachedCities(): CityFetch[] {
  if (!existsSync(citiesDir())) return [];
  const out: CityFetch[] = [];
  for (const f of readdirSync(citiesDir()).filter((x) => x.endsWith(".json"))) {
    try {
      const c = JSON.parse(readFileSync(join(citiesDir(), f), "utf8")) as CityFetch;
      if (c?.city?.id && Array.isArray(c.observations)) out.push(c);
    } catch {
      // ignore a half-written or edited file
    }
  }
  return out;
}

/** Large files on disk, keyed by URL, with the URL and date beside them; older than `maxAgeDays` counts as absent. */
export function diskBulkCache(maxAgeDays = 30): BulkCache {
  const dir = join(cacheHome(), "bulk");
  const key = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 24);
  return {
    async get(url) {
      const p = join(dir, key(url));
      if (!existsSync(p)) return null;
      try {
        const meta = JSON.parse(readFileSync(`${p}.json`, "utf8")) as { fetched: string };
        if (Date.now() - Date.parse(meta.fetched) > maxAgeDays * 86_400_000) return null;
      } catch {
        return null;
      }
      return new Uint8Array(readFileSync(p));
    },
    async set(url, data) {
      mkdirSync(dir, { recursive: true });
      writeAtomic(join(dir, key(url)), data);
      writeFileSync(join(dir, `${key(url)}.json`), JSON.stringify({ url, fetched: new Date().toISOString(), bytes: data.length }) + "\n");
    },
  };
}
