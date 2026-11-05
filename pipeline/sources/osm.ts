// What is within 10 km of the city centre, counted in OpenStreetMap through the Overpass API.
// OSM data is © OpenStreetMap contributors under the ODbL 1.0, a share-alike licence: these figures are a derived
// database, so they are written to data/observations-odbl/ and stay under the ODbL wherever they are published.
// A fixed circle keeps cities comparable whatever their administrative borders. Counts reflect how thoroughly a
// city is mapped as well as what exists; OSM is strongest in Europe and weakest where few people map.
// Run: node pipeline/sources/osm.ts [city-id ...]   (two to three minutes a city; each result merges into the file,
// so a stopped run resumes where it left off and two runs on different cities can share the work)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Grid, joinRings } from "../raster.ts";
import { getJson, readJson, ROOT, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const LAND = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson";
const FILE = "data/observations-odbl/osm.json";
const RADIUS_M = 10_000;
const CELL_KM = 0.1;

/** Metric <- Overpass selection (counted once per element), within the radius. */
const COUNTS: Record<string, string[]> = {
  coworking: ['nwr["amenity"="coworking_space"]', 'nwr["office"="coworking"]'],
  climbing_gyms: ['nwr["sport"~"(^|;)climbing($|;)"]["leisure"~"^(sports_centre|fitness_centre|sports_hall)$"]'],
  swimming_pools: ['nwr["leisure"="sports_centre"]["sport"~"(^|;)swimming($|;)"]', 'nwr["leisure"="swimming_pool"]["access"~"^(yes|public)$"]'],
  hackerspaces: ['nwr["leisure"="hackerspace"]'],
  rail_stations: ['node["railway"~"^(station|halt)$"]'],
};
const CYCLE = ['way["highway"="cycleway"]', 'way["highway"~"^(path|footway)$"]["bicycle"="designated"]'];
// Public green and natural land; private gardens, farmland and grass verges are left out.
const GREEN = [
  'nwr["leisure"~"^(park|nature_reserve)$"]',
  'nwr["landuse"~"^(forest|recreation_ground|village_green)$"]',
  'nwr["natural"~"^(wood|heath|grassland|scrub)$"]',
];

const around = (c: City) => `(around:${RADIUS_M},${c.lat},${c.lon})`;

async function overpass<T>(query: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(query)}` });
    if (res.ok) return (await res.json()) as T;
    if (attempt >= 5 || (res.status !== 429 && res.status < 500)) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 30_000 * attempt)); // Overpass asks clients to back off for tens of seconds
  }
}

interface CountOut { elements: { tags: Record<string, string> }[] }
interface GeomOut {
  osm3s: { timestamp_osm_base: string };
  elements: ({ type: "way"; geometry?: { lat: number; lon: number }[] } | { type: "relation"; members: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] } | { type: "node" })[];
}

async function counts(c: City): Promise<Record<string, number>> {
  const blocks = Object.values(COUNTS).map((sel) => `(${sel.map((s) => s + around(c)).join(";")};);out count;`);
  const q = `[out:json][timeout:600];${blocks.join("")}(${CYCLE.map((s) => s + around(c)).join(";")};);make stat km=sum(length())/1000;out;`;
  const res = await overpass<CountOut>(q);
  const names = Object.keys(COUNTS);
  const out: Record<string, number> = {};
  names.forEach((m, i) => (out[m] = Number(res.elements[i]!.tags.total)));
  out.cycle_paths_km = Math.round(Number(res.elements[names.length]!.tags.km));
  return out;
}

type Ring = number[][];
let landRings: Ring[] | null = null;
async function land(): Promise<Ring[]> {
  if (landRings) return landRings;
  const g = await getJson<{ features: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] }>(LAND);
  landRings = g.features.flatMap((f) => (f.geometry.type === "Polygon" ? [(f.geometry.coordinates as number[][][])[0]!] : (f.geometry.coordinates as number[][][][]).map((p) => p[0]!)));
  return landRings;
}

/** Share of the land within the radius that is public green or natural space, and the OSM snapshot it was read from. */
async function green(c: City): Promise<{ share: number; snapshot: string }> {
  const q = `[out:json][timeout:600];(${GREEN.map((s) => s + around(c)).join(";")};);out skel geom qt;`;
  const res = await overpass<GeomOut>(q);
  const g = new Grid(c, RADIUS_M / 1000, CELL_KM);
  const toRing = (geom: { lat: number; lon: number }[]) => geom.map((p) => [p.lon, p.lat]);
  for (const e of res.elements) {
    if (e.type === "way" && e.geometry) g.fill(toRing(e.geometry));
    else if (e.type === "relation") for (const ring of joinRings(e.members.filter((m) => m.type === "way" && m.role !== "inner" && m.geometry).map((m) => toRing(m.geometry!)))) g.fill(ring);
  }
  const l = new Grid(c, RADIUS_M / 1000, CELL_KM);
  for (const ring of await land()) l.fill(ring);
  let landCells = 0, greenCells = 0;
  for (let i = 0; i < l.cells.length; i++) {
    if (!l.cells[i] || !l.inCircle(i)) continue;
    landCells++;
    if (g.cells[i]) greenCells++;
  }
  return { share: landCells ? Math.round((1000 * greenCells) / landCells) / 10 : 0, snapshot: res.osm3s.timestamp_osm_base.slice(0, 10) };
}

const cities = await readJson<City[]>("data/cities.json");
const only = process.argv.slice(2);
const retrieved = today();
const load = async (): Promise<ObservationFile> => (existsSync(join(ROOT, FILE)) ? readJson<ObservationFile>(FILE) : { source: "osm", retrieved, observations: {} });
const done = (await load()).observations;
for (const c of cities) {
  if (only.length ? !only.includes(c.id) : done[c.id]?.length) continue; // resume where a previous run stopped
  const n = await counts(c);
  const gr = await green(c);
  const base = { period: gr.snapshot, level: "city" as const, source: "osm", retrieved };
  const note = "within 10 km of the centre";
  const list: Observation[] = [
    ...Object.entries(n).map(([metric, value]) => ({ metric, value, ...base, note })),
    { metric: "green_space_10km", value: gr.share, ...base, note: "share of the land within 10 km of the centre that is park, woodland or other public green space" },
  ];
  const out = await load(); // re-read: another run may have added cities meanwhile
  out.observations[c.id] = list;
  out.retrieved = retrieved;
  await writeJson(FILE, out);
  console.log(c.id.padEnd(18), list.map((o) => `${o.metric}=${o.value}`).join(" "));
  await new Promise((r) => setTimeout(r, 5_000));
}
