// Commuting, walking and cycling to work, foreign-born residents, adults with a degree and rents of US cities, from
// the American Community Survey 1-year estimates (US Census Bureau, public domain). Read from the summary-file tables,
// which need no API key (the API now does). Shares of commuters use the Eurostat Urban Audit's base, journeys to work,
// so people working from home are left out. Degrees follow the Urban Audit's definition, ISCED 5 to 8 at ages 25 to 64:
// an associate's, bachelor's or graduate degree.
// Rents: B25031, median gross rent (contract rent plus utilities) of renter-occupied homes paying cash rent, by bedrooms:
// every tenancy, old and new. A median the Census tops out ("3,500+", margin -333333333) is not stored.
import { getText, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";
import { degreeShare } from "../parsers.ts";

/** Our city id -> Census place GEO_ID (state FIPS + place FIPS). */
const PLACES: Record<string, string> = {
  "san-francisco-us": "1600000US0667000", "los-angeles-us": "1600000US0644000", "new-york-us": "1600000US3651000",
  "boston-us": "1600000US2507000", "seattle-us": "1600000US5363000", "austin-us": "1600000US4805000",
  "miami-us": "1600000US1245000", "chicago-us": "1600000US1714000", "denver-us": "1600000US0820000",
};

const url = (year: number, table: string) =>
  `https://www2.census.gov/programs-surveys/acs/summary_file/${year}/table-based-SF/data/1YRData/acsdt1y${year}-${table}.dat`;

/** Rows of a pipe-delimited summary-file table, keyed by GEO_ID, with estimate columns by name. */
async function table(year: number, name: string): Promise<Map<string, Record<string, number>>> {
  const [head, ...rows] = (await getText(url(year, name))).split("\n").filter(Boolean);
  const cols = head!.split("|");
  const out = new Map<string, Record<string, number>>();
  for (const line of rows) {
    const f = line.split("|");
    out.set(f[0]!, Object.fromEntries(cols.map((c, i) => [c, Number(f[i])])));
  }
  return out;
}

// The newest 1-year release that exists: estimates for year Y appear in September of Y + 1.
let year = new Date().getUTCFullYear() - 1;
let modes: Map<string, Record<string, number>>;
for (;;) {
  try {
    modes = await table(year, "b08301");
    break;
  } catch (e) {
    if (year < new Date().getUTCFullYear() - 3) throw e;
    year--;
  }
}
const times = await table(year, "b08013");
const birth = await table(year, "b05002");
const rents = await table(year, "b25031");
const TOP_CODED = -333333333;
const education = await table(year, "b15001");

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "acs", retrieved, observations: {} };
for (const c of cities) {
  const geo = PLACES[c.id];
  if (!geo) continue;
  const m = modes.get(geo)!, t = times.get(geo)!, b = birth.get(geo)!, e = education.get(geo)!;
  const commuters = m.B08301_E001! - m.B08301_E021!; // all workers minus those working from home
  const base = { period: String(year), level: "city" as const, source: "acs", retrieved };
  out.observations[c.id] = [
    { metric: "transit_commute_share", value: Math.round((1000 * m.B08301_E010!) / commuters) / 10, ...base, note: "B08301: public transport (taxi excluded) / workers who commute" },
    { metric: "commute_minutes", value: Math.round((10 * t.B08013_E001!) / commuters) / 10, ...base, note: "B08013 aggregate travel time / workers who commute" },
    { metric: "foreign_born_share", value: Math.round((1000 * b.B05002_E013!) / b.B05002_E001!) / 10, ...base, note: "B05002: foreign-born / total population" },
    { metric: "active_commute_share", value: Math.round((1000 * (m.B08301_E018! + m.B08301_E019!)) / commuters) / 10, ...base, note: `B08301: walked ${Math.round((1000 * m.B08301_E019!) / commuters) / 10}%, bicycle ${Math.round((1000 * m.B08301_E018!) / commuters) / 10}% of workers who commute` },
    { metric: "degree_share", value: degreeShare(e), ...base, note: "B15001: associate's degree or higher, aged 25 to 64" },
  ];
  const r = rents.get(geo)!;
  for (const [metric, col, beds] of [["rent_1bed", "E003", "one bedroom"], ["rent_3bed", "E005", "three bedrooms"]] as const) {
    const v = r[`B25031_${col}`]!, moe = r[`B25031_M${col.slice(1)}`]!;
    if (Number.isFinite(v) && v > 0 && moe !== TOP_CODED) out.observations[c.id]!.push({ metric, value: v, ...base, note: `B25031: median gross rent (rent plus utilities), ${beds}, every renter-occupied home paying cash rent, margin ±${moe}` });
  }
  console.log(c.id.padEnd(18), out.observations[c.id]!.map((o) => `${o.metric}=${o.value}`).join(" "));
}
await writeJson("data/observations/acs.json", out);
