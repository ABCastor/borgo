// The seed cities' distance from the centre to the edge of the dense city, from the GHSL Urban Centre Database 2025
// (European Commission JRC, CC BY 4.0), with the fetcher a person runs (src/fetch/node/ghsl.ts). A few seconds for all.
import { readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";
import { makeCtx } from "../../src/fetch/context.ts";
import { diskBulkCache } from "../../src/fetch/node/cache.ts";
import { ghsl } from "../../src/fetch/node/ghsl.ts";

const cities = await readJson<City[]>("data/cities.json");
const ctx = makeCtx({ runtime: "node", bulkCache: diskBulkCache() });
const retrieved = today();
const out: ObservationFile = { source: "ghsl-ucdb", retrieved, observations: {} };
for (const c of cities) {
  const got = (await ghsl.fetch(c, ctx)).map(({ fetcher: _, ...o }) => ({ ...o, retrieved }));
  if (got.length) out.observations[c.id] = got;
  console.log(c.id.padEnd(18), got.map((o) => `${o.value} km: ${o.note}`).join("") || "no figure: the centre point falls in a gap of its urban centre");
}
await writeJson("data/observations/ghsl.json", out);
