// City identity (Wikidata id, coordinates, population) from Wikidata, which is CC0.
// Candidates come from the fast entity search; one batched SPARQL query then picks, per city,
// the most populous candidate in the right country.
import { getJson, readJson, writeJson, type SeedCity } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

interface Search { search: { id: string }[] }
interface Binding { item: { value: string }; iso: { value: string }; coord: { value: string }; pop?: { value: string } }

async function candidates(seed: SeedCity): Promise<string[]> {
  if (seed.wikidataHint) return [seed.wikidataHint];
  const ids = new Set<string>();
  for (const label of [seed.name, ...(seed.aliases ?? [])]) {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=10&search=${encodeURIComponent(label)}`;
    for (const r of (await getJson<Search>(url)).search) ids.add(r.id);
  }
  return [...ids];
}

function point(wkt: string): { lat: number; lon: number } {
  const m = wkt.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
  if (!m) throw new Error(`bad coordinate ${wkt}`);
  return { lon: Number(m[1]), lat: Number(m[2]) };
}

const seeds = await readJson<SeedCity[]>("data/cities.seed.json");
const bySeed = new Map<string, string[]>();
for (const s of seeds) bySeed.set(s.id, await candidates(s));
const all = [...new Set([...bySeed.values()].flat())];

const facts = new Map<string, Binding>();
for (let i = 0; i < all.length; i += 150) {
  const values = all.slice(i, i + 150).map((q) => `wd:${q}`).join(" ");
  const sparql = `SELECT ?item ?iso ?coord ?pop WHERE { VALUES ?item { ${values} } ?item wdt:P17 ?c; wdt:P625 ?coord. ?c wdt:P297 ?iso. OPTIONAL { ?item wdt:P1082 ?pop. } }`;
  const res = await getJson<{ results: { bindings: Binding[] } }>(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
    { headers: { Accept: "application/sparql-results+json" } },
  );
  for (const b of res.results.bindings) {
    const q = b.item.value.split("/").pop()!;
    const prev = facts.get(q);
    if (!prev || Number(b.pop?.value ?? 0) > Number(prev.pop?.value ?? 0)) facts.set(q, b);
  }
}

const out: City[] = [];
for (const s of seeds) {
  const options = (bySeed.get(s.id) ?? []).map((q) => [q, facts.get(q)] as const).filter(([, b]) => b && b.iso.value === s.country);
  options.sort((a, b) => Number(b[1]!.pop?.value ?? 0) - Number(a[1]!.pop?.value ?? 0));
  const best = options[0];
  if (!best) {
    console.error(`${s.id}: no Wikidata match in ${s.country}`);
    continue;
  }
  const [q, b] = best;
  const { lat, lon } = point(b!.coord.value);
  const city: City = { id: s.id, name: s.name, country: s.country, wikidata: q, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
  if (s.region) city.region = s.region;
  if (b!.pop) city.population = Math.round(Number(b!.pop.value));
  if (s.aliases) city.aliases = s.aliases;
  out.push(city);
}
await writeJson("data/cities.json", out);
console.log(`${out.length}/${seeds.length} cities written to data/cities.json`);
