// The seed cities' snapshot for two "work and ambition" lines, with the fetchers a person runs: developers on GitHub
// (src/fetch/github.ts) and, as the country stand-in for adults with a degree, the World Bank's tertiary attainment
// (src/fetch/country.ts). GitHub's unauthenticated search allows 10 requests a minute, so requests are spaced out:
// about 15 minutes for the 57 cities.
// Run: node pipeline/sources/ambition.ts [github|degrees]
import { readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";
import { makeCtx, type FetchCtx } from "../../src/fetch/context.ts";
import { worldBank } from "../../src/fetch/country.ts";
import { github } from "../../src/fetch/github.ts";

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const only = process.argv[2];
const base = makeCtx({ runtime: "node" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const spaced: FetchCtx = {
  ...base,
  async json(url, init) {
    if (url.startsWith("https://api.github.com/")) await sleep(6_500);
    return base.json(url, init);
  },
};
const strip = (list: Observation[]) => list.map(({ fetcher: _, ...o }) => ({ ...o, retrieved }));

if (!only || only === "github") {
  const out: ObservationFile = { source: "github", retrieved, observations: {} };
  for (const c of cities) {
    const got = strip(await github.fetch(c, spaced));
    if (got.length) out.observations[c.id] = got;
    console.log(c.id.padEnd(18), got.map((o) => `${o.value} (${o.note})`).join("") || "no figure: the name is shared with another large place");
  }
  await writeJson("data/observations/github.json", out);
}

if (!only || only === "degrees") {
  const out: ObservationFile = { source: "worldbank-wdi", retrieved, observations: {} };
  const byCountry = new Map<string, Observation[]>();
  for (const c of cities) {
    if (!byCountry.has(c.country)) byCountry.set(c.country, strip((await worldBank.fetch(c, base)).filter((o) => o.metric === "degree_share")));
    const got = byCountry.get(c.country)!;
    if (got.length) out.observations[c.id] = got;
  }
  await writeJson("data/observations/worldbank-education.json", out);
  for (const [cc, l] of byCountry) console.log(cc, l.map((o) => `${o.value}@${o.period}`).join(" ") || "none");
}
