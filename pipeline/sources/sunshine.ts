// The seed cities' measured sunshine for the committed snapshot, with the fetchers a person runs: the WMO 1991-2020
// normals (src/fetch/sunshine.ts), and Meteostat's normals where no WMO station stands for the city.
import { readJson, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";
import { makeCtx } from "../../src/fetch/context.ts";
import { meteostat } from "../../src/fetch/node/meteostat.ts";
import { wmoSunshine } from "../../src/fetch/sunshine.ts";
import { diskBulkCache } from "../../src/fetch/node/cache.ts";

const cities = await readJson<City[]>("data/cities.json");
const ctx = makeCtx({ runtime: "node", bulkCache: diskBulkCache() });
const retrieved = new Date().toISOString().slice(0, 10);
const wmo: ObservationFile = { source: "wmo-normals", retrieved, observations: {} };
const ms: ObservationFile = { source: "meteostat", retrieved, observations: {} };

for (const c of cities) {
  const a = await wmoSunshine.fetch(c, ctx);
  const b = a.length ? [] : await meteostat.fetch(c, ctx);
  if (a.length) wmo.observations[c.id] = a;
  if (b.length) ms.observations[c.id] = b;
  const got = [...a, ...b].find((o) => o.metric === "sunshine_hours");
  console.log(c.id.padEnd(18), got ? `${String(got.value).padStart(5)} h  ${got.source.padEnd(12)} ${got.note}` : "no station");
}
await writeJson("data/observations/wmo-normals.json", wmo);
await writeJson("data/observations/meteostat.json", ms);
