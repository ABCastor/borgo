// The seed cities' family figures for the committed snapshot, with the fetchers a person runs: childcare after public
// support (OECD), paid leave for parents (OECD Family Database), public holidays (Nager.Date) and paid holiday by law
// (the labour codes in src/fetch/family.ts). Country figures are fetched once per country.
import { readJson, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";
import { makeCtx, type Fetcher } from "../../src/fetch/context.ts";
import { readFile } from "node:fs/promises";
import { labourLaw, nagerHolidays, nccObservations, nccUrl, OECD_TAXBEN } from "../../src/fetch/family.ts";
import { diskBulkCache } from "../../src/fetch/node/cache.ts";
import { oecdFamily } from "../../src/fetch/node/oecd-family.ts";

const cities = await readJson<City[]>("data/cities.json");
const ctx = makeCtx({ runtime: "node", bulkCache: diskBulkCache() });
const retrieved = new Date().toISOString().slice(0, 10);

async function run(f: Fetcher, file: string, perCountry: boolean): Promise<void> {
  const out: ObservationFile = { source: f.source, retrieved, observations: {} };
  const seen = new Map<string, Observation[]>();
  for (const c of cities) {
    if (f.covers && !f.covers(c)) continue;
    const key = perCountry ? c.country : `${c.country}|${c.region ?? ""}`;
    if (!seen.has(key)) {
      try {
        seen.set(key, await f.fetch(c, ctx));
      } catch (e) {
        console.error(`${f.source} ${c.id}: ${(e as Error).message}`);
        seen.set(key, []);
      }
    }
    const got = seen.get(key)!;
    if (got.length) out.observations[c.id] = got;
  }
  await writeJson(`data/observations/${file}.json`, out);
  console.log(`${f.source}: ${Object.keys(out.observations).length} cities`);
}

// Childcare: one request for every country (the OECD limits request rates), or a saved copy of it (NCC_CSV=path).
{
  const from = new Date().getUTCFullYear() - 4;
  const all = nccUrl("", from);
  const csv = process.env.NCC_CSV ? await readFile(process.env.NCC_CSV, "utf8") : await ctx.text(all);
  const out: ObservationFile = { source: "oecd-childcare", retrieved, observations: {} };
  // The whole table is large: split it by country once, keeping the header for each.
  const [head, ...rows] = csv.split(/\r?\n/);
  const byArea = new Map<string, string[]>();
  for (const r of rows) {
    const area = /^[^,]*,[^,]*,[^,]*,[^,]*,([A-Z]{3}),/.exec(r)?.[1];
    if (area) (byArea.get(area) ?? byArea.set(area, []).get(area)!).push(r);
  }
  for (const c of cities) {
    const iso3 = OECD_TAXBEN[c.country];
    if (!iso3) continue;
    const got = nccObservations([head, ...(byArea.get(iso3) ?? [])].join("\n"), iso3, { retrieved: new Date().toISOString(), url: nccUrl(iso3, from) });
    if (got.length) out.observations[c.id] = got;
  }
  await writeJson("data/observations/oecd-childcare.json", out);
  console.log(`oecd-childcare: ${Object.keys(out.observations).length} cities`);
}
await run(oecdFamily, "oecd-family", true);
await run(nagerHolidays, "nager-date", false);
await run(labourLaw, "labour-law", true);
