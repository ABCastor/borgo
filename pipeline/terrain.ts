// Geometry for the geography source: distance to a coastline, and web-mercator tile arithmetic for elevation tiles.
import { greatCircleKm, type Point } from "../src/core/geo.ts";

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;

/**
 * Shortest distance in km from a point to a set of polylines ([lon, lat] pairs, GeoJSON order), on a flat
 * projection centred on the point. The error stays under 1% for the few hundred km that matter here.
 */
export function distanceToLines(p: Point, lines: number[][][]): number {
  const kx = KM_PER_DEG_LON * Math.cos((p.lat * Math.PI) / 180);
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1]![0]! - p.lon) * kx, ay = (line[i - 1]![1]! - p.lat) * KM_PER_DEG_LAT;
      const bx = (line[i]![0]! - p.lon) * kx, by = (line[i]![1]! - p.lat) * KM_PER_DEG_LAT;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Global pixel coordinates of a point at a zoom level, 256-pixel tiles. */
export function toPixel(p: Point, zoom: number): { x: number; y: number } {
  const size = 256 * 2 ** zoom;
  const phi = (p.lat * Math.PI) / 180;
  return { x: ((p.lon + 180) / 360) * size, y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size };
}

/** The point at a global pixel coordinate (its centre when given x + 0.5, y + 0.5). */
export function fromPixel(x: number, y: number, zoom: number): Point {
  const size = 256 * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: (x / size) * 360 - 180 };
}

/** Terrarium encoding: metres = R * 256 + G + B / 256 - 32768. */
export function terrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Tiles whose area comes within `radiusKm` of a point, nearest first, each with its closest possible distance. */
export function tilesAround(p: Point, radiusKm: number, zoom: number): { tx: number; ty: number; minKm: number }[] {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / (KM_PER_DEG_LON * Math.cos((p.lat * Math.PI) / 180));
  const nw = toPixel({ lat: p.lat + dLat, lon: p.lon - dLon }, zoom);
  const se = toPixel({ lat: p.lat - dLat, lon: p.lon + dLon }, zoom);
  const out: { tx: number; ty: number; minKm: number }[] = [];
  for (let tx = Math.floor(nw.x / 256); tx <= Math.floor(se.x / 256); tx++) {
    for (let ty = Math.floor(nw.y / 256); ty <= Math.floor(se.y / 256); ty++) {
      const a = fromPixel(tx * 256, ty * 256, zoom); // north-west corner
      const b = fromPixel((tx + 1) * 256, (ty + 1) * 256, zoom); // south-east corner
      const closest = { lat: Math.max(b.lat, Math.min(a.lat, p.lat)), lon: Math.max(a.lon, Math.min(b.lon, p.lon)) };
      const minKm = greatCircleKm(p, closest);
      if (minKm <= radiusKm) out.push({ tx, ty, minKm });
    }
  }
  return out.sort((x, y) => x.minKm - y.minKm);
}
