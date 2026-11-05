// Adults with a degree by region, from the EU Labour Force Survey (Eurostat edat_lfse_04, CC BY 4.0): people aged 25
// to 64 whose highest qualification is tertiary (ISCED 5 to 8), for the NUTS 2 region around each seed city in the
// EU, EFTA and (to 2019) the UK. One survey, one definition and one year for every region, so regions compare well;
// the Urban Audit's city figure, where it is recent, is closer to the city (src/fetch/eurostat-urban.ts).
// Where the region is the city itself (Berlin, Hamburg, Vienna, Prague, Budapest, Brussels) the figure is a city one;
// Estonia is a single region, so Tallinn's is a country figure.
import { getJson, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";
import type { JsonStat } from "../../src/fetch/eurostat-urban.ts";

/** Our city id -> NUTS 2 region (2024 codes; the UK's are NUTS 2021, the last it reported). */
const REGIONS: Record<string, string> = {
  "turin-it": "ITC1", "milan-it": "ITC4", "rome-it": "ITI4", "naples-it": "ITF3", "bologna-it": "ITH5", "florence-it": "ITI1",
  "london-gb": "UKI", "manchester-gb": "UKD3", "dublin-ie": "IE06", "cork-ie": "IE05", "paris-fr": "FR10", "lyon-fr": "FRK2",
  "berlin-de": "DE30", "munich-de": "DE21", "hamburg-de": "DE60", "amsterdam-nl": "NL32", "rotterdam-nl": "NL36", "brussels-be": "BE10",
  "copenhagen-dk": "DK01", "stockholm-se": "SE11", "oslo-no": "NO08", "helsinki-fi": "FI1B", "zurich-ch": "CH04", "geneva-ch": "CH01",
  "vienna-at": "AT13", "prague-cz": "CZ01", "warsaw-pl": "PL91", "krakow-pl": "PL21", "budapest-hu": "HU11", "lisbon-pt": "PT1A",
  "porto-pt": "PT11", "madrid-es": "ES30", "barcelona-es": "ES51", "valencia-es": "ES52", "malaga-es": "ES61", "athens-gr": "EL30", "tallinn-ee": "EE00",
};
/** Regions whose borders are the city's own, and the one that is a whole country (Estonia). */
const CITY_REGIONS = new Set(["DE30", "DE60", "AT13", "CZ01", "HU11", "BE10"]);
const COUNTRY_REGIONS = new Set(["EE00"]);

const geo = [...new Set(Object.values(REGIONS))];
const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/edat_lfse_04?format=JSON&lang=en&isced11=ED5-8&sex=T&age=Y25-64&unit=PC&${geo.map((g) => `geo=${g}`).join("&")}`;
const js = await getJson<JsonStat>(url);

/** Latest year and value by region. */
function latest(js: JsonStat): Map<string, [string, number]> {
  const out = new Map<string, [string, number]>();
  const geos = js.dimension.geo!.category.index, times = js.dimension.time!.category.index;
  for (const [g, gi] of Object.entries(geos)) {
    for (const [t, ti] of Object.entries(times)) {
      const coords: Record<string, number> = { geo: gi, time: ti };
      let flat = 0;
      for (let d = 0; d < js.id.length; d++) flat = flat * js.size[d]! + (coords[js.id[d]!] ?? 0);
      const v = js.value[String(flat)];
      if (v !== undefined && (!out.has(g) || t > out.get(g)![0])) out.set(g, [t, v]);
    }
  }
  return out;
}

const byRegion = latest(js);
const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "eurostat-regions", retrieved, observations: {} };
for (const c of cities) {
  const r = REGIONS[c.id];
  const got = r && byRegion.get(r);
  if (!got) continue;
  const label = js.dimension.geo!.category.label[r]!.replace(/ \(NUTS 2021\)$/, "");
  out.observations[c.id] = [{ metric: "degree_share", value: got[1], period: got[0], level: CITY_REGIONS.has(r) ? "city" : COUNTRY_REGIONS.has(r) ? "country" : "region", source: "eurostat-regions", retrieved, note: `${label} (${r}), aged 25 to 64` }];
  console.log(c.id.padEnd(16), r, got.join(" "), label);
}
await writeJson("data/observations/eurostat-regions.json", out);
