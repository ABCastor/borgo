// The seed cities' snapshot for the position lines and the newer country dials, with the fetchers a person runs:
// politics left to right (src/fetch/politics.ts, from the table pipeline/sources/politics.ts builds), abortion in law
// (src/fetch/rights-law.ts), control of corruption (World Bank governance indicators), and doctors and unemployment
// (World Bank WDI). Country figures are fetched once per country.
import { readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";
import { makeCtx, type Fetcher } from "../../src/fetch/context.ts";
import { wgi, worldBank } from "../../src/fetch/country.ts";
import { politics } from "../../src/fetch/politics.ts";
import { abortionLaw } from "../../src/fetch/rights-law.ts";

const cities = await readJson<City[]>("data/cities.json");
const ctx = makeCtx({ runtime: "node" });
const retrieved = today();

async function run(f: Fetcher, file: string, keep?: string[]): Promise<void> {
  const out: ObservationFile = { source: f.source, retrieved, observations: {} };
  const seen = new Map<string, Observation[]>();
  for (const c of cities) {
    if (f.covers && !f.covers(c)) continue;
    const key = `${c.country}|${c.region ?? ""}`;
    if (!seen.has(key)) {
      try {
        seen.set(key, (await f.fetch(c, ctx)).filter((o) => !keep || keep.includes(o.metric)).map(({ fetcher: _, ...o }) => ({ ...o, retrieved })));
      } catch (e) {
        console.error(`${f.source} ${c.id}: ${(e as Error).message}`);
        seen.set(key, []);
      }
    }
    const got = seen.get(key)!;
    if (got.length) out.observations[c.id] = got;
  }
  await writeJson(`data/observations/${file}.json`, out);
  console.log(`${f.source} (${file}): ${Object.keys(out.observations).length} cities`);
}

await run(politics, "politics");
await run(abortionLaw, "abortion-law");
await run(wgi, "worldbank-wgi");
// The older WDI figures stay in worldbank.json; these two lines are added beside them.
await run(worldBank, "worldbank-health-jobs", ["doctors", "unemployment"]);
