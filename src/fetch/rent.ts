// Official rents for any Irish place the RTB table names: the Residential Tenancies Board's average monthly rent of
// new tenancies, published by the CSO (table RIA02, CC BY 4.0). Matched by name: "<city> City", "<city> Town",
// a locality "<city>, <county>", else the county of the same name (then marked as a region figure).
import type { City, Observation } from "../core/types.ts";
import { fold, type Fetcher } from "./context.ts";

interface Stat { id: string[]; size: number[]; value: (number | null)[]; dimension: Record<string, { category: { index: Record<string, number> | string[]; label: Record<string, string> } }> }

export const CSO_URL = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIA02/JSON-stat/2.0/en";
const BEDS: Record<string, string> = { rent_1bed: "One bed", rent_3bed: "Three bed" };

/** The table's area for a city, and whether it is the place itself or its county. */
export function csoArea(labels: string[], city: City): { label: string; level: "city" | "region" } | null {
  const names = [city.name, ...(city.aliases ?? [])].map(fold);
  const byFold = new Map(labels.map((l) => [fold(l), l]));
  for (const n of names) for (const suffix of [" city", " town"]) if (byFold.has(n + suffix)) return { label: byFold.get(n + suffix)!, level: "city" };
  for (const n of names) {
    const local = labels.find((l) => fold(l.split(",")[0]!) === n && l.includes(","));
    if (local) return { label: local, level: "city" };
  }
  for (const n of names) if (byFold.has(n)) return { label: byFold.get(n)!, level: "region" };
  return null;
}

export function csoObservations(d: Stat, city: City, meta: { retrieved: string; url: string }): Observation[] {
  const dims = d.id.map((dim) => {
    const cat = d.dimension[dim]!.category;
    const keys = Array.isArray(cat.index) ? cat.index : Object.keys(cat.index).sort((a, b) => (cat.index as Record<string, number>)[a]! - (cat.index as Record<string, number>)[b]!);
    return keys.map((k) => cat.label[k]!);
  });
  const area = csoArea(dims[4]!, city);
  if (!area) return [];
  const at = (labels: string[]) => {
    let i = 0;
    for (let n = 0; n < d.id.length; n++) {
      const pos = dims[n]!.indexOf(labels[n]!);
      if (pos < 0) return null;
      i = i * d.size[n]! + pos;
    }
    return d.value[i] ?? null;
  };
  const out: Observation[] = [];
  for (const [metric, beds] of Object.entries(BEDS)) {
    for (const y of [...dims[1]!].reverse()) {
      const v = at([dims[0]![0]!, y, beds, "All property types", area.label]);
      if (v !== null) {
        out.push({ metric, value: Math.round(v), period: y, level: area.level, source: "cso-rtb", retrieved: meta.retrieved, url: meta.url, fetcher: "cso-rtb@1", note: `${area.label}, new tenancies registered with the RTB` });
        break;
      }
    }
  }
  return out;
}

export const csoRent: Fetcher = {
  source: "cso-rtb",
  version: 1,
  runtimes: ["browser", "node"],
  covers: (c) => c.country === "IE",
  async fetch(city, ctx) {
    const d = JSON.parse(new TextDecoder().decode(await ctx.bulk(CSO_URL))) as Stat;
    return csoObservations(d, city, { retrieved: ctx.now().toISOString(), url: CSO_URL });
  },
};
