// Universities and research institutes in each city, from the Research Organization Registry (ROR), CC0.
// ROR places every organisation in a GeoNames city, the same ids our cities carry, so the match is exact:
// one request per city, and the registry's own facet counts give the totals by type (active records only).
import { getJson, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

interface Facet { id: string; count: number }
interface Page { number_of_results: number; meta: { types: Facet[] } }

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "ror", retrieved, observations: {} };
for (const c of cities) {
  if (!c.geonames) {
    out.observations[c.id] = [];
    continue;
  }
  const page = await getJson<Page>(`https://api.ror.org/v2/organizations?query.advanced=locations.geonames_id:${c.geonames}`);
  const count = (type: string) => page.meta.types.find((t) => t.id === type)?.count ?? 0;
  const base = { period: retrieved, level: "city" as const, source: "ror", retrieved };
  out.observations[c.id] = [
    { metric: "universities", value: count("education"), ...base, note: "ROR organisations of type education (universities, colleges, schools of higher education)" },
    { metric: "research_institutes", value: count("facility"), ...base, note: "ROR organisations of type facility (research institutes, laboratories, observatories)" },
  ];
  console.log(c.id.padEnd(18), String(count("education")).padStart(4), String(count("facility")).padStart(4), page.number_of_results);
  await new Promise((r) => setTimeout(r, 300));
}
await writeJson("data/observations/ror.json", out);
