// Research output of the institutions in a city, per resident, from OpenAlex (CC0). A proxy, labelled as research
// density (decision D10): the top 200 institutions by output, national agencies left out, each counted at the
// median of its last three years and capped, which absorbs one-year attribution spikes.
import { round, type Fetcher } from "./context.ts";

interface Page { meta: { count: number }; results: { counts_by_year: { year: number; works_count: number }[] }[] }

const LOW = 100;
const HIGH = 30_000; // works per 100k residents mapped to 0 and 100 on a log scale
const CAP = 20_000; // no single institution publishes more in a year; larger figures are attribution errors

/** The last year OpenAlex has fully indexed. */
export const researchYear = (now: Date) => now.getUTCFullYear() - 1 - (now.getUTCMonth() < 3 ? 1 : 0);

export const openAlex: Fetcher = {
  source: "openalex",
  version: 1,
  runtimes: ["browser", "node"],
  covers: (c) => !!c.population,
  async fetch(city, ctx) {
    const year = researchYear(ctx.now());
    let best = { name: "", institutions: 0, works: 0, url: "" };
    for (const name of [city.name, ...(city.aliases ?? [])]) {
      const url = `https://api.openalex.org/institutions?filter=geo.city:${encodeURIComponent(`"${name}"`)},country_code:${city.country},type:!government&per-page=200&sort=works_count:desc&select=counts_by_year`;
      const page = await ctx.json<Page>(url);
      const works = page.results.reduce((s, r) => {
        const ys = [year, year - 1, year - 2].map((y) => r.counts_by_year.find((c) => c.year === y)?.works_count ?? 0).sort((a, b) => a - b);
        return s + Math.min(CAP, ys[1]!);
      }, 0);
      if (works > best.works) best = { name, institutions: page.meta.count, works, url };
    }
    if (!best.works || !city.population) return [];
    const per100k = Math.round((best.works / city.population) * 100_000);
    const score = Math.round(Math.max(0, Math.min(100, (100 * Math.log10(per100k / LOW)) / Math.log10(HIGH / LOW))));
    const base = { period: String(year), level: "city" as const, source: "openalex", retrieved: ctx.now().toISOString(), url: best.url, fetcher: "openalex@1" };
    return [
      { metric: "research_output", value: per100k, ...base, note: `${best.works.toLocaleString("en-GB")} works by ${best.institutions} institutions in ${best.name}` },
      { metric: "builder_density", value: round(score, 0), ...base, note: `log scale: ${LOW} works per 100k residents = 0, ${HIGH.toLocaleString("en-GB")} = 100` },
    ];
  },
};
