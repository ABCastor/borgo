// Finding cities from what a person or an agent types: an id, a name in any common spelling, "Name, CC".
import type { City, Dataset } from "../core/types.ts";

export interface CityMatch {
  city: City;
  /** 0..1, how well the query matched. 1 is an exact id, name or alias. */
  score: number;
}

export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

function nameScore(q: string, name: string): number {
  if (q === name) return 1;
  if (q.length < 3) return 0; // "la" would otherwise match half the map
  if (name.startsWith(q)) return 0.9;
  if (name.split(" ").some((w) => w.startsWith(q))) return 0.8;
  if (name.includes(q)) return 0.7;
  const sim = 1 - distance(q, name) / Math.max(q.length, name.length);
  return sim >= 0.7 ? sim * 0.75 : 0;
}

/** Splits "Paris, FR" or "Paris FR" into a name and a country filter, when the tail is a known country. */
function splitCountry(data: Dataset, query: string): { name: string; country?: string } {
  const m = /^(.*?)[,\s]+([A-Za-z]{2}|[A-Za-z ]{4,})$/.exec(query.trim());
  if (m) {
    const tail = fold(m[2]!);
    const hit = Object.values(data.countries).find((c) => c.code.toLowerCase() === tail || fold(c.name) === tail);
    if (hit && m[1]!.trim()) return { name: m[1]!, country: hit.code };
  }
  return { name: query };
}

export function searchCities(data: Dataset, query: string, opts: { country?: string; limit?: number } = {}): CityMatch[] {
  const { name, country: inQuery } = splitCountry(data, query);
  const country = (opts.country ?? inQuery)?.toUpperCase();
  const q = fold(name);
  const pool = data.cities.filter((c) => !country || c.country === country);
  const scored = pool.map((city) => {
    if (city.id === query.trim().toLowerCase()) return { city, score: 1 };
    if (!q) return { city, score: 0.5 };
    const names = [city.name, ...(city.aliases ?? []), city.id.replace(/-[a-z]{2}$/, "")].map(fold);
    return { city, score: Math.max(...names.map((n) => nameScore(q, n))) };
  });
  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || (b.city.population ?? 0) - (a.city.population ?? 0))
    .slice(0, opts.limit ?? 10);
}

/**
 * One city for a query, with a note when it was read loosely ("Lisboan" as Lisbon), or an error that names the closest
 * candidates. Two different places that both match the name exactly are an error too: add the country.
 */
export function matchCity(data: Dataset, query: string): { city: City; note: string | null } {
  const hits = searchCities(data, query, { limit: 5 });
  const best = hits[0];
  const exact = hits.filter((h) => h.score === 1);
  if (exact.length > 1 && new Set(exact.map((h) => h.city.id)).size > 1 && exact[0]!.city.id !== query.trim().toLowerCase())
    throw new Error(`"${query}" could mean ${exact.map((h) => `${h.city.name}, ${h.city.country} (${h.city.id})`).join(" or ")}. Add the country ("${exact[0]!.city.name}, ${exact[0]!.city.country}") or use the id.`);
  if (best && (best.score >= 0.7 || hits.length === 1))
    return { city: best.city, note: best.score < 1 ? `Read "${query}" as ${best.city.name}, ${best.city.country} (${best.city.id}).` : null };
  const near = hits.map((h) => `${h.city.name} (${h.city.id})`).join(", ");
  throw new Error(`No city matches "${query}".${near ? ` Closest: ${near}.` : ""} Search for its id (search_cities, or borgo search), or fetch any real place first (fetch_city, or borgo fetch "${query}").`);
}

/** One city for a query, or an error that names the closest candidates. */
export function findCity(data: Dataset, query: string): City {
  return matchCity(data, query).city;
}
