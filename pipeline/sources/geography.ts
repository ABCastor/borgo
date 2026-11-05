// Distance to the sea and to the mountains, computed from open geodata:
// - the sea: Natural Earth 1:10m coastline (public domain); lakes do not count, so Chicago is far from the sea,
//   and nor do the tidal rivers Natural Earth draws as coast up to inland ports (see RIVERS).
// - the mountains: the nearest ground rising 1,000 m above the city centre, from the open terrain tiles on AWS
//   (Terrarium encoding, about 430 m per pixel at zoom 8; SRTM, GMTED, ETOPO, EU-DEM and national models, with attribution).
// Measured from the city's centre point in a straight line; searches stop at 300 km.
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { greatCircleKm } from "../../src/core/geo.ts";
import { decodePng } from "../png.ts";
import { distanceToLines, fromPixel, terrarium, tilesAround, toPixel } from "../terrain.ts";
import { getJson, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

const COAST = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson";
const TILE = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const ZOOM = 8;
const RISE_M = 1_000;
const LIMIT_KM = 300;

// Tidal rivers drawn as coastline far inland, which would put Hamburg 11 km and Montreal 4 km from "the sea".
// Boxes are [west, south, east, north]; a coastline segment touching one is ignored. Coarser Natural Earth scales
// drop these rivers but also bays and fjords (Tokyo, Oslo), and the elevation data's sea floor is too coarse to tell.
const RIVERS: Record<string, [number, number, number, number]> = {
  "Elbe above Cuxhaven": [8.9, 53.4, 10.2, 53.95],
  "Scheldt above Vlissingen": [3.6, 51.0, 4.5, 51.5],
  "St Lawrence above Tadoussac": [-76.6, 44.0, -70.0, 47.6],
  "Hudson above Yonkers": [-74.2, 40.95, -73.85, 42.8],
};

const inRiver = ([lon, lat]: number[]) => Object.values(RIVERS).some(([w, s, e, n]) => lon! >= w && lon! <= e && lat! >= s && lat! <= n);

/** Splits polylines wherever they enter a masked river, keeping the open-sea parts. */
function seaOnly(lines: number[][][]): number[][][] {
  const out: number[][][] = [];
  for (const line of lines) {
    let run: number[][] = [];
    for (const pt of line) {
      if (inRiver(pt)) {
        if (run.length > 1) out.push(run);
        run = [];
      } else run.push(pt);
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}

interface Lines { features: { geometry: { type: string; coordinates: number[][] | number[][][] } }[] }

const coast = await getJson<Lines>(COAST);
const lines = seaOnly(coast.features.flatMap((f) => (f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [f.geometry.coordinates as number[][]])));

const cache = mkdtempSync(join(tmpdir(), "terrain-"));
async function tile(x: number, y: number): Promise<Float32Array> {
  const file = join(cache, `${ZOOM}-${x}-${y}.png`);
  if (!existsSync(file)) {
    const res = await fetch(TILE(ZOOM, x, y), { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${res.status} for tile ${ZOOM}/${x}/${y}`);
    writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
  }
  const img = decodePng(readFileSync(file));
  const out = new Float32Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) {
    const p = i * img.channels;
    out[i] = terrarium(img.pixels[p]!, img.pixels[p + 1]!, img.pixels[p + 2]!);
  }
  return out;
}

async function elevationAt(c: City): Promise<number> {
  const px = toPixel(c, ZOOM);
  const t = await tile(Math.floor(px.x / 256), Math.floor(px.y / 256));
  return t[(Math.floor(px.y) % 256) * 256 + (Math.floor(px.x) % 256)]!;
}

/** True when most of a pixel's 3 x 3 neighbourhood clears the threshold: tiles carry one-pixel spikes that are not hills. */
function solid(t: Float32Array, i: number, threshold: number): boolean {
  const x = i % 256, y = Math.floor(i / 256);
  let above = 0, seen = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx > 255 || ny > 255) continue;
      seen++;
      if (t[ny * 256 + nx]! >= threshold) above++;
    }
  }
  return above * 2 > seen;
}

/** Distance to the nearest solid pixel at or above `threshold` metres, nearest tiles first, stopping once no tile can beat it. */
async function nearestAbove(c: City, threshold: number): Promise<{ km: number; at?: { lat: number; lon: number; m: number } }> {
  let best: { km: number; at?: { lat: number; lon: number; m: number } } = { km: Infinity };
  for (const { tx, ty, minKm } of tilesAround(c, LIMIT_KM, ZOOM)) {
    if (minKm - 2 > best.km) break; // 2 km of slack for the corner-clamping approximation
    const t = await tile(tx, ty);
    for (let i = 0; i < t.length; i++) {
      if (t[i]! < threshold || !solid(t, i, threshold)) continue;
      const p = fromPixel(tx * 256 + (i % 256) + 0.5, ty * 256 + Math.floor(i / 256) + 0.5, ZOOM);
      const km = greatCircleKm(c, p);
      if (km < best.km) best = { km, at: { ...p, m: t[i]! } };
    }
  }
  return best.km <= LIMIT_KM ? best : { km: Infinity };
}

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "geography", retrieved, observations: {} };
for (const c of cities) {
  const sea = distanceToLines(c, lines);
  const own = await elevationAt(c);
  const hills = await nearestAbove(c, own + RISE_M);
  const base = { level: "city" as const, retrieved };
  const mountain = hills.at ? Math.round(hills.km) : LIMIT_KM;
  out.observations[c.id] = [
    { metric: "sea_km", value: Math.round(sea), period: "Natural Earth 5.1", source: "natural-earth", ...base, note: "straight line from the centre to the open-sea coastline (lakes excluded)" },
    {
      metric: "mountain_km",
      value: mountain,
      period: "terrain tiles 2017",
      source: "terrain-tiles",
      ...base,
      note: hills.at
        ? `${Math.round(hills.at.m)} m at ${hills.at.lat.toFixed(2)}, ${hills.at.lon.toFixed(2)}; the centre sits at about ${Math.round(own)} m`
        : `no ground ${RISE_M.toLocaleString("en-GB")} m above the centre (about ${Math.round(own)} m) within ${LIMIT_KM} km`,
    },
  ];
  console.log(c.id.padEnd(18), String(Math.round(sea)).padStart(5), String(Math.round(own)).padStart(5), hills.at ? Math.round(hills.km) : `>${LIMIT_KM}`, hills.at ? `${Math.round(hills.at.m)} m at ${hills.at.lat.toFixed(2)},${hills.at.lon.toFixed(2)}` : "");
}
await writeJson("data/observations/geography.json", out);
