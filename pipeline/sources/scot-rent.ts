// Average private rents in Edinburgh from the Scottish Government's Private Sector Rent Statistics (OGL v3): the mean
// monthly rent of one- and three-bedroom homes in the Lothian Broad Rental Market Area (Edinburgh, Midlothian and East
// Lothian) over the year to the end of September, mostly advertised rents of homes let in that year. ONS's price index
// of private rents (pipeline/sources/ons-rent.ts) publishes Scotland only as a whole, so Edinburgh's figure comes from here.
import { getText, isMain, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const PUBLICATION = (year: number) => `https://www.gov.scot/publications/private-sector-rent-statistics-scotland-2010-to-${year}/documents/`;
/** Seed city -> the Broad Rental Market Area that holds it, and the words its note uses. */
export const AREAS: Record<string, { brma: string; words: string }> = {
  "edinburgh-gb": { brma: "Lothian", words: "Lothian Broad Rental Market Area (Edinburgh, Midlothian and East Lothian)" },
};
const BEDS = { rent_1bed: "1 Bedroom", rent_3bed: "3 Bedroom" } as const;

/** The latest year's mean rents for one area from the publication's open-data CSV (BRMA,Year,Measure,Beds,Value). */
export function scotRents(csv: string, brma: string): { year: string; rent_1bed?: { value: number; records: number }; rent_3bed?: { value: number; records: number } } | null {
  const rows = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
  const mine = rows.filter((r) => r[0] === brma);
  const year = mine.map((r) => r[1]!).sort().at(-1);
  if (!year) return null;
  const pick = (beds: string, measure: string) => Number(mine.find((r) => r[1] === year && r[3] === beds && r[2] === measure)?.[4]);
  const out: ReturnType<typeof scotRents> = { year };
  for (const [metric, beds] of Object.entries(BEDS) as [keyof typeof BEDS, string][]) {
    const value = pick(beds, "Mean");
    if (Number.isFinite(value) && value > 0) out[metric] = { value: Math.round(value), records: pick(beds, "Number of Records") };
  }
  return out;
}

/** Observations for every seed city with an area, from the CSV. */
export function scotObservations(csv: string, cities: City[], retrieved: string): ObservationFile {
  const out: ObservationFile = { source: "scot-prs", retrieved, observations: {} };
  for (const c of cities) {
    const a = AREAS[c.id];
    const r = a && scotRents(csv, a.brma);
    if (!a || !r) continue;
    const list: Observation[] = [];
    for (const metric of ["rent_1bed", "rent_3bed"] as const) {
      const f = r[metric];
      if (f) list.push({ metric, value: f.value, period: r.year, level: "metro", source: "scot-prs", retrieved, note: `${a.words}, mean monthly rent of ${BEDS[metric].toLowerCase()} homes in the year to September ${r.year}, mostly advertised rents (${f.records} records)` });
    }
    if (list.length) out.observations[c.id] = list;
  }
  return out;
}

/** The newest publication's open-data CSV: tries this year's edition first, then the years before. */
async function latestCsv(): Promise<string> {
  for (let y = new Date().getUTCFullYear(); y >= new Date().getUTCFullYear() - 3; y--) {
    let page: string;
    try {
      page = await getText(PUBLICATION(y));
    } catch {
      continue;
    }
    const href = page.match(/href="([^"]*Open%2BData\.csv)"/)?.[1];
    if (href) return getText(`https://www.gov.scot${href}`);
  }
  throw new Error("Private Sector Rent Statistics: no open-data CSV found");
}

if (isMain(import.meta.url)) {
  const out = scotObservations(await latestCsv(), await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/scot-rent.json", out);
}
