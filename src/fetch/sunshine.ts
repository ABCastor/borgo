// Sunshine measured at weather stations, by the WMO definition (direct sunlight of at least 120 W/m²).
// Primary: the WMO 1991-2020 climate normals archived by NOAA NCEI (one 444 kB CSV, CORS-open, so the browser can
// read it too). Fallback in Node: Meteostat's normals (src/fetch/node/meteostat.ts). Gridded models are never
// used: on 27 Oct 2026 ERA5 gave Heathrow 2,765 h a year against 1,595 measured (docs/architecture.md, section 5).
import type { City, Observation } from "../core/types.ts";
import { km, type Fetcher } from "./context.ts";

export const WMO_TSUN_URL = "https://www.ncei.noaa.gov/data/oceans/archive/arc0216/0253808/6.6/data/0-data/data-composite-primary-parameters/wmo_normals_9120_TSUN.csv";

/**
 * How far a station may be from the city, and how much higher or lower, to stand for it. The WMO set is searched
 * within 50 km, so that a closer national station from Meteostat wins over a WMO one across a border; Meteostat
 * itself within 80 km. The note always names the station, its distance and its height.
 */
export const WMO_MAX_KM = 50;
export const STATION_MAX_KM = 80;
export const STATION_MAX_DZ = 500;

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  months: number[];
}

/** Stations with all twelve months reported (-99.9 marks a missing month). */
export function parseWmoTsun(csv: string): Station[] {
  const out: Station[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const f = line.split(",").map((x) => x.trim());
    if (f.length < 22 || f[0] !== "008") continue;
    const months = f.slice(9, 21).map(Number);
    if (months.some((m) => !Number.isFinite(m) || m < 0)) continue;
    out.push({ id: f[2]!, name: f[8]!.replace(/_/g, " "), lat: Number(f[4]), lon: Number(f[5]), elevation: Number(f[6]), months });
  }
  return out;
}

/** The nearest station that can stand for the city, or null. */
export function nearestStation<S extends { lat: number; lon: number; elevation?: number | null }>(city: City, stations: S[], maxKm = STATION_MAX_KM): { station: S; km: number } | null {
  let best: { station: S; km: number } | null = null;
  for (const s of stations) {
    const d = km(city, s);
    if (d > maxKm) continue;
    if (city.elevation != null && s.elevation != null && Math.abs(city.elevation - s.elevation) > STATION_MAX_DZ) continue;
    if (!best || d < best.km) best = { station: s, km: d };
  }
  return best;
}

export function sunshineObservations(o: { months: number[]; source: string; fetcher: string; period: string; url: string; retrieved: string; station: string; km: number; elevation?: number }): Observation[] {
  const where = `${o.station}, ${Math.round(o.km)} km away${o.elevation != null ? ` at ${Math.round(o.elevation)} m` : ""}`;
  const base = { period: o.period, level: "city" as const, source: o.source, retrieved: o.retrieved, url: o.url, fetcher: o.fetcher, note: `Measured at ${where} (WMO definition: direct sunlight of at least 120 W/m²)` };
  return [
    { metric: "sunshine_monthly", value: o.months.map((m) => Math.round(m)), ...base },
    { metric: "sunshine_hours", value: Math.round(o.months.reduce((a, b) => a + b, 0)), ...base },
  ];
}

export const wmoSunshine: Fetcher = {
  source: "wmo-normals",
  version: 1,
  runtimes: ["browser", "node"],
  async fetch(city, ctx) {
    const csv = new TextDecoder().decode(await ctx.bulk(WMO_TSUN_URL));
    const hit = nearestStation(city, parseWmoTsun(csv), WMO_MAX_KM);
    if (!hit) return [];
    return sunshineObservations({ months: hit.station.months, source: "wmo-normals", fetcher: "wmo-normals@1", period: "1991-2020", url: WMO_TSUN_URL, retrieved: ctx.now().toISOString(), station: hit.station.name, km: hit.km, elevation: hit.station.elevation });
  },
};
