// How far the dense city reaches from its centre, from the GHSL Urban Centre Database 2025 (European Commission, Joint
// Research Centre, CC BY 4.0). An urban centre is a cluster of contiguous 1 km squares with at least 1,500 residents per
// km² (or mostly built up), holding at least 50,000 people. From the city's centre point, 72 rays (one every 5°) run to
// where each first leaves that outline; a ray that leaves into the sea or a lake, or back into the dense city within 3 km,
// is dropped, since nobody rides out that
// way. The figure is the shortest of the rest: how soon a cyclist taking the quickest way out reaches the end of the
// dense city, which is suburbs, farmland, hills or a large park, not necessarily open country.
// Node only: the database is a 6.6 MB zip holding a GeoPackage (SQLite), read with node:sqlite and the system `unzip`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { City, Observation } from "../../core/types.ts";
import { round, type Fetcher, type FetchCtx } from "../context.ts";

export const GHSL_ZIP =
  "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_UCDB_GLOBE_R2024A/GHS_UCDB_THEME_GLOBE_R2024A/GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A/V1-2/GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A_V1_2.zip";
const TABLE = "GHSL_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A";
const FILE = "GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A.gpkg";
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
// Natural Earth's world lakes plus its more detailed North American and European lakes (Lake Washington, the Swiss lakes).
const LAND = `${NE}/ne_10m_land.geojson`;
const LAKES = ["ne_10m_lakes", "ne_10m_lakes_north_america", "ne_10m_lakes_europe"].map((n) => `${NE}/${n}.geojson`);

const R = 6_378_137; // ESRI:54009, World Mollweide on the WGS 84 radius
const SQRT2 = Math.SQRT2;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;
export const RAYS = 72;
/** Points past the edge a ray checks, km: all must be on land and outside the dense city. Natural Earth draws shores
 * to within about a kilometre, so a ray running out along a port or a beach meets water within these 3 km. */
export const BEYOND_KM = [0.5, 1, 1.5, 2, 2.5, 3];

/** World Mollweide metres -> [lon, lat] degrees. */
export function fromMollweide(x: number, y: number): [number, number] {
  const theta = Math.asin(Math.max(-1, Math.min(1, y / (SQRT2 * R))));
  const lat = Math.asin(Math.max(-1, Math.min(1, (2 * theta + Math.sin(2 * theta)) / Math.PI)));
  const lon = (Math.PI * x) / (2 * SQRT2 * R * Math.cos(theta));
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** [lon, lat] degrees -> World Mollweide metres. */
export function toMollweide(lon: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  let theta = phi;
  if (Math.abs(Math.abs(phi) - Math.PI / 2) > 1e-9) {
    for (let i = 0; i < 50; i++) {
      const d = -(2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(phi)) / (2 + 2 * Math.cos(2 * theta));
      theta += d;
      if (Math.abs(d) < 1e-12) break;
    }
  }
  return [((2 * SQRT2) / Math.PI) * R * ((lon * Math.PI) / 180) * Math.cos(theta), SQRT2 * R * Math.sin(theta)];
}

type Ring = number[][]; // [x, y] pairs

/** The rings of a GeoPackage geometry blob (a WKB polygon or multipolygon after the GP header), in its own coordinates. */
export function gpkgRings(blob: Uint8Array): Ring[][] {
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  if (blob[0] !== 0x47 || blob[1] !== 0x50) throw new Error("not a GeoPackage geometry");
  const flags = blob[3]!;
  const envelope = [0, 32, 48, 48, 64][(flags >> 1) & 7] ?? 0;
  let o = 8 + envelope;
  const polygons: Ring[][] = [];
  const readPolygon = (): Ring[] => {
    const le = blob[o] === 1;
    o += 5; // byte order, type
    const rings: Ring[] = [];
    const nr = v.getUint32(o, le);
    o += 4;
    for (let r = 0; r < nr; r++) {
      const np = v.getUint32(o, le);
      o += 4;
      const ring: Ring = [];
      for (let p = 0; p < np; p++, o += 16) ring.push([v.getFloat64(o, le), v.getFloat64(o + 8, le)]);
      rings.push(ring);
    }
    return rings;
  };
  const le = blob[o] === 1;
  const type = v.getUint32(o + 1, le) % 1000;
  if (type === 3) polygons.push(readPolygon());
  else if (type === 6) {
    const n = v.getUint32(o + 5, le);
    o += 9;
    for (let i = 0; i < n; i++) polygons.push(readPolygon());
  } else throw new Error(`unexpected geometry type ${type}`);
  return polygons;
}

/** Even-odd point in polygon over all its rings. */
export function inside(p: number[], rings: Ring[]): boolean {
  let c = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if (yi! > p[1]! !== yj! > p[1]! && p[0]! < ((xj! - xi!) * (p[1]! - yi!)) / (yj! - yi!) + xi!) c = !c;
    }
  return c;
}

/** Distance along a ray from the origin (unit direction d) to its first crossing of any ring edge, or Infinity. */
export function firstCrossing(rings: Ring[], d: [number, number]): number {
  let best = Infinity;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]!, [bx, by] = ring[i]!;
      const ex = bx! - ax!, ey = by! - ay!;
      const den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (ax! * ey - ay! * ex) / den; // along the ray
      const s = (ax! * d[1] - ay! * d[0]) / den; // along the edge
      if (t > 1e-9 && s >= 0 && s <= 1 && t < best) best = t;
    }
  return best;
}

export interface EdgeResult {
  /** Shortest distance from the centre to the edge, over the directions that leave onto land, km. */
  nearestKm: number;
  /** Compass bearing of that direction, degrees. */
  bearing: number;
  /** Median over the same directions, km. */
  medianKm: number;
  /** Directions that left onto land, of RAYS. */
  landRays: number;
}

/**
 * Where the dense city ends, seen from its centre at (0, 0): `rings` in km east and north of the centre; `onLand` says
 * whether a point (km) is on land and not in a lake. Null when no ray leaves onto land.
 */
export function cityEdge(rings: Ring[], onLand: (x: number, y: number) => boolean): EdgeResult | null {
  const hits: { t: number; bearing: number }[] = [];
  for (let k = 0; k < RAYS; k++) {
    const bearing = (360 * k) / RAYS;
    const a = (bearing * Math.PI) / 180;
    const d: [number, number] = [Math.sin(a), Math.cos(a)];
    const t = firstCrossing(rings, d);
    if (!Number.isFinite(t)) continue;
    const clear = BEYOND_KM.every((b) => {
      const p = [d[0] * (t + b), d[1] * (t + b)];
      return !inside(p, rings) && onLand(p[0]!, p[1]!);
    });
    if (!clear) continue;
    hits.push({ t, bearing });
  }
  if (!hits.length) return null;
  const sorted = [...hits].sort((a, b) => a.t - b.t);
  const ts = sorted.map((h) => h.t);
  const m = ts.length >> 1;
  return { nearestKm: sorted[0]!.t, bearing: sorted[0]!.bearing, medianKm: ts.length % 2 ? ts[m]! : (ts[m - 1]! + ts[m]!) / 2, landRays: hits.length };
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export const compass = (bearing: number) => COMPASS[Math.round(bearing / 45) % 8]!;

// ---------- reading the files ----------

interface Centre { id: number; name: string; country: string; population: number; polygons: Ring[][] }

let centres: Promise<{ rows: { id: number; name: string; country: string; population: number; env: number[]; geom: Uint8Array }[] }> | null = null;

function loadCentres(ctx: FetchCtx) {
  centres ??= (async () => {
    const zip = await ctx.bulk(GHSL_ZIP);
    const dir = mkdtempSync(join(tmpdir(), "wtl-ghsl-"));
    writeFileSync(join(dir, "ucdb.zip"), zip);
    const gpkg = execFileSync("unzip", ["-p", join(dir, "ucdb.zip"), FILE], { maxBuffer: 1 << 28 });
    writeFileSync(join(dir, "ucdb.gpkg"), gpkg);
    // Loaded here, not at the top: Node 22 warns that node:sqlite is experimental, and only this source needs it.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(dir, "ucdb.gpkg"), { readOnly: true });
    const rows = (db.prepare(`SELECT ID_UC_G0 AS id, GC_UCN_MAI_2025 AS name, GC_CNT_GAD_2025 AS country, GC_POP_TOT_2025 AS population, geom FROM ${TABLE}`).all() as { id: number; name: string; country: string; population: number; geom: Uint8Array }[]).map((r) => {
      const v = new DataView(r.geom.buffer, r.geom.byteOffset, r.geom.byteLength);
      const le = (r.geom[3]! & 1) === 1;
      return { ...r, env: [0, 1, 2, 3].map((i) => v.getFloat64(8 + 8 * i, le)) }; // minx, maxx, miny, maxy
    });
    db.close();
    return { rows };
  })();
  centres.catch(() => (centres = null));
  return centres;
}

/** The urban centre whose outline holds the point; "gap" when the point is only inside one's bounding box. */
async function centreAt(ctx: FetchCtx, lon: number, lat: number): Promise<Centre | "gap" | null> {
  const { rows } = await loadCentres(ctx);
  const [x, y] = toMollweide(lon, lat);
  let boxed = false;
  for (const r of rows) {
    const [x0, x1, y0, y1] = r.env;
    if (x < x0! || x > x1! || y < y0! || y > y1!) continue;
    boxed = true;
    const polygons = gpkgRings(r.geom);
    if (polygons.some((rings) => inside([x, y], rings))) return { id: r.id, name: r.name, country: r.country, population: r.population, polygons };
  }
  return boxed ? "gap" : null;
}

type GeoJson = { features: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
const polygonsOf = (g: GeoJson): number[][][][] =>
  g.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][])));
const water = new Map<string, Promise<number[][][][]>>();
function shapes(ctx: FetchCtx, url: string) {
  if (!water.has(url)) water.set(url, ctx.bulk(url).then((b) => polygonsOf(JSON.parse(new TextDecoder().decode(b)) as GeoJson)));
  return water.get(url)!;
}

/** Local km plane around a point: [lon, lat] -> [km east, km north]. */
export function localKm(lat0: number, lon0: number) {
  const kx = KM_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180);
  return {
    to: (lon: number, lat: number): [number, number] => [(lon - lon0) * kx, (lat - lat0) * KM_PER_DEG_LAT],
    from: (x: number, y: number): [number, number] => [lon0 + x / kx, lat0 + y / KM_PER_DEG_LAT],
  };
}

/** Polygons (lon/lat) whose box comes within `km` of the point, so point tests stay cheap. */
function near(polys: number[][][][], lon: number, lat: number, km: number): number[][][][] {
  const dLat = km / KM_PER_DEG_LAT, dLon = km / (KM_PER_DEG_LON * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return polys.filter((p) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of p[0]!) (x0 = Math.min(x0, x!)), (x1 = Math.max(x1, x!)), (y0 = Math.min(y0, y!)), (y1 = Math.max(y1, y!));
    return x1 >= lon - dLon && x0 <= lon + dLon && y1 >= lat - dLat && y0 <= lat + dLat;
  });
}

export const ghsl: Fetcher = {
  source: "ghsl-ucdb",
  version: 1,
  runtimes: ["node"],
  async fetch(city: City, ctx: FetchCtx): Promise<Observation[]> {
    const retrieved = ctx.now().toISOString();
    const base = { metric: "city_edge_km", period: "2025", level: "city" as const, source: "ghsl-ucdb", retrieved, url: GHSL_ZIP, fetcher: "ghsl-ucdb@1" };
    const uc = await centreAt(ctx, city.lon, city.lat);
    // A centre point in a gap of an urban centre (Dubai's sits between districts) says nothing about the way out.
    if (uc === "gap") return [];
    if (!uc) return [{ ...base, value: 0, note: "the centre point lies outside any GHSL urban centre (a dense cluster of at least 50,000 people), so the dense city is already behind you" }];
    const plane = localKm(city.lat, city.lon);
    const rings = uc.polygons.flatMap((p) => p.map((ring) => ring.map(([x, y]) => plane.to(...fromMollweide(x!, y!)))));
    let reach = 0;
    for (const r of rings) for (const [x, y] of r) reach = Math.max(reach, Math.hypot(x!, y!));
    const [land, ...lakeSets] = await Promise.all([LAND, ...LAKES].map((u) => shapes(ctx, u)));
    const lakes = lakeSets.flat();
    const nearLand = near(land!, city.lon, city.lat, reach + 2), nearLakes = near(lakes, city.lon, city.lat, reach + 2);
    const onLand = (x: number, y: number) => {
      const p = plane.from(x, y);
      return nearLand.some((poly) => inside(p, poly)) && !nearLakes.some((poly) => inside(p, poly));
    };
    const e = cityEdge(rings, onLand);
    if (!e) return [];
    return [
      {
        ...base,
        value: round(e.nearestKm, 1),
        note: `${uc.name} urban centre (${Math.round(uc.population).toLocaleString("en-GB")} people, 2025): nearest edge ${round(e.nearestKm, 1)} km to the ${compass(e.bearing)}; half the directions over land end within ${round(e.medianKm, 1)} km`,
      },
    ];
  },
};
