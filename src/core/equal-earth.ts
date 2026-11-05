// The Equal Earth projection (Šavrič, Patterson and Jenny, 2018): an equal-area world map whose shapes stay
// recognisable, so a tile on the map covers the same ground wherever it is. Longitude and latitude in degrees;
// x and y in projection units (x within ±2.7064, y within ±1.3173, y up).

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const RAD = Math.PI / 180;

export function project(lon: number, lat: number): [number, number] {
  const t = Math.asin(M * Math.sin(lat * RAD));
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  const x = (lon * RAD * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, y];
}

/** Longitude and latitude of a projected point; null outside the map's outline. */
export function unproject(x: number, y: number): [number, number] | null {
  let t = y;
  for (let i = 0; i < 12; i++) {
    const t2 = t * t;
    const t6 = t2 * t2 * t2;
    const f = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y;
    const d = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
    const step = f / d;
    t -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  const s = Math.sin(t) / M;
  if (Math.abs(s) > 1) return null;
  const lon = (M * x * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))) / Math.cos(t) / RAD;
  if (Math.abs(lon) > 180 + 1e-9) return null;
  return [lon, Math.asin(s) / RAD];
}
