// Any real place, from free text: "Palermo", "Palermo, IT", "Cork, Ireland", "Tenerife", "Bangalore", or a GeoNames id.
// GeoNames records come through Open-Meteo's geocoder (CC BY 4.0, CORS, no key), or GeoNames itself when the person
// has a username; the region's ISO 3166-2 code (what the regional tax rules read) comes from Wikidata, with a committed
// table for the regions the tax rules name in case Wikidata is busy. Seed cities keep their ids: "Torino" resolves to
// turin-it.
// - Other names: the geocoder matches a place's own name, so when it finds no sizeable town, Wikidata's search (labels
//   and aliases: "Bangalore", "Kiev", "Saigon") names GeoNames ids, read back from the geocoder.
// - Islands and countries: "Tenerife" or "Malta" is an island or a country, not a town. It resolves to its main town
//   (Santa Cruz de Tenerife, Valletta) from the towns the person's map knows (Natural Earth), so the climate is the
//   town's own; an island with no known town resolves to its own centre.
import type { City, Country, Iso2 } from "../core/types.ts";
import { fold, type FetchCtx } from "../fetch/context.ts";
import { REGION_BY_GEONAMES } from "./regions.ts";

export interface PlaceQuery {
  name: string;
  country?: Iso2;
  geonamesId?: string;
}

/** A town the map knows: name, country, latitude, longitude, population, GeoNames id (0 when none), 1 for a national capital. */
export type Town = [string, string, number, number, number, number, 1?];

interface GeoHit {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  feature_code?: string;
  country_code?: string;
  admin1_id?: number;
  admin1?: string;
  timezone?: string;
  population?: number;
}

/** "Palermo, IT", "Palermo IT", "Cork, Ireland", "geonames:2523920" -> a name and an optional country. */
export function parsePlace(text: string, countries: Record<string, Country>): PlaceQuery {
  const t = text.trim();
  const gn = /^(?:geonames:)?(\d{4,})$/.exec(t);
  if (gn) return { name: "", geonamesId: gn[1]! };
  const m = /^(.*?)[,\s]+([A-Za-z]{2}|[A-Za-z][A-Za-z .'-]{3,})$/.exec(t);
  if (m && m[1]!.trim()) {
    const tail = fold(m[2]!);
    const hit = Object.values(countries).find((c) => c.code.toLowerCase() === tail || fold(c.name) === tail);
    if (hit) return { name: m[1]!.trim().replace(/,$/, ""), country: hit.code };
  }
  return { name: t };
}

const slug = (s: string) => fold(s).replace(/ /g, "-");

/**
 * A readable id: "<name>-<cc>", else "<name>-<region>-<cc>" when another place holds it, else "<name>-<geonames id>-<cc>".
 * The GeoNames id stays on the city, and resolving the same place again returns the id it already has.
 */
export function cityId(name: string, country: string, admin1: string | undefined, geonames: string, taken: (id: string) => boolean): string {
  const cc = country.toLowerCase();
  for (const id of [`${slug(name)}-${cc}`, `${slug(name)}-${slug(admin1 ?? "")}-${cc}`, `${slug(name)}-${geonames}-${cc}`]) if (!taken(id) && !id.includes("--")) return id;
  return `${slug(name)}-${geonames}-${cc}`;
}

async function regionCode(ctx: FetchCtx, admin1GeonamesId: number | undefined, country: string): Promise<string | undefined> {
  if (!admin1GeonamesId) return undefined;
  const known = REGION_BY_GEONAMES[String(admin1GeonamesId)];
  if (known) return known;
  const q = `SELECT ?iso WHERE { ?adm wdt:P1566 "${admin1GeonamesId}"; wdt:P300 ?iso }`;
  try {
    const r = await ctx.json<{ results: { bindings: { iso: { value: string } }[] } }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { Accept: "application/sparql-results+json" } });
    const codes = r.results.bindings.map((b) => b.iso.value).filter((c) => c.startsWith(`${country}-`));
    return codes.sort((a, b) => a.length - b.length)[0];
  } catch {
    return undefined; // a missing region only means national tax rates
  }
}

function toCity(h: GeoHit, region: string | undefined, id: string): City {
  const c: City = { id, name: h.name, country: h.country_code!, lat: h.latitude, lon: h.longitude, geonames: String(h.id) };
  if (region) c.region = region;
  if (h.elevation != null) c.elevation = h.elevation;
  if (h.population) c.population = h.population;
  if (h.timezone) c.tz = h.timezone;
  return c;
}

export interface Resolved {
  city: City;
  /** True when the place is one of the committed seed cities. */
  known: boolean;
  /** Region name and population, so a person can tell two Palermos apart. */
  label: string;
  /** Set when the text named an island or a country: "the main town of Tenerife". */
  stands?: string;
}

export interface ResolveOptions {
  countries: Record<string, Country>;
  known: City[];
  limit?: number;
  geonamesUser?: string;
  /** The towns the map knows (Natural Earth): an island or a country resolves to one of them. Read only when needed. */
  towns?: () => Promise<Town[]>;
  /** Look up each candidate's ISO region (one Wikidata request each); suggestions while typing skip it. Default true. */
  regions?: boolean;
}

const GEOCODER = "https://geocoding-api.open-meteo.com/v1";
const isPopulated = (h: GeoHit) => !h.feature_code || h.feature_code.startsWith("PPL");
/** Islands, groups of islands and atolls; independent and dependent countries. */
const isIsland = (h: GeoHit) => /^(ISL|ISLS|ATOL)$/.test(h.feature_code ?? "");
const isCountry = (h: GeoHit) => /^PCL/.test(h.feature_code ?? "");
/** Below this, the geocoder's best town may be a namesake of a bigger place it knows by another name. */
const SIZEABLE = 100_000;

/**
 * Candidate places for a query, most populous first. `known` are the cities already in the dataset: a candidate with
 * the same GeoNames id returns that city, so seed ids stay stable.
 */
export async function resolvePlace(text: string, ctx: FetchCtx, opts: ResolveOptions): Promise<Resolved[]> {
  const q = parsePlace(text, opts.countries);
  const byGeonames = new Map(opts.known.filter((c) => c.geonames).map((c) => [c.geonames!, c]));
  let hits: GeoHit[] = [];
  if (q.geonamesId) {
    const r = await ctx.json<GeoHit>(`${GEOCODER}/get?id=${q.geonamesId}`);
    if (r?.id) hits = [r];
  } else {
    const url = `${GEOCODER}/search?name=${encodeURIComponent(q.name)}&count=20&language=en&format=json${q.country ? `&countryCode=${q.country}` : ""}`;
    hits = (await ctx.json<{ results?: GeoHit[] }>(url)).results ?? [];
    if (!hits.some(isPopulated) && opts.geonamesUser) hits.push(...(await geonamesSearch(ctx, q, opts.geonamesUser)));
    // No sizeable town by that name: the name may be another one's (an older name, an exonym, a spelling).
    const best = Math.max(0, ...hits.filter((h) => isPopulated(h) && inCountry(h, q)).map((h) => h.population ?? 0));
    if (best < SIZEABLE) {
      const seen = new Set(hits.map((h) => h.id));
      for (const h of await wikidataSearch(ctx, q, seen)) if (!seen.has(h.id)) hits.push(h);
    }
  }
  hits = hits.filter((h) => inCountry(h, q));
  // An island or a country bigger than every town of that name stands for its main town.
  let stand: { hit: GeoHit; stands: string } | null = null;
  const area = hits.filter((h) => isIsland(h) || isCountry(h)).sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  const bestTown = Math.max(0, ...hits.filter(isPopulated).map((h) => h.population ?? 0));
  if (area && (area.population ?? 0) > 2 * bestTown) stand = await mainTown(ctx, area, hits, opts);
  // Populated places only (PPL*), biggest first.
  hits = hits.filter(isPopulated);
  hits.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  // Hamlets only crowd the list: keep the best match, and alternatives of at least 1,000 people.
  hits = hits.filter((h, i) => i === 0 || (h.population ?? 0) >= 1_000);
  if (stand) hits = [stand.hit, ...hits.filter((h) => h.id !== stand!.hit.id)];
  const out: Resolved[] = [];
  const ids = new Set(opts.known.map((c) => c.id));
  for (const h of hits.slice(0, opts.limit ?? 5)) {
    const seed = byGeonames.get(String(h.id));
    const stands = stand?.hit === h ? stand.stands : undefined;
    const label = [stands, h.admin1, opts.countries[h.country_code!]?.name ?? h.country_code, h.population ? `${h.population.toLocaleString("en-GB")} people` : null].filter(Boolean).join(", ");
    if (seed) {
      out.push({ city: seed, known: true, label, ...(stands ? { stands } : {}) });
      continue;
    }
    const region = opts.regions === false ? undefined : await regionCode(ctx, h.admin1_id, h.country_code!);
    const id = cityId(h.name, h.country_code!, h.admin1, String(h.id), (x) => ids.has(x));
    ids.add(id);
    const city = toCity(h, region, id);
    if (stands && area && fold(area.name) !== fold(h.name)) city.aliases = [area.name];
    out.push({ city, known: false, label, ...(stands ? { stands } : {}) });
  }
  return out;
}

const inCountry = (h: GeoHit, q: PlaceQuery) => !!h.country_code && (!q.country || h.country_code === q.country);

/** Great-circle distance in km. */
function dist(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const x = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(x));
}

/**
 * The town an island or a country stands for. A country: its capital. An island: the biggest town near its centre,
 * within a reach that grows with the island's people (30 km for 90,000 people, 95 km for Tenerife's 900,000, at most
 * 150 km), each town weighed down by its distance so a bigger town on the next island does not win. A low island
 * with no town found stands for its own centre; otherwise nothing stands and the towns of that name are listed.
 */
async function mainTown(ctx: FetchCtx, area: GeoHit, hits: GeoHit[], opts: ResolveOptions): Promise<{ hit: GeoHit; stands: string } | null> {
  const cc = area.country_code!;
  const country = isCountry(area);
  let towns: Town[] = [];
  try {
    towns = (await opts.towns?.()) ?? [];
  } catch {
    towns = []; // without the town list, the geocoder's own towns of that name still count
  }
  const reach = Math.min(150, Math.max(30, Math.sqrt(area.population ?? 0) / 10));
  type Cand = { name: string; lat: number; lon: number; pop: number; capital: boolean; geonames?: number; hit?: GeoHit };
  const cands: Cand[] = [
    ...towns.filter((t) => t[1] === cc).map((t) => ({ name: t[0], lat: t[2], lon: t[3], pop: t[4], geonames: t[5], capital: t[6] === 1 })),
    ...hits.filter((h) => isPopulated(h) && h.country_code === cc && h.population).map((h) => ({ name: h.name, lat: h.latitude, lon: h.longitude, pop: h.population!, capital: h.feature_code === "PPLC", hit: h })),
  ];
  const ranked = country
    ? cands.sort((a, b) => Number(b.capital) - Number(a.capital) || b.pop - a.pop)
    : cands
        .map((c) => ({ c, d: dist(area.latitude, area.longitude, c.lat, c.lon) }))
        .filter((x) => x.d <= reach)
        .sort((a, b) => b.c.pop / (1 + (b.d / 30) ** 2) - a.c.pop / (1 + (a.d / 30) ** 2))
        .map((x) => x.c);
  const what = country ? `the capital of ${area.name}` : `the main town of ${area.name}`;
  for (const c of ranked.slice(0, 3)) {
    const hit = c.hit ?? (await geocoderTown(ctx, c, cc));
    if (hit) return { hit, stands: what };
  }
  // No town found: a low island stands for its own centre; a mountainous one would give a summit's climate, so not.
  if (country || (area.elevation ?? Infinity) > 300) return null;
  return { hit: { ...area, feature_code: "PPL" }, stands: "the centre of the island (no town found on it)" };
}

/** The geocoder's record for a town the map names: by its GeoNames id, else by name, country and position. */
async function geocoderTown(ctx: FetchCtx, t: { name: string; lat: number; lon: number; geonames?: number }, cc: string): Promise<GeoHit | null> {
  const { name, lat, lon } = t;
  if (t.geonames) {
    const h = await ctx.json<GeoHit>(`${GEOCODER}/get?id=${t.geonames}`).catch(() => null);
    if (h?.id && h.country_code === cc && dist(lat, lon, h.latitude, h.longitude) < 30) return { ...h, feature_code: isPopulated(h) ? h.feature_code : "PPL" };
  }
  try {
    const r = await ctx.json<{ results?: GeoHit[] }>(`${GEOCODER}/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json&countryCode=${cc}`);
    const near = (r.results ?? []).filter((h) => isPopulated(h) && dist(lat, lon, h.latitude, h.longitude) < 30);
    return near.sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0] ?? null;
  } catch {
    return null;
  }
}

async function geonamesSearch(ctx: FetchCtx, q: PlaceQuery, user: string): Promise<GeoHit[]> {
  type G = { geonameId: number; name: string; lat: string; lng: string; countryCode: string; adminId1?: string; adminName1?: string; population?: number; fcode?: string };
  const url = `https://secure.geonames.org/searchJSON?q=${encodeURIComponent(q.name)}&featureClass=P&maxRows=10&style=FULL&username=${encodeURIComponent(user)}${q.country ? `&country=${q.country}` : ""}`;
  const r = await ctx.json<{ geonames?: (G & { timezone?: { timeZoneId: string }; elevation?: number })[] }>(url);
  return (r.geonames ?? []).map((g) => ({ id: g.geonameId, name: g.name, latitude: Number(g.lat), longitude: Number(g.lng), country_code: g.countryCode, admin1_id: g.adminId1 ? Number(g.adminId1) : undefined, admin1: g.adminName1, population: g.population, feature_code: g.fcode, timezone: g.timezone?.timeZoneId, elevation: g.elevation }));
}

/**
 * Wikidata's search, labels and aliases, for a place the geocoder knows by another name. Only entries whose label or
 * alias is exactly the text count (the search also matches prefixes: "Bra" must not become Brazil). Their GeoNames ids
 * are read back from the geocoder, so the record is the same as for any other place. A busy Wikidata costs nothing.
 */
async function wikidataSearch(ctx: FetchCtx, q: PlaceQuery, seen: Set<number> = new Set()): Promise<GeoHit[]> {
  try {
    type Hit = { id: string; match?: { text?: string } };
    const search = await ctx.json<{ search?: Hit[] }>(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q.name)}&language=en&type=item&limit=7&format=json&origin=*`);
    const ids = (search.search ?? []).filter((s) => fold(s.match?.text ?? "") === fold(q.name)).map((s) => s.id);
    if (!ids.length) return [];
    type Entity = { claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]> };
    const ents = await ctx.json<{ entities: Record<string, Entity> }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims&format=json&origin=*`);
    const claim = (e: Entity | undefined, p: string) => (e?.claims?.[p] ?? []).map((c) => c.mainsnak.datavalue?.value);
    // With a country named, only entries in that country are read back: an id the geocoder does not hold (a county,
    // a region) answers 400, which a browser logs however it is caught.
    let inCountry = (_: Entity | undefined) => true;
    if (q.country) {
      const qids = [...new Set(ids.flatMap((id) => claim(ents.entities[id], "P17").map((v) => (v as { id?: string } | undefined)?.id).filter((x): x is string => !!x)))].slice(0, 50);
      const iso = qids.length ? await ctx.json<{ entities: Record<string, Entity> }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join("|")}&props=claims&format=json&origin=*`) : { entities: {} };
      const codeOf = (qid: string) => claim(iso.entities[qid], "P297")[0];
      inCountry = (e) => claim(e, "P17").some((v) => codeOf((v as { id?: string } | undefined)?.id ?? "") === q.country);
    }
    const gns = ids
      .filter((id) => inCountry(ents.entities[id]))
      .map((id) => claim(ents.entities[id], "P1566")[0])
      .filter((g): g is string => typeof g === "string" && !seen.has(Number(g)))
      .slice(0, 3);
    const out = await Promise.all(gns.map((g) => ctx.json<GeoHit>(`${GEOCODER}/get?id=${g}`).catch(() => null)));
    return out.filter((h): h is GeoHit => !!h?.id);
  } catch {
    return [];
  }
}
