// The world map's own data: a grid of land tiles on the Equal Earth projection, each with its country and the
// average afternoon high of every month, plus the populated places a person can pick by clicking the map.
// Built by pipeline/sources/world-map.ts into public/data/map.json; the browser loads it only on the map.

export interface WorldMap {
  version: string;
  projection: "equal-earth";
  /** Top-left corner of the grid in projection units (y up), and the side of one square tile. */
  x0: number;
  y0: number;
  pitch: number;
  cols: number;
  rows: number;
  /** ISO 3166-1 alpha-2 codes; tiles point into this list. "" is land with no code we can use (disputed areas). */
  countries: string[];
  /** Three numbers per land tile: column, row, index into `countries`. */
  tiles: number[];
  /** Twelve numbers per land tile, January first: the mean daily high of the air in tenths of a degree Celsius. */
  highs: number[];
  /** Populated places: name, country, latitude, longitude, population, GeoNames id (0 when Natural Earth has none), and 1 for a national capital. */
  places: [string, string, number, number, number, number, 1?][];
  sources: { id: string; what: string; period: string; retrieved: string }[];
}

export function tileCount(map: WorldMap): number {
  return map.tiles.length / 3;
}

/** Months whose average afternoon high sits within [min, max] °C, both ends included, for tile `i`. */
export function monthsInRange(map: WorldMap, i: number, min: number, max: number): number {
  let n = 0;
  for (let m = 0; m < 12; m++) {
    const h = map.highs[i * 12 + m]! / 10;
    if (h >= min - 0.5 && h < max + 0.5) n++;
  }
  return n;
}

/** The twelve monthly highs of tile `i`, in °C. */
export function tileHighs(map: WorldMap, i: number): number[] {
  return map.highs.slice(i * 12, i * 12 + 12).map((v) => v / 10);
}

/** Problems with a map file, in words; empty when it is sound. */
export function validateMap(map: WorldMap, knownCountries: Set<string>): string[] {
  const errs: string[] = [];
  const n = map.tiles.length / 3;
  if (!Number.isInteger(n) || n === 0) errs.push("tiles must hold three numbers per tile");
  if (map.highs.length !== n * 12) errs.push(`highs must hold twelve numbers per tile (${n * 12}), found ${map.highs.length}`);
  if (!map.highs.every((v) => Number.isInteger(v) && v > -700 && v < 600)) errs.push("every high must be whole tenths of a degree between -70 and 60 °C");
  for (let i = 0; i < n; i++) {
    const [c, r, k] = [map.tiles[i * 3]!, map.tiles[i * 3 + 1]!, map.tiles[i * 3 + 2]!];
    if (c < 0 || c >= map.cols || r < 0 || r >= map.rows || k < 0 || k >= map.countries.length) {
      errs.push(`tile ${i} is outside the grid or names no country`);
      break;
    }
  }
  for (const cc of map.countries) if (cc && !knownCountries.has(cc)) errs.push(`unknown country ${cc}`);
  for (const p of map.places) if (!knownCountries.has(p[1])) errs.push(`place ${p[0]} has unknown country ${p[1]}`);
  for (const p of map.places) if (!Number.isInteger(p[5]) || p[5]! < 0 || (p[6] !== undefined && p[6] !== 1)) {
    errs.push(`place ${p[0]} needs a GeoNames id (0 for none) and nothing or 1 for a capital`);
    break;
  }
  return errs;
}
