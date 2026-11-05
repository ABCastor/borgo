// Builds the world map (data/map/world.json): land tiles on the Equal Earth projection, each with its country and
// twelve monthly average afternoon highs, and the populated places a click on the map can pick. An island too small for
// the grid's sampling still gets its tile when it holds a town of 50,000 people or more (the Canaries, Madeira, the
// Azores, Malta, Mauritius), with the climate of the POWER point nearest that town.
// - Land, countries and places: Natural Earth 1:50m admin-0 countries and 1:10m populated places (public domain).
// - Afternoon highs: NASA POWER's climatology (MERRA-2, 2001-2025, about 0.5° by 0.625°): the monthly mean air
//   temperature plus half the mean daily range, read for every 10° box that holds land, averaged over the POWER
//   points on land inside each tile.
// Usage: node pipeline/sources/world-map.ts  (POWER answers are kept in $WHERE_TO_LIVE_HOME/bulk/nasa-power/)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { project, unproject } from "../../src/core/equal-earth.ts";
import type { WorldMap } from "../../src/core/world-map.ts";
import { getJson, readJson, ROOT, today } from "../lib.ts";
import type { Country } from "../../src/core/types.ts";

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const POWER = (param: string, lat: number, lon: number) =>
  `https://power.larc.nasa.gov/api/temporal/climatology/regional?latitude-min=${lat}&latitude-max=${lat + 10}&longitude-min=${lon}&longitude-max=${lon + 10}&parameters=${param}&community=RE&format=JSON`;
const COLS = 200;
const LAT_TOP = 84;
const LAT_BOTTOM = -56;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** Towns a click can add, and that make their tile land even when the grid's sampling misses their island. */
const PLACE_MIN_POP = 50_000;
/** Natural Earth areas without a usable ISO code: Kosovo has one; the others stay uncoded rather than guessed. */
const CODE_BY_NAME: Record<string, string> = { Kosovo: "XK" };

type Ring = number[][];
interface Shape { code: string; polys: Ring[][]; bbox: [number, number, number, number] }
interface Geo<P> { features: { properties: P; geometry: { type: string; coordinates: unknown } }[] }

const countries = await readJson<Record<string, Country>>("data/countries.json");

// ---------- Countries ----------

const ne = await getJson<Geo<{ ISO_A2_EH: string; ADMIN: string; NAME: string }>>(`${NE}/ne_50m_admin_0_countries.geojson`);
const shapes: Shape[] = [];
for (const f of ne.features) {
  const raw = f.properties.ISO_A2_EH;
  const code = raw !== "-99" && countries[raw] ? raw : CODE_BY_NAME[f.properties.NAME] ?? "";
  if (raw === "AQ") continue;
  const polys = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const p of polys) for (const [x, y] of p[0]!) [w, s, e, n] = [Math.min(w, x!), Math.min(s, y!), Math.max(e, x!), Math.max(n, y!)];
  shapes.push({ code, polys, bbox: [w, s, e, n] });
}

function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

/** The shape a point falls in, or null at sea. */
function countryAt(lon: number, lat: number): Shape | null {
  for (const s of shapes) {
    const [w, so, e, n] = s.bbox;
    if (lon < w || lon > e || lat < so || lat > n) continue;
    for (const p of s.polys) if (inRing(p[0]!, lon, lat) && !p.slice(1).some((h) => inRing(h, lon, lat))) return s;
  }
  return null;
}

// ---------- Towns (Natural Earth 1:10m populated places) ----------

// The full file, not the "simple" one: it carries each town's GeoNames id, so a click or an island resolves exactly.
const pp = await getJson<Geo<{ NAME: string; ISO_A2: string; ADM0NAME: string; LATITUDE: number; LONGITUDE: number; POP_MAX: number; ADM0CAP: number; GEONAMESID?: number }>>(`${NE}/ne_10m_populated_places.geojson`);
interface Town { name: string; cc: string; lat: number; lon: number; pop: number; capital: boolean; geonames: number }
const towns: Town[] = [];
for (const { properties: p } of pp.features) {
  const cc = countries[p.ISO_A2] ? p.ISO_A2 : CODE_BY_NAME[p.ADM0NAME] ?? "";
  const geonames = p.GEONAMESID && p.GEONAMESID > 0 ? p.GEONAMESID : 0;
  if (cc) towns.push({ name: p.NAME, cc, lat: p.LATITUDE, lon: p.LONGITUDE, pop: p.POP_MAX, capital: !!p.ADM0CAP, geonames });
}

// ---------- The grid ----------

const XMAX = project(180, 0)[0];
const pitch = (2 * XMAX) / COLS;
const y0 = project(0, LAT_TOP)[1];
const rows = Math.ceil((y0 - project(0, LAT_BOTTOM)[1]) / pitch);
const x0 = -XMAX;

interface Tile { col: number; row: number; code: string; lats: number[]; lons: number[] }
const tiles: Tile[] = [];
const SUB = [1 / 6, 3 / 6, 5 / 6];
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < COLS; col++) {
    const votes = new Map<string, number>();
    const lats: number[] = [];
    const lons: number[] = [];
    let land = 0;
    for (const sy of SUB) {
      for (const sx of SUB) {
        const ll = unproject(x0 + (col + sx) * pitch, y0 - (row + sy) * pitch);
        if (!ll) continue;
        lons.push(ll[0]);
        lats.push(ll[1]);
        const s = countryAt(ll[0], ll[1]);
        if (!s) continue;
        land++;
        votes.set(s.code, (votes.get(s.code) ?? 0) + 1);
      }
    }
    // A tile is land when at least two of its nine sample points are, so small islands and thin coasts still show.
    if (land < 2) continue;
    const code = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    tiles.push({ col, row, code, lats, lons });
  }
}
console.log(`${tiles.length} land tiles on a ${COLS} x ${rows} grid`);

// Islands the sampling misses: the tile of every town of 50,000 or more is land, in the town's country.
const tileAt = (lon: number, lat: number) => {
  const [x, y] = project(lon, lat);
  return { col: Math.floor((x - x0) / pitch), row: Math.floor((y0 - y) / pitch) };
};
const landCells = new Set(tiles.map((t) => `${t.col},${t.row}`));
/** Tiles that are land because of a town, with that town, whose nearest POWER point gives the tile its climate. */
const townTile = new Map<string, Town>();
for (const t of towns.filter((t) => t.pop >= PLACE_MIN_POP && t.lat <= LAT_TOP && t.lat >= LAT_BOTTOM).sort((a, b) => b.pop - a.pop)) {
  const { col, row } = tileAt(t.lon, t.lat);
  const key = `${col},${row}`;
  if (col < 0 || col >= COLS || row < 0 || row >= rows || landCells.has(key)) continue;
  landCells.add(key);
  townTile.set(key, t);
  const lats: number[] = [t.lat];
  const lons: number[] = [t.lon];
  for (const sy of SUB) for (const sx of SUB) {
    const ll = unproject(x0 + (col + sx) * pitch, y0 - (row + sy) * pitch);
    if (ll) [lons[lons.length], lats[lats.length]] = ll;
  }
  tiles.push({ col, row, code: t.cc, lats, lons });
}
console.log(`${townTile.size} more tiles for islands and coasts with a town of ${PLACE_MIN_POP.toLocaleString("en-GB")} or more`);

// ---------- NASA POWER, one 10° box at a time ----------

const cacheDir = join(process.env.WHERE_TO_LIVE_HOME ?? join(homedir(), ".cache/where-to-live"), "bulk/nasa-power");
mkdirSync(cacheDir, { recursive: true });

const boxes = new Set<string>();
for (const t of tiles) {
  for (let i = 0; i < t.lats.length; i++) {
    const lat = Math.max(-60, Math.min(80, Math.floor(t.lats[i]! / 10) * 10));
    const lon = Math.max(-180, Math.min(170, Math.floor(t.lons[i]! / 10) * 10));
    boxes.add(`${lat},${lon}`);
  }
}
console.log(`${boxes.size} POWER boxes of 10° hold land`);

interface PowerAnswer {
  header?: { range?: string; api?: { version?: string } };
  features?: { geometry: { coordinates: number[] }; properties: { parameter: Record<string, Record<string, number>> } }[];
  messages?: string[];
}

let powerRange = "";
let powerApi = "";
async function box(param: string, lat: number, lon: number): Promise<PowerAnswer> {
  const file = join(cacheDir, `${param}_${lat}_${lon}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as PowerAnswer;
  const answer = await getJson<PowerAnswer>(POWER(param, lat, lon));
  if (!answer.features) throw new Error(`POWER gave no grid for ${param} at ${lat},${lon}: ${(answer.messages ?? []).join(" ")}`);
  writeFileSync(file, JSON.stringify(answer));
  return answer;
}

/** Monthly values by point, keyed "lat,lon". */
const points = new Map<string, { lat: number; lon: number; mean?: number[]; range?: number[] }>();
const list = [...boxes].map((b) => b.split(",").map(Number) as [number, number]);
let done = 0;
async function worker(): Promise<void> {
  for (;;) {
    const next = list.pop();
    if (!next) return;
    const [lat, lon] = next;
    for (const [param, field] of [["T2M", "mean"], ["T2M_RANGE", "range"]] as const) {
      const a = await box(param, lat, lon);
      if (a.header?.range) powerRange = a.header.range;
      if (a.header?.api?.version) powerApi = a.header.api.version;
      for (const f of a.features ?? []) {
        const [plon, plat] = f.geometry.coordinates as [number, number];
        const v = f.properties.parameter[param];
        if (!v) continue;
        const months = MONTHS.map((m) => v[m]!);
        if (months.some((x) => x === undefined || x <= -999)) continue;
        const key = `${plat.toFixed(3)},${plon.toFixed(3)}`;
        const p = points.get(key) ?? { lat: plat, lon: plon };
        p[field] = months;
        points.set(key, p);
      }
    }
    if (++done % 25 === 0) console.log(`  ${done} of ${boxes.size} boxes`);
  }
}
await Promise.all([worker(), worker(), worker()]);

// ---------- Each tile's highs: the POWER points on land inside it, else the nearest point on land ----------

interface Pt { lat: number; lon: number; high: number[]; land: boolean; col: number; row: number }
const pts: Pt[] = [];
for (const p of points.values()) {
  if (!p.mean || !p.range) continue;
  const [x, y] = project(p.lon, p.lat);
  pts.push({
    lat: p.lat,
    lon: p.lon,
    high: p.mean.map((m, i) => m + p.range![i]! / 2),
    land: !!countryAt(p.lon, p.lat),
    col: Math.floor((x - x0) / pitch),
    row: Math.floor((y0 - y) / pitch),
  });
}
const byTile = new Map<string, Pt[]>();
for (const p of pts) {
  const k = `${p.col},${p.row}`;
  (byTile.get(k) ?? byTile.set(k, []).get(k)!).push(p);
}

function nearestLand(t: Tile): Pt | null {
  let best: Pt | null = null;
  let bd = Infinity;
  for (let dr = -3; dr <= 3; dr++) {
    for (let dc = -3; dc <= 3; dc++) {
      for (const p of byTile.get(`${t.col + dc},${t.row + dr}`) ?? []) {
        if (!p.land) continue;
        const d = dc * dc + dr * dr;
        if (d < bd) [best, bd] = [p, d];
      }
    }
  }
  return best;
}

const codes = [...new Set(tiles.map((t) => t.code))].sort();
const flatTiles: number[] = [];
const highs: number[] = [];
let fromNeighbour = 0;
let dropped = 0;
/** The POWER point nearest a town, from its tile and the tiles around it. */
function nearestTo(town: Town, t: Tile): Pt | null {
  let best: Pt | null = null;
  let bd = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      for (const p of byTile.get(`${t.col + dc},${t.row + dr}`) ?? []) {
        const d = (p.lat - town.lat) ** 2 + ((p.lon - town.lon) * Math.cos((town.lat * Math.PI) / 180)) ** 2;
        if (d < bd) [best, bd] = [p, d];
      }
    }
  }
  return best;
}

let fromTown = 0;
for (const t of tiles) {
  const inside = byTile.get(`${t.col},${t.row}`) ?? [];
  let use = inside.filter((p) => p.land);
  // A small island's tile: its own land points, else the point nearest its town (sea around it, not the next coast).
  const town = townTile.get(`${t.col},${t.row}`);
  if (!use.length && town) {
    const n = nearestTo(town, t);
    if (n) {
      use = [n];
      fromTown++;
    }
  }
  if (!use.length) {
    const n = nearestLand(t);
    if (n) {
      use = [n];
      fromNeighbour++;
    } else use = inside;
  }
  if (!use.length) {
    dropped++;
    continue;
  }
  flatTiles.push(t.col, t.row, codes.indexOf(t.code));
  for (let m = 0; m < 12; m++) highs.push(Math.round((use.reduce((s, p) => s + p.high[m]!, 0) / use.length) * 10));
}
console.log(`${flatTiles.length / 3} tiles with highs (${fromNeighbour} from the nearest land point, ${fromTown} from the point nearest an island's town, ${dropped} dropped)`);

// ---------- Places a click can add ----------

// Towns of 50,000 or more, and every capital.
const places: WorldMap["places"] = [];
for (const t of towns) {
  if (t.pop < PLACE_MIN_POP && !t.capital) continue;
  const place: WorldMap["places"][number] = [t.name, t.cc, Math.round(t.lat * 1000) / 1000, Math.round(t.lon * 1000) / 1000, t.pop, t.geonames];
  if (t.capital) place.push(1);
  places.push(place);
}
places.sort((a, b) => b[4] - a[4]);
console.log(`${places.length} places`);

const retrieved = today();
const map: WorldMap = {
  version: retrieved,
  projection: "equal-earth",
  x0: Number(x0.toFixed(6)),
  y0: Number(y0.toFixed(6)),
  pitch: Number(pitch.toFixed(8)),
  cols: COLS,
  rows,
  countries: codes,
  tiles: flatTiles,
  highs,
  places,
  sources: [
    { id: "natural-earth", what: "land, countries and populated places with their GeoNames ids (1:50m admin-0 countries, 1:10m populated places)", period: "Natural Earth 5.1", retrieved },
    { id: "nasa-power", what: `average afternoon high by month: mean air temperature plus half the mean daily range, MERRA-2 on POWER's grid, from the POWER Climatology API ${powerApi || "v2"}`, period: powerRange || "2001-2025", retrieved },
  ],
};
// One key per line: the big number lists stay on one line each, so the file stays small and diffs stay readable.
mkdirSync(join(ROOT, "data/map"), { recursive: true });
writeFileSync(join(ROOT, "data/map/world.json"), `{\n${Object.entries(map).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`);
console.log("wrote data/map/world.json");
