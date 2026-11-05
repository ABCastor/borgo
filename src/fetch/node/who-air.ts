// Measured annual PM2.5 from the WHO Ambient Air Quality Database (v8.0, 2026), stored exactly as published (WHO
// terms). Node only: the file is an xlsx without CORS. The city's own entry ("<name>", "<name> greater city", a US
// metro named after it) unless a station within 15 km has data more than three years newer.
import type { Fetcher } from "../context.ts";
import { fold, km } from "../context.ts";
import { xlsxRows } from "./xlsx-file.ts";

export const WHO_URL =
  "https://cdn.who.int/media/docs/default-source/air-pollution-documents/air-quality-and-health/who-ambient-air-quality-database-version-2026-v8.xlsx?download=true";

interface Row { iso3: string; city: string; year: number; pm25: number; stations: string; lat: number; lon: number }

function csv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) ch === '"' ? (line[i + 1] === '"' ? ((cur += '"'), i++) : (q = false)) : (cur += ch);
    else if (ch === '"') q = true;
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out;
}

let parsed: { bytes: Uint8Array; rows: Row[] } | null = null;

function rowsOf(bytes: Uint8Array): Row[] {
  if (parsed?.bytes === bytes) return parsed.rows;
  // One CSV record per row, split across cells wherever a quoted field holds ", ": joined back with the comma.
  const lines = xlsxRows(bytes).map((r) => r.map((c) => String(c ?? "")).join(","));
  const header = csv(lines[0]!);
  const col = (n: string) => header.indexOf(n);
  const rows = lines.slice(1).map(csv).map((f) => ({
    iso3: f[col("iso3")]!,
    city: f[col("city")]!,
    year: Number(f[col("year")]),
    pm25: Number(f[col("pm25_concentration")]),
    stations: f[col("number_stations")]!,
    lat: Number(f[col("latitude")]),
    lon: Number(f[col("longitude")]),
  })).filter((r) => Number.isFinite(r.pm25));
  parsed = { bytes, rows };
  return rows;
}

export const whoAir: Fetcher = {
  source: "who-aqdb",
  version: 1,
  runtimes: ["node"],
  async fetch(city, ctx) {
    const rows = rowsOf(await ctx.bulk(WHO_URL));
    const names = [city.name, ...(city.aliases ?? [])].map(fold);
    const label = (r: Row) => fold(r.city.split("/")[0]!);
    // Match on the country by nearness as well as name, so a country's ISO3 code is not needed.
    const near = rows.filter((r) => Number.isFinite(r.lat) && km(city, r) <= 60);
    const iso3 = new Set(near.map((r) => r.iso3));
    const inCountry = rows.filter((r) => iso3.has(r.iso3));
    const named = inCountry.filter((r) => names.some((n) => label(r) === n || label(r) === `${n} greater city` || (city.country === "US" && label(r).startsWith(n + " "))) && (!Number.isFinite(r.lat) || km(city, r) <= 60));
    const nearby = rows.filter((r) => Number.isFinite(r.lat) && km(city, r) <= 15);
    const newest = (a: Row[]) => (a.length ? Math.max(...a.map((r) => r.year)) : -Infinity);
    const pool = named.length && newest(named) >= newest(nearby) - 3 ? named : nearby;
    if (!pool.length) return [];
    const latest = newest(pool);
    const best = pool.filter((r) => r.year === latest).sort((a, b) => (Number.isFinite(a.lat) ? km(city, a) : 0) - (Number.isFinite(b.lat) ? km(city, b) : 0))[0]!;
    const where = best.city.split("/")[0];
    return [{ metric: "pm25", value: best.pm25, period: String(best.year), level: "city", source: "who-aqdb", retrieved: ctx.now().toISOString(), url: WHO_URL, fetcher: "who-aqdb@1", note: /^\d+$/.test(best.stations) ? `${where}, ${best.stations} station${best.stations === "1" ? "" : "s"}` : where }];
  },
};
