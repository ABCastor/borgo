// Developers around: GitHub accounts whose profile location names the place, from GitHub's public user search, per
// 1,000 residents. The search matches the words people type in their profile, so the count is a rough signal: many
// leave the field empty and some write a nearby big city. Each of the place's names is searched (Turin and Torino) and
// the counts added; a profile naming both counts twice, which is rare. Only total counts are read and kept, never an
// account. Unauthenticated search allows 10 requests a minute.
// Two places with one name cannot be told apart by a bare name, so when the gazetteer knows another place of that name
// with at least a tenth of our population, profiles that also name a country or region decide: if those naming the
// other place are more than a tenth of those naming either, the count would mix two places and no figure is given
// (Cambridge, England and Cambridge, Massachusetts). Barcelona keeps its figure: "Barcelona, Venezuela" is rare.
// A larger place whose longer name holds ours as a word (Porto Alegre for Porto) matches the same search, so profiles
// naming it are counted on their own and taken away.
import type { City, Observation } from "../core/types.ts";
import { fold, round, type Fetcher, type FetchCtx } from "./context.ts";

export const SEARCH = "https://api.github.com/search/users";
const GEOCODER = "https://geocoding-api.open-meteo.com/v1/search";
/** Another place of the same name is a candidate for confusion from this share of our population. */
export const RIVAL_POPULATION = 1 / 10;
/** Profiles naming the other place, as a share of those naming either, beyond which the count is not ours. */
export const RIVAL_SHARE = 0.1;

export interface Geo { id: number; name: string; country_code: string; country?: string; admin1?: string; population?: number; latitude: number; longitude: number }

/** Names to search: the place's own name and its aliases, folded so "Zürich" and "Zurich" count once. */
export function searchNames(city: Pick<City, "name" | "aliases">): string[] {
  const seen = new Map<string, string>();
  for (const n of [city.name, ...(city.aliases ?? [])]) if (n && !seen.has(fold(n))) seen.set(fold(n), n);
  return [...seen.values()];
}

const isUs = (city: Pick<City, "lat" | "lon">, p: Geo) => Math.abs(p.latitude - city.lat) <= 0.5 && Math.abs(p.longitude - city.lon) <= 0.5;

/**
 * The gazetteer's entry for this place; other places of the same name large enough to be confused with it; and larger
 * places whose name holds ours as a word, which the same search also finds.
 */
export function namesakes(city: Pick<City, "lat" | "lon" | "population">, name: string, places: Geo[]): { ours: Geo | null; rivals: Geo[]; longer: string[] } {
  const f = fold(name);
  const same = places.filter((p) => fold(p.name) === f);
  const ours = same.find((p) => isUs(city, p)) ?? null;
  const floor = (city.population ?? ours?.population ?? 0) * RIVAL_POPULATION;
  const big = (p: Geo) => !isUs(city, p) && (p.population ?? 0) >= floor;
  const bySize = (a: Geo, b: Geo) => (b.population ?? 0) - (a.population ?? 0);
  // The three largest are enough to tell, and keep a browser within GitHub's 10 searches a minute.
  const rivals = same.filter(big).sort(bySize).slice(0, 3);
  const word = new RegExp(`(^| )${f}( |$)`); // folded names hold only letters, digits and spaces
  const longer = [...new Set(places.filter((p) => fold(p.name) !== f && word.test(fold(p.name)) && big(p)).sort(bySize).map((p) => p.name))].slice(0, 3);
  return { ours, rivals, longer };
}

/** Phrases that pin the name to a place: "Cambridge, United Kingdom", "Cambridge, England". */
export function qualified(name: string, p: Geo): string[] {
  return [...new Set([p.country, p.admin1].filter((q): q is string => !!q && fold(q) !== fold(name)).map((q) => `${name}, ${q}`))];
}

/** Share of the qualified profiles that name a rival rather than us; null when no profile qualifies the name. */
export function rivalShare(ours: number, rivals: number): number | null {
  return ours + rivals ? rivals / (ours + rivals) : null;
}

export const searchUrl = (phrase: string) => `${SEARCH}?q=${encodeURIComponent(`location:"${phrase}"`)}&per_page=1`;

async function count(ctx: FetchCtx, phrase: string): Promise<number> {
  return (await ctx.json<{ total_count: number }>(searchUrl(phrase), { headers: { Accept: "application/vnd.github+json" } })).total_count;
}

export const github: Fetcher = {
  source: "github",
  version: 1,
  runtimes: ["browser", "node"],
  covers: (c) => !!c.population,
  async fetch(city: City, ctx: FetchCtx): Promise<Observation[]> {
    const names = searchNames(city);
    const shared: string[] = [];
    const removed: string[] = [];
    let minus = 0;
    for (const n of names) {
      const geo = await ctx.json<{ results?: Geo[] }>(`${GEOCODER}?name=${encodeURIComponent(n)}&count=20&language=en&format=json`);
      const { ours, rivals, longer } = namesakes(city, n, geo.results ?? []);
      for (const l of longer) {
        const k = await count(ctx, l);
        if (k) (minus += k), removed.push(`${k.toLocaleString("en-GB")} naming ${l}`);
      }
      if (!rivals.length) continue;
      let mine = 0, theirs = 0;
      for (const q of ours ? qualified(n, ours) : []) mine += await count(ctx, q);
      for (const r of rivals) for (const q of qualified(n, r)) theirs += await count(ctx, q);
      const share = rivalShare(mine, theirs);
      if (share === null || share > RIVAL_SHARE) return []; // the count would mix two places
      shared.push(`${n} in ${[...new Set(rivals.map((r) => r.country ?? r.country_code))].join(", ")} (${round(100 * share, 0)}% of profiles naming a country)`);
    }
    let total = -minus;
    for (const n of names) total += await count(ctx, n);
    if (total <= 0 || !city.population) return [];
    const note = [
      `${total.toLocaleString("en-GB")} accounts whose location names ${names.map((n) => `"${n}"`).join(" or ")}, over ${city.population.toLocaleString("en-GB")} residents`,
      removed.length ? `less ${removed.join(" and ")}` : "",
      shared.length ? `the count includes the few naming ${shared.join("; ")}` : "",
    ];
    return [
      {
        metric: "github_developers",
        value: round((total / city.population) * 1000, 1),
        period: ctx.now().toISOString().slice(0, 10),
        level: "city",
        source: "github",
        retrieved: ctx.now().toISOString(),
        url: searchUrl(names[0]!),
        fetcher: "github@1",
        note: note.filter(Boolean).join("; "),
      },
    ];
  },
};
