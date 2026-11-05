// A square boolean grid centred on a point, for measuring what share of the land around a city is green.
// Rings are [lon, lat] pairs; each is filled by even-odd scanlines, so overlapping polygons count once.
import type { Point } from "../src/core/geo.ts";

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;

export class Grid {
  readonly centre: Point;
  readonly radiusKm: number;
  readonly cellKm: number;
  readonly n: number;
  readonly cells: Uint8Array;
  private readonly kx: number;

  constructor(centre: Point, radiusKm: number, cellKm: number) {
    this.centre = centre;
    this.radiusKm = radiusKm;
    this.cellKm = cellKm;
    this.n = Math.ceil((2 * radiusKm) / cellKm);
    this.cells = new Uint8Array(this.n * this.n);
    this.kx = KM_PER_DEG_LON * Math.cos((centre.lat * Math.PI) / 180);
  }

  /** Grid coordinates (fractional cells, x east, y north) of a [lon, lat] pair. */
  private xy(p: number[]): [number, number] {
    return [((p[0]! - this.centre.lon) * this.kx + this.radiusKm) / this.cellKm, ((p[1]! - this.centre.lat) * KM_PER_DEG_LAT + this.radiusKm) / this.cellKm];
  }

  /** Sets every cell whose centre lies inside the ring (closed implicitly). */
  fill(ring: number[][]): void {
    if (ring.length < 3) return;
    const pts = ring.map((p) => this.xy(p));
    let lo = Infinity, hi = -Infinity;
    for (const [, y] of pts) (lo = Math.min(lo, y)), (hi = Math.max(hi, y));
    const y0 = Math.max(0, Math.ceil(lo - 0.5)), y1 = Math.min(this.n - 1, Math.floor(hi - 0.5));
    for (let row = y0; row <= y1; row++) {
      const yc = row + 0.5;
      const xs: number[] = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
        if (yi > yc !== yj > yc) xs.push(xi + ((yc - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil(xs[k]! - 0.5)), b = Math.min(this.n - 1, Math.floor(xs[k + 1]! - 0.5));
        for (let col = a; col <= b; col++) this.cells[row * this.n + col] = 1;
      }
    }
  }

  /** Is the cell's centre within the radius? */
  inCircle(i: number): boolean {
    const x = (i % this.n) + 0.5 - this.n / 2, y = Math.floor(i / this.n) + 0.5 - this.n / 2;
    return Math.hypot(x, y) * this.cellKm <= this.radiusKm;
  }
}

/** Joins open ways into closed rings by matching endpoints; leftovers that never close are closed as they are. */
export function joinRings(ways: number[][][]): number[][][] {
  const same = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];
  const open = ways.filter((w) => w.length > 1).map((w) => [...w]);
  const rings: number[][][] = [];
  while (open.length) {
    let ring = open.pop()!;
    for (let grew = true; grew && !same(ring[0]!, ring.at(-1)!); ) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i]!;
        const end = ring.at(-1)!;
        if (same(w[0]!, end)) ring = ring.concat(w.slice(1));
        else if (same(w.at(-1)!, end)) ring = ring.concat([...w].reverse().slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}
