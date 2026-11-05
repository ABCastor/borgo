// The seed cities' walking and cycling figures from OpenStreetMap (ODbL 1.0, share-alike), with the fetcher a person
// runs (src/fetch/node/osm-walk-cycle.ts): everyday needs on foot and the cycle network. Written to
// data/observations-odbl/ and kept under the ODbL. Two Overpass queries a city, a few minutes together; a busy server
// or a dropped connection is waited out (a minute, then two, up to five tries), and each city merges into the file as
// it finishes, so a stopped run resumes where it left off. Two runs on different cities can share the work.
// Run: node pipeline/sources/osm-walk-cycle.ts [city-id ...]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson, ROOT, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";
import { makeCtx, type FetchCtx } from "../../src/fetch/context.ts";
import { diskBulkCache } from "../../src/fetch/node/cache.ts";
import { OVERPASS, osmWalkCycle } from "../../src/fetch/node/osm-walk-cycle.ts";

const FILE = "data/observations-odbl/osm-walk-cycle.json";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = makeCtx({ runtime: "node", bulkCache: diskBulkCache(), timeout: 600_000, backoff: 20_000 });
const ctx: FetchCtx = {
  ...base,
  async json(url, init) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await base.json(url, init);
      } catch (e) {
        if (url !== OVERPASS || attempt >= 5 || !/\b(429|50\d)\b|no answer|terminated|fetch failed|ETIMEDOUT/.test((e as Error).message)) throw e;
        console.error(`  Overpass busy (${(e as Error).message}); waiting ${attempt} min`);
        await sleep(60_000 * attempt);
      }
    }
  },
};

const cities = await readJson<City[]>("data/cities.json");
const only = process.argv.slice(2);
const retrieved = today();
const load = async (): Promise<ObservationFile> => (existsSync(join(ROOT, FILE)) ? readJson<ObservationFile>(FILE) : { source: "osm-walk-cycle", retrieved, observations: {} });
const done = (await load()).observations;
for (const c of cities) {
  if (only.length ? !only.includes(c.id) : done[c.id]?.length) continue;
  const got = (await osmWalkCycle.fetch(c, ctx)).map(({ fetcher: _, ...o }) => ({ ...o, retrieved }));
  const out = await load(); // re-read: another run may have added cities meanwhile
  out.observations[c.id] = got;
  out.retrieved = retrieved;
  await writeJson(FILE, out);
  console.log(c.id.padEnd(18), got.map((o) => `${o.metric}=${o.value}`).join(" "));
  await sleep(5_000);
}
