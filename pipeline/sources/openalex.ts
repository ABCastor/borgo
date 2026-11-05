// Research output of the institutions in each city (universities, labs, hospitals, companies), from OpenAlex, CC0.
// A proxy for "people building things": works published in the last complete year, per 100,000 residents.
// Works co-authored by several institutions in one city are counted once per institution; only the top 200
// institutions by output are summed. A proxy, documented as such wherever it is shown.
import { getJson, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

interface Page { meta: { count: number }; results: { counts_by_year: { year: number; works_count: number }[] }[] }

const YEAR = new Date().getUTCFullYear() - 1 - (new Date().getUTCMonth() < 3 ? 1 : 0); // last complete, indexed year
const LOW = 100, HIGH = 30_000; // works per 100k residents mapped to 0 and 100 on a log scale

const CAP = 20_000; // no single institution publishes more in a year; larger figures are OpenAlex attribution errors

// The 200 most productive institutions per city (one request, no paging, which now needs an API key).
// National agencies (type "government", such as CNRS in Paris) are left out: their output is national, not local.
// Each institution counts the median of its last three years, capped, which absorbs one-year attribution spikes.
async function cityWorks(name: string, cc: string): Promise<{ institutions: number; works: number }> {
  const url = `https://api.openalex.org/institutions?filter=geo.city:${encodeURIComponent(`"${name}"`)},country_code:${cc},type:!government&per-page=200&sort=works_count:desc&select=counts_by_year`;
  const page = await getJson<Page>(url);
  const works = page.results.reduce((s, r) => {
    const years = [YEAR, YEAR - 1, YEAR - 2].map((y) => r.counts_by_year.find((c) => c.year === y)?.works_count ?? 0).sort((a, b) => a - b);
    return s + Math.min(CAP, years[1]!);
  }, 0);
  return { institutions: page.meta.count, works };
}

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "openalex", retrieved, observations: {} };
for (const c of cities) {
  let best = { name: "", institutions: 0, works: 0 };
  for (const name of [c.name, ...(c.aliases ?? [])]) {
    const r = await cityWorks(name, c.country);
    if (r.works > best.works) best = { name, ...r };
  }
  if (!best.works || !c.population) {
    out.observations[c.id] = [];
    console.log(`${c.id}: no OpenAlex institutions`);
    continue;
  }
  const per100k = Math.round((best.works / c.population) * 100_000);
  const score = Math.round(Math.max(0, Math.min(100, (100 * Math.log10(per100k / LOW)) / Math.log10(HIGH / LOW))));
  const base = { period: String(YEAR), level: "city" as const, source: "openalex", retrieved };
  out.observations[c.id] = [
    { metric: "research_output", value: per100k, ...base, note: `${best.works.toLocaleString("en-GB")} works by ${best.institutions} institutions in ${best.name}` },
    { metric: "builder_density", value: score, ...base, note: `log scale: ${LOW} works per 100k residents = 0, ${HIGH.toLocaleString("en-GB")} = 100` },
  ];
  console.log(c.id.padEnd(18), String(per100k).padStart(6), String(score).padStart(4), best.institutions, best.name);
}
await writeJson("data/observations/openalex.json", out);
