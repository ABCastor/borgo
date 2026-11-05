// How the law treats same-sex couples, for the seed cities' snapshot: the table and the fetcher live in
// src/fetch/rights-law.ts, so any place a person adds gets the same fact.
import { readJson, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";
import { makeCtx } from "../../src/fetch/context.ts";
import { COUPLES, COUPLES_REVIEWED, couplesLaw } from "../../src/fetch/rights-law.ts";

const cities = await readJson<City[]>("data/cities.json");
const ctx = makeCtx({ runtime: "node", now: () => new Date(`${COUPLES_REVIEWED}T00:00:00Z`) });
const out: ObservationFile = { source: "couples-law", retrieved: COUPLES_REVIEWED, observations: {} };
for (const c of cities) out.observations[c.id] = (await couplesLaw.fetch(c, ctx)).map(({ fetcher: _, ...o }) => ({ ...o, retrieved: COUPLES_REVIEWED }));
await writeJson("data/observations/couples-law.json", out);
console.log(`same-sex couples: ${cities.filter((c) => COUPLES[c.country]).length} of ${cities.length} cities covered`);
