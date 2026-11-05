// City statistics from the Eurostat Urban Audit (cities and greater cities), CC BY 4.0: commuting, walking and cycling
// to work, the price of a monthly transit pass, road deaths, green space, foreign-born residents, public pools and the
// share of adults with a degree. Each figure is the latest year the city reported, so periods differ by city and
// indicator; UK cities stop around 2018. Figures older than 2010 are dropped (2015 for prices, which drift fastest;
// 2014 for degrees, when the indicator moved to ISCED 2011): an old figure shown as current misleads more than a gap.
// Some cities report as a "greater city" (the city plus its contiguous urban area); the note says so.
// Any place in the Urban Audit is found by its name among the city labels of its country (labels use local names:
// Torino, Wien, München); the seed snapshot passes its codes explicitly (pipeline/sources/eurostat-urban.ts).
import type { City, Observation } from "../core/types.ts";
import { fold, round, type Fetcher, type FetchCtx } from "./context.ts";

export const API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

/**
 * Our metric <- dataset and indicator. `per100k` turns a count into a rate with the city's population that year;
 * `since` is the oldest year still worth showing; `min` drops values that cannot be what the indicator claims.
 */
export const WANTED: { metric: string; dataset: string; indic: string; per100k?: boolean; since?: number; min?: number; max?: number }[] = [
  { metric: "transit_commute_share", dataset: "urb_ctran", indic: "TT1010V" },
  { metric: "commute_minutes", dataset: "urb_ctran", indic: "TT1019V" },
  // A few cities report a single fare (about 1 euro) under this indicator; no monthly pass costs under 10.
  { metric: "transit_pass", dataset: "urb_ctran", indic: "TT1080V", since: 2015, min: 10 },
  { metric: "road_deaths", dataset: "urb_ctran", indic: "TT1060I" },
  { metric: "green_share", dataset: "urb_cenv", indic: "EN5205V" },
  { metric: "foreign_born_share", dataset: "urb_cpopcb", indic: "DE2009I" },
  { metric: "public_pools", dataset: "urb_ctour", indic: "CR1015V", per100k: true },
  { metric: "degree_share", dataset: "urb_ceduc", indic: "TE2031I", since: 2014, max: 100 },
];
/** Walking and cycling to work: two shares added, from the same year. */
export const ACTIVE = { metric: "active_commute_share", dataset: "urb_ctran", bike: "TT1007V", walk: "TT1008V", since: 2010 } as const;
const POPULATION = { dataset: "urb_cpop1", indic: "DE1001V" };

/** Eurostat writes Greece as EL and the United Kingdom as UK. */
const prefix = (iso2: string) => (iso2 === "GR" ? "EL" : iso2 === "GB" ? "UK" : iso2);
/** Countries in the Urban Audit: the EU, EFTA, the UK and candidate countries. */
const COVERED = new Set("AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK CH IS LI NO GB TR RS ME MK AL".split(" "));

export interface JsonStat {
  id: string[];
  size: number[];
  dimension: Record<string, { category: { index: Record<string, number>; label: Record<string, string> } }>;
  value: Record<string, number>;
}

/** Value by city code and year for one indicator of a JSON-stat response. */
export function byCityYear(js: JsonStat, indic: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const pos = (dim: string, key: string) => js.dimension[dim]?.category.index[key];
  const ii = pos("indic_ur", indic);
  if (ii === undefined || !js.dimension.cities || !js.dimension.time) return out;
  for (const city of Object.keys(js.dimension.cities.category.index)) {
    for (const year of Object.keys(js.dimension.time.category.index)) {
      const coords: Record<string, number> = { freq: 0, indic_ur: ii, cities: pos("cities", city)!, time: pos("time", year)! };
      let flat = 0;
      for (let d = 0; d < js.id.length; d++) flat = flat * js.size[d]! + (coords[js.id[d]!] ?? 0);
      const v = js.value[String(flat)];
      if (v === undefined) continue;
      if (!out.has(city)) out.set(city, new Map());
      out.get(city)!.set(year, v);
    }
  }
  return out;
}

export const datasetUrl = (dataset: string, indics: string[], codes: string[]) =>
  `${API}/${dataset}?format=JSON&lang=en&${[...indics.map((i) => `indic_ur=${i}`), ...codes.map((c) => `cities=${c}`)].join("&")}`;

/** Every request the figures for these cities need: one per dataset, plus the population for per-resident rates. */
export function requests(codes: string[]): { dataset: string; url: string }[] {
  const byDataset = new Map<string, string[]>();
  for (const w of WANTED) byDataset.set(w.dataset, [...(byDataset.get(w.dataset) ?? []), w.indic]);
  byDataset.set(ACTIVE.dataset, [...(byDataset.get(ACTIVE.dataset) ?? []), ACTIVE.bike, ACTIVE.walk]);
  byDataset.set(POPULATION.dataset, [POPULATION.indic]);
  return [...byDataset].map(([dataset, indics]) => ({ dataset, url: datasetUrl(dataset, indics, codes) }));
}

/** One city's figures from the fetched datasets, without retrieval details. */
export function figures(code: string, sets: Map<string, JsonStat>): Omit<Observation, "retrieved" | "source">[] {
  const population = sets.has(POPULATION.dataset) ? byCityYear(sets.get(POPULATION.dataset)!, POPULATION.indic).get(code) : undefined;
  const out: Omit<Observation, "retrieved" | "source">[] = [];
  const labelOf = (js: JsonStat) => js.dimension.cities?.category.label[code] ?? code;
  const place = (label: string) => (label.includes("greater city") ? `${label}: the city and its contiguous urban area` : label);
  for (const w of WANTED) {
    const js = sets.get(w.dataset);
    const series = js && byCityYear(js, w.indic).get(code);
    if (!series) continue;
    const years = [...series.keys()]
      .filter((y) => Number(y) >= (w.since ?? 2010) && series.get(y)! >= (w.min ?? -Infinity) && series.get(y)! <= (w.max ?? Infinity))
      .filter((y) => !w.per100k || population?.has(y))
      .sort();
    const year = years.at(-1);
    if (!year) continue;
    const raw = series.get(year)!;
    const value = w.per100k ? round((raw / population!.get(year)!) * 100_000, 1) : raw;
    const note = [place(labelOf(js)), w.per100k ? `${raw} in total` : ""].filter(Boolean).join("; ");
    out.push({ metric: w.metric, value, period: year, level: "city", note });
  }
  const ctran = sets.get(ACTIVE.dataset);
  if (ctran) {
    const a = activeCommute(byCityYear(ctran, ACTIVE.bike).get(code), byCityYear(ctran, ACTIVE.walk).get(code), ACTIVE.since);
    if (a) out.push({ metric: ACTIVE.metric, value: a.value, period: a.year, level: "city", note: `${place(labelOf(ctran))}; on foot ${a.walk}%, by bicycle ${a.bike}%` });
  }
  return out;
}

/** Walking plus cycling to work, from the latest year since `since` that reports both, as long as the sum is a share. */
export function activeCommute(bike: Map<string, number> | undefined, walk: Map<string, number> | undefined, since = 2010): { year: string; value: number; bike: number; walk: number } | null {
  if (!bike || !walk) return null;
  const years = [...bike.keys()].filter((y) => walk.has(y) && Number(y) >= since).sort().reverse();
  for (const y of years) {
    const b = bike.get(y)!, w = walk.get(y)!;
    if (b >= 0 && w >= 0 && b + w <= 100) return { year: y, value: round(b + w, 1), bike: round(b, 1), walk: round(w, 1) };
  }
  return null;
}

/** The Urban Audit city code for a place, matched on its names among its country's city labels. */
export function codeFor(city: Pick<City, "name" | "aliases" | "country">, labels: Record<string, string>): string | null {
  const names = new Set([city.name, ...(city.aliases ?? [])].map((n) => fold(n)));
  const p = prefix(city.country);
  for (const [code, label] of Object.entries(labels)) {
    if (!new RegExp(`^${p}\\d{3}C\\d?$`).test(code)) continue;
    if (names.has(fold(label.replace(/\(.*\)/g, "")))) return code;
  }
  return null;
}

/** The dataset a metric is read from. */
export const datasetOf = (metric: string) => (metric === ACTIVE.metric ? ACTIVE.dataset : WANTED.find((w) => w.metric === metric)?.dataset);

async function urbanFor(ctx: FetchCtx, code: string): Promise<Omit<Observation, "retrieved" | "source">[]> {
  const sets = new Map<string, JsonStat>();
  const reqs = requests([code]);
  for (const r of reqs) sets.set(r.dataset, await ctx.json<JsonStat>(r.url));
  const url = new Map(reqs.map((r) => [r.dataset, r.url]));
  return figures(code, sets).map((o) => ({ ...o, url: url.get(datasetOf(o.metric)!) }));
}

export const eurostatUrban: Fetcher = {
  source: "eurostat-urban",
  version: 1,
  runtimes: ["browser", "node"],
  covers: (c) => COVERED.has(c.country),
  async fetch(city, ctx) {
    // The population table lists every Urban Audit city with its label, which is all the lookup needs.
    const index = await ctx.json<JsonStat>(`${API}/${POPULATION.dataset}?format=JSON&lang=en&indic_ur=${POPULATION.indic}&lastTimePeriod=1`);
    const code = codeFor(city, index.dimension.cities?.category.label ?? {});
    if (!code) return [];
    const retrieved = ctx.now().toISOString();
    return (await urbanFor(ctx, code)).map((o) => ({ ...o, source: "eurostat-urban", retrieved, fetcher: "eurostat-urban@1" }));
  },
};
