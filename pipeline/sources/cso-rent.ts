// Average monthly rent of new tenancies registered with Ireland's Residential Tenancies Board,
// published by the CSO (table RIA02), CC BY 4.0.
import { getJson, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";

interface Stat { id: string[]; size: number[]; value: (number | null)[]; dimension: Record<string, { category: { index: Record<string, number> | string[]; label: Record<string, string> } }> }

const AREAS: Record<string, string> = { "dublin-ie": "Dublin", "cork-ie": "Cork City" };
const BEDS: Record<string, string> = { rent_1bed: "One bed", rent_3bed: "Three bed" };

const d = await getJson<Stat>("https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIA02/JSON-stat/2.0/en");
const index = (dim: string) => {
  const cat = d.dimension[dim]!.category;
  const keys = Array.isArray(cat.index) ? cat.index : Object.keys(cat.index).sort((a, b) => (cat.index as Record<string, number>)[a]! - (cat.index as Record<string, number>)[b]!);
  return keys.map((k) => ({ key: k, label: cat.label[k]! }));
};
const dims = d.id.map(index);
const at = (labels: string[]) => {
  let i = 0;
  d.id.forEach((_, n) => {
    const pos = dims[n]!.findIndex((x) => x.label === labels[n]);
    i = i * d.size[n]! + pos;
  });
  return d.value[i] ?? null;
};
const years = dims[1]!.map((x) => x.label);

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "cso-rtb", retrieved, observations: {} };
for (const c of cities) {
  const area = AREAS[c.id];
  if (!area) continue;
  const obs: Observation[] = [];
  for (const [metric, beds] of Object.entries(BEDS)) {
    for (const y of [...years].reverse()) {
      const v = at(["RTB Average Monthly Rent Report", y, beds, "All property types", area]);
      if (v !== null) {
        obs.push({ metric, value: Math.round(v), period: y, level: "city", source: "cso-rtb", retrieved, note: `${area}, new tenancies registered with the RTB` });
        break;
      }
    }
  }
  out.observations[c.id] = obs;
  console.log(c.id, obs.map((o) => `${o.metric}=${o.value}(${o.period})`).join(" "));
}
await writeJson("data/observations/cso-rent.json", out);
