// Walking and cycling around the centre, from OpenStreetMap through the Overpass API (© OpenStreetMap contributors,
// ODbL 1.0, a share-alike licence: the figures stay under the ODbL wherever they go).
// Everyday needs on foot: every residential street within 5 km of the centre is a sample of where people live; a street
// counts when a food shop, a pharmacy or doctor, a school, a park and a public-transport stop are each within 1 km of
// its middle as the crow flies, about 15 minutes on foot once streets bend. Parks count from their nearest edge (their
// bounding box), everything else from its middle. When one need is missing for more than half the streets, the map is
// more likely thin than the city empty (Dubai's pharmacies), so no figure is given.
// Cycle network: kilometres of cycle paths (highway=cycleway, or paths and tracks designated for bicycles) plus roads
// with a cycle track kept apart from traffic tagged on them (cycleway=track on either side, counted once per road),
// within 10 km of the centre, per km² of land there (Natural Earth's land, so the sea does not dilute a coastal city).
// Painted lanes are left out. Counts measure how thoroughly a city is mapped as well as what exists.
// Node only: the queries are heavy for a public server, so they are not run from a browser.
import type { City, Observation } from "../../core/types.ts";
import { Grid } from "../../../pipeline/raster.ts";
import { round, type Fetcher, type FetchCtx } from "../context.ts";

export const OVERPASS = "https://overpass-api.de/api/interpreter";
const LAND = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson";
export const STREETS_KM = 5;
export const WALK_KM = 1;
export const BIKE_KM = 10;
/** A need missing for more than this share of streets says more about the map than the city. */
export const THIN_MAP = 0.5;

/** What a street needs within a walk, each with its OpenStreetMap selections. */
export const NEEDS: Record<string, string[]> = {
  food: ['nwr["shop"~"^(supermarket|convenience|greengrocer)$"]'],
  // Doctors' surgeries are mapped unevenly (well in Germany, rarely in Italy), so a pharmacy or a doctor will do.
  health: ['nwr["amenity"~"^(pharmacy|doctors|clinic)$"]', 'nwr["healthcare"~"^(pharmacy|doctor|clinic|centre)$"]'],
  school: ['nwr["amenity"="school"]'],
  park: ['nwr["leisure"="park"]'],
  stop: ['node["highway"="bus_stop"]', 'node["railway"~"^(station|halt|tram_stop)$"]', 'node["public_transport"="platform"]'],
};
const NEED_WORDS: Record<string, string> = { food: "a food shop", health: "a pharmacy or doctor", school: "a school", park: "a park", stop: "a stop" };

const around = (c: Pick<City, "lat" | "lon">, km: number) => `(around:${km * 1000},${c.lat},${c.lon})`;

/** One query: residential streets near the centre, then each need, each set announced by a marker element. */
export function walkQuery(c: Pick<City, "lat" | "lon">): string {
  const reach = STREETS_KM + WALK_KM;
  const parts = [`way["highway"~"^(residential|living_street)$"]${around(c, STREETS_KM)}->.s;make cat n="street";out;.s out ids center qt;`];
  for (const [k, sels] of Object.entries(NEEDS)) {
    parts.push(`(${sels.map((s) => s + around(c, reach)).join(";")};)->.${k};make cat n="${k}";out;node.${k};out skel qt;(way.${k};relation.${k};);out ids ${k === "park" ? "bb" : "center"} qt;`);
  }
  return `[out:json][timeout:600];${parts.join("")}`;
}

export function bikeQuery(c: Pick<City, "lat" | "lon">): string {
  const paths = ['way["highway"="cycleway"]', 'way["highway"~"^(path|footway|track|bridleway)$"]["bicycle"="designated"]'];
  const tracks = ['way["highway"]["highway"!="cycleway"][~"^cycleway(:both|:left|:right)?$"~"^(track|opposite_track)$"]'];
  const stat = (sels: string[]) => `(${sels.map((s) => s + around(c, BIKE_KM)).join(";")};);make stat km=sum(length())/1000;out;`;
  return `[out:json][timeout:600];${stat(paths)}${stat(tracks)}`;
}

type El = { type: string; tags?: Record<string, string>; lat?: number; lon?: number; center?: { lat: number; lon: number }; bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number } };

/** A box in km around the centre: [x0, y0, x1, y1]; a point is a box of no size. */
type Box = [number, number, number, number];

/** Splits an Overpass answer into its marked sets, each element as a box in km east and north of the centre. */
export function parseWalk(elements: El[], c: Pick<City, "lat" | "lon">): Record<string, Box[]> {
  const kx = 111.32 * Math.cos((c.lat * Math.PI) / 180), ky = 110.574;
  const x = (lon: number) => (lon - c.lon) * kx, y = (lat: number) => (lat - c.lat) * ky;
  const out: Record<string, Box[]> = {};
  let current = "";
  for (const e of elements) {
    if (e.type === "cat") {
      current = e.tags?.n ?? "";
      out[current] ??= [];
      continue;
    }
    const p = e.center ?? (e.lat !== undefined ? { lat: e.lat, lon: e.lon! } : null);
    if (e.bounds) out[current]!.push([x(e.bounds.minlon), y(e.bounds.minlat), x(e.bounds.maxlon), y(e.bounds.maxlat)]);
    else if (p) out[current]!.push([x(p.lon), y(p.lat), x(p.lon), y(p.lat)]);
  }
  return out;
}

const boxDistance = (px: number, py: number, b: Box) => Math.hypot(Math.max(b[0] - px, 0, px - b[2]), Math.max(b[1] - py, 0, py - b[3]));

/**
 * Share of streets with every need within `km`, and how many streets lack each need. Needs are bucketed in a grid of
 * `km` cells, so each street looks only at the cells around it; a large park is put in every cell its box touches.
 */
export function walkable(sets: Record<string, Box[]>, needs = Object.keys(NEEDS), km = WALK_KM): { share: number; streets: number; lacking: Record<string, number> } {
  const streets = sets.street ?? [];
  const cell = (v: number) => Math.floor(v / km);
  const grids = new Map<string, Map<string, Box[]>>();
  for (const n of needs) {
    const g = new Map<string, Box[]>();
    for (const b of sets[n] ?? []) {
      for (let i = cell(b[0]); i <= cell(b[2]); i++)
        for (let j = cell(b[1]); j <= cell(b[3]); j++) {
          const k = `${i},${j}`;
          if (!g.has(k)) g.set(k, []);
          g.get(k)!.push(b);
        }
    }
    grids.set(n, g);
  }
  const lacking: Record<string, number> = Object.fromEntries(needs.map((n) => [n, 0]));
  let ok = 0;
  for (const s of streets) {
    const [px, py] = [s[0], s[1]];
    let all = true;
    for (const n of needs) {
      const g = grids.get(n)!;
      let found = false;
      for (let i = cell(px) - 1; i <= cell(px) + 1 && !found; i++)
        for (let j = cell(py) - 1; j <= cell(py) + 1 && !found; j++) for (const b of g.get(`${i},${j}`) ?? []) if (boxDistance(px, py, b) <= km) (found = true);
      if (!found) (lacking[n]!++, (all = false));
    }
    if (all) ok++;
  }
  return { share: streets.length ? round((100 * ok) / streets.length, 0) : 0, streets: streets.length, lacking };
}

/** Whether one need is missing so widely that the map, not the city, is the likelier reason. */
export const thinMap = (r: { streets: number; lacking: Record<string, number> }) => Object.values(r.lacking).some((n) => n > r.streets * THIN_MAP);

/** The needs most often missing, in words, for the note. */
export function lackingWords(r: { streets: number; lacking: Record<string, number> }): string {
  const top = Object.entries(r.lacking).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return top.length ? `most often missing: ${top.map(([k, n]) => `${NEED_WORDS[k]} (${round((100 * n) / r.streets, 0)}% of streets)`).join(", ")}` : "nothing missing";
}

type Ring = number[][];
let landRings: Promise<Ring[]> | null = null;
function land(ctx: FetchCtx): Promise<Ring[]> {
  landRings ??= ctx.bulk(LAND).then((b) => {
    const g = JSON.parse(new TextDecoder().decode(b)) as { features: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
    return g.features.flatMap((f) => (f.geometry.type === "Polygon" ? [(f.geometry.coordinates as number[][][])[0]!] : (f.geometry.coordinates as number[][][][]).map((p) => p[0]!)));
  });
  landRings.catch(() => (landRings = null));
  return landRings;
}

/** Land within the radius, km², on a 100 m grid. */
export function landArea(c: Pick<City, "lat" | "lon">, rings: Ring[], radiusKm = BIKE_KM): number {
  const g = new Grid(c, radiusKm, 0.1);
  for (const r of rings) g.fill(r);
  let n = 0;
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] && g.inCircle(i)) n++;
  return n * 0.01;
}

async function overpass<T>(ctx: FetchCtx, query: string): Promise<T> {
  return ctx.json<T>(OVERPASS, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(query)}` });
}

export const osmWalkCycle: Fetcher = {
  source: "osm-walk-cycle",
  version: 1,
  runtimes: ["node"],
  async fetch(city, ctx) {
    const retrieved = ctx.now().toISOString();
    const walk = await overpass<{ osm3s: { timestamp_osm_base: string }; elements: El[] }>(ctx, walkQuery(city));
    const period = walk.osm3s.timestamp_osm_base.slice(0, 10);
    const base = { period, level: "city" as const, source: "osm-walk-cycle", retrieved, url: OVERPASS, fetcher: "osm-walk-cycle@1" };
    const out: Observation[] = [];
    const w = walkable(parseWalk(walk.elements, city));
    if (w.streets >= 50 && !thinMap(w)) out.push({ metric: "walkable_share", value: w.share, ...base, note: `${w.streets.toLocaleString("en-GB")} residential streets within ${STREETS_KM} km of the centre; ${lackingWords(w)}` });
    const bike = await overpass<{ elements: { tags: Record<string, string> }[] }>(ctx, bikeQuery(city));
    const [paths, tracks] = bike.elements.map((e) => Number(e.tags.km));
    const area = landArea(city, await land(ctx));
    if (area > 0 && Number.isFinite(paths) && Number.isFinite(tracks))
      out.push({ metric: "bike_network", value: round((paths! + tracks!) / area, 2), ...base, note: `${Math.round(paths!)} km of cycle paths and ${Math.round(tracks!)} km of roads with a separate cycle track, over ${Math.round(area)} km² of land within ${BIKE_KM} km of the centre` });
    return out;
  },
};
