// The seed cities' Urban Audit figures (Eurostat, CC BY 4.0), with the rules a person's fetcher uses
// (src/fetch/eurostat-urban.ts): one request per dataset for all the seed cities' codes. Night-time noise was
// considered, but no city has reported it since 2004.
import { getJson, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";
import { figures, requests, type JsonStat } from "../../src/fetch/eurostat-urban.ts";

/** Our city id -> Urban Audit city code. Explicit, so a renamed label never silently re-maps a city. */
const CODES: Record<string, string> = {
  "turin-it": "IT004C", "milan-it": "IT002C", "rome-it": "IT001C", "naples-it": "IT003C", "bologna-it": "IT009C", "florence-it": "IT007C",
  "london-gb": "UK001C", "cambridge-gb": "UK016C", "manchester-gb": "UK008C", "bristol-gb": "UK011C", "edinburgh-gb": "UK007C",
  "dublin-ie": "IE001C", "cork-ie": "IE002C", "paris-fr": "FR001C", "lyon-fr": "FR002C",
  "berlin-de": "DE001C", "munich-de": "DE003C", "hamburg-de": "DE002C", "amsterdam-nl": "NL001C", "rotterdam-nl": "NL037C",
  "brussels-be": "BE001C", "copenhagen-dk": "DK001C", "stockholm-se": "SE001C", "oslo-no": "NO001C", "helsinki-fi": "FI001C",
  "zurich-ch": "CH002C", "geneva-ch": "CH003C", "vienna-at": "AT001C", "prague-cz": "CZ001C", "warsaw-pl": "PL001C", "krakow-pl": "PL003C",
  "budapest-hu": "HU001C", "lisbon-pt": "PT001C", "porto-pt": "PT002C", "madrid-es": "ES001C", "barcelona-es": "ES002C",
  "valencia-es": "ES003C", "malaga-es": "ES006C", "athens-gr": "EL001C", "tallinn-ee": "EE001C",
};

const sets = new Map<string, JsonStat>();
for (const r of requests(Object.values(CODES))) sets.set(r.dataset, await getJson<JsonStat>(r.url));

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "eurostat-urban", retrieved, observations: {} };
for (const c of cities) {
  const code = CODES[c.id];
  if (!code) continue;
  out.observations[c.id] = figures(code, sets).map((o) => ({ ...o, source: "eurostat-urban", retrieved }));
  console.log(c.id.padEnd(16), out.observations[c.id]!.map((o) => `${o.metric}=${o.value}@${o.period}`).join(" "));
}
await writeJson("data/observations/eurostat-urban.json", out);
