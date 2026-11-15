// Rents in Amsterdam and Rotterdam from Statistics Netherlands (CBS StatLine 85950NED, housing costs of households by
// municipality, CC BY 4.0): the median monthly rent that households renting from a private landlord (not a housing
// corporation, whose homes go through waiting lists) pay, after any rent benefit, which few private tenants receive.
// A one-bedroom home takes homes under 75 m², a three-bedroom home those of 75 to 100 m². The latest year CBS publishes
// for that municipality and size.
import { getJson, isMain, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const TABLE = "85950NED";
/** Seed city -> CBS municipality code. */
export const MUNICIPALITIES: Record<string, string> = { "amsterdam-nl": "GM0363", "rotterdam-nl": "GM0599" };
/** Private landlords: tenants of a landlord that is not a housing corporation. */
export const PRIVATE = "A047048";
export const SIZES = { rent_1bed: { key: "ZW25790", words: "homes under 75 m²" }, rent_3bed: { key: "ZW25791", words: "homes of 75 to 100 m²" } } as const;

export interface CbsRow { RegioS: string; EigenaarHuurder: string; HuishoudensEnWoningkenmerken: string; Perioden: string; NettoWoonlasten_7: number | null; AantalHuishoudens_1: number | null }

export function cbsObservations(rows: CbsRow[], cities: City[], retrieved: string): ObservationFile {
  const out: ObservationFile = { source: "cbs-woonlasten", retrieved, observations: {} };
  for (const c of cities) {
    const gm = MUNICIPALITIES[c.id];
    if (!gm) continue;
    const list: Observation[] = [];
    for (const [metric, size] of Object.entries(SIZES) as [keyof typeof SIZES, (typeof SIZES)[keyof typeof SIZES]][]) {
      const latest = rows
        .filter((r) => r.RegioS.trim() === gm && r.EigenaarHuurder === PRIVATE && r.HuishoudensEnWoningkenmerken === size.key && typeof r.NettoWoonlasten_7 === "number")
        .sort((a, b) => a.Perioden.localeCompare(b.Perioden))
        .at(-1);
      if (!latest) continue;
      const year = latest.Perioden.slice(0, 4);
      list.push({ metric, value: latest.NettoWoonlasten_7!, period: year, level: "city", source: "cbs-woonlasten", retrieved, note: `${c.name}, median monthly rent paid by households renting ${size.words} from a private landlord in ${year}, after any rent benefit (${Math.round((latest.AantalHuishoudens_1 ?? 0) * 1000)} households; CBS ${TABLE})` });
    }
    if (list.length) out.observations[c.id] = list;
  }
  return out;
}

if (isMain(import.meta.url)) {
  const codes = Object.values(MUNICIPALITIES).map((g) => `RegioS eq '${g}'`).join(" or ");
  const sizes = Object.values(SIZES).map((s) => `HuishoudensEnWoningkenmerken eq '${s.key}'`).join(" or ");
  const filter = `(${codes}) and EigenaarHuurder eq '${PRIVATE}' and (${sizes})`;
  const d = await getJson<{ value: CbsRow[] }>(`https://opendata.cbs.nl/ODataApi/odata/${TABLE}/TypedDataSet?$format=json&$filter=${encodeURIComponent(filter)}`);
  const out = cbsObservations(d.value, await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/nl-rent.json", out);
}
