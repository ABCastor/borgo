// Sunshine from Meteostat's station normals (CC BY 4.0), where the WMO set has no station near the city.
// Node only: Meteostat's bulk files send no CORS header. Minutes per month in the normals file's last column.
import { gunzipSync } from "node:zlib";
import type { Fetcher } from "../context.ts";
import { nearestStation, STATION_MAX_KM, sunshineObservations } from "../sunshine.ts";
import { km } from "../context.ts";

const STATIONS_URL = "https://bulk.meteostat.net/v2/stations/lite.json.gz";

interface MeteostatStation { id: string; name: { en?: string }; location: { latitude: number; longitude: number; elevation: number | null }; inventory?: { normals?: { start: number | null; end: number | null } } }

/** Monthly sunshine hours from the latest 30-year period with all twelve months, or null. */
export function parseNormals(csv: string): { period: string; months: number[] } | null {
  const periods = new Map<string, number[]>();
  for (const line of csv.split(/\r?\n/).filter(Boolean)) {
    const f = line.split(",");
    const tsun = f[f.length - 1];
    if (!tsun) continue;
    const key = `${f[0]}-${f[1]}`;
    const month = Number(f[2]);
    if (!periods.has(key)) periods.set(key, new Array(12).fill(NaN));
    periods.get(key)![month - 1] = Number(tsun) / 60;
  }
  const complete = [...periods].filter(([, m]) => m.every(Number.isFinite)).sort(([a], [b]) => b.localeCompare(a));
  return complete[0] ? { period: complete[0][0], months: complete[0][1] } : null;
}

export const meteostat: Fetcher = {
  source: "meteostat",
  version: 1,
  runtimes: ["node"],
  fallbackFor: "wmo-normals",
  async fetch(city, ctx) {
    const all = JSON.parse(gunzipSync(await ctx.bulk(STATIONS_URL)).toString("utf8")) as MeteostatStation[];
    const near = all
      .filter((s) => s.inventory?.normals?.start != null)
      .map((s) => ({ s, lat: s.location.latitude, lon: s.location.longitude, elevation: s.location.elevation }))
      .filter((x) => km(city, x) <= STATION_MAX_KM)
      .sort((a, b) => km(city, a) - km(city, b));
    // Try the closest few that pass the height rule; many stations hold normals without sunshine.
    for (let tries = 0; tries < 6 && near.length; tries++) {
      const hit = nearestStation(city, near);
      if (!hit) break;
      near.splice(near.indexOf(hit.station), 1);
      const url = `https://bulk.meteostat.net/v2/normals/${hit.station.s.id}.csv.gz`;
      let csv: string;
      try {
        csv = gunzipSync(await ctx.bulk(url)).toString("utf8");
      } catch {
        continue; // 404: this station has no normals file
      }
      const n = parseNormals(csv);
      if (!n) continue;
      return sunshineObservations({ months: n.months, source: "meteostat", fetcher: "meteostat@1", period: n.period, url, retrieved: ctx.now().toISOString(), station: hit.station.s.name.en ?? hit.station.s.id, km: hit.km, elevation: hit.station.elevation ?? undefined });
    }
    return [];
  },
};
