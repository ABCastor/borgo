// Annual PM2.5 by city from the WHO Ambient Air Quality Database (v8.0, June 2026).
// WHO's terms for data compilations: use for public health purposes, attribution to WHO and the countries that provided
// the data, minimal alteration. So values are stored exactly as published, each note names the row's data provider,
// and the file lives in data/observations-who/, published apart from the CC BY 4.0 data (src/registry/licences.ts).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { readSheet } from "../xlsx.ts";
import type { City } from "../../src/core/types.ts";

const URL =
  "https://cdn.who.int/media/docs/default-source/air-pollution-documents/air-quality-and-health/who-ambient-air-quality-database-version-2026-v8.xlsx?download=true";
const ISO3: Record<string, string> = { IT: "ITA", GB: "GBR", IE: "IRL", FR: "FRA", DE: "DEU", NL: "NLD", BE: "BEL", DK: "DNK", SE: "SWE", NO: "NOR", FI: "FIN", CH: "CHE", AT: "AUT", CZ: "CZE", PL: "POL", HU: "HUN", PT: "PRT", ES: "ESP", GR: "GRC", EE: "EST", US: "USA", CA: "CAN", SG: "SGP", JP: "JPN", AU: "AUS", NZ: "NZL", AE: "ARE" };

function csv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const dir = mkdtempSync(join(tmpdir(), "who-aq-"));
const file = join(dir, "aq.xlsx");
execFileSync("curl", ["-sSL", "-A", UA, "-o", file, URL]);
// One CSV record per row, split across cells wherever a quoted field holds ", ": joined back with the comma.
const lines = readSheet(file).map((r) => r.map((c) => String(c ?? "")).join(","));
const header = csv(lines[0]!);
const col = (name: string) => header.indexOf(name);
const rows = lines.slice(1).map(csv).map((f) => ({
  iso3: f[col("iso3")]!,
  city: f[col("city")]!,
  year: Number(f[col("year")]),
  version: f[col("version")] ?? "",
  pm25: Number(f[col("pm25_concentration")]),
  stations: f[col("number_stations")]!,
  types: f[col("type_of_stations")]!,
  provider: (f[col("reference")] ?? "").replace(/\s*\(n=\d+\)/g, ""),
  lat: Number(f[col("latitude")]),
  lon: Number(f[col("longitude")]),
}));

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "who-aqdb", retrieved, observations: {} };
for (const c of cities) {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const names = [c.name, ...(c.aliases ?? [])].map(fold);
  const inCountry = rows.filter((r) => r.iso3 === ISO3[c.country] && Number.isFinite(r.pm25));
  const label = (r: (typeof rows)[number]) => fold(r.city.split("/")[0]!);
  // The city's own entry (exact name, "<name> Greater City", or a US metro named after it), else the nearest within 15 km.
  // A named entry loses to a nearby station whose data is more than three years newer.
  const named = inCountry.filter((r) =>
    names.some((n) => label(r) === n || label(r) === `${n} greater city` || (c.country === "US" && label(r).startsWith(n + " "))),
  );
  const nearby = inCountry.filter((r) => Number.isFinite(r.lat) && km(c, r) <= 15);
  const newest = (a: typeof rows) => (a.length ? Math.max(...a.map((r) => r.year)) : -Infinity);
  const pool = named.length && newest(named) >= newest(nearby) - 3 ? named : nearby;
  if (pool.length === 0) {
    console.log(`${c.id}: no WHO PM2.5 entry`);
    out.observations[c.id] = [];
    continue;
  }
  const latest = newest(pool);
  const best = pool.filter((r) => r.year === latest).sort((a, b) => km(c, a) - km(c, b))[0]!;
  out.observations[c.id] = [
    { metric: "pm25", value: best.pm25, period: String(best.year), level: "city", source: "who-aqdb", retrieved, note: `${/^\d+$/.test(best.stations) ? `${best.city.split("/")[0]}, ${best.stations} station${best.stations === "1" ? "" : "s"}` : best.city.split("/")[0]}; data: ${best.provider} (WHO ${best.version.replace(/\s*\(n=\d+\)/g, "")})` },
  ];
  console.log(c.id.padEnd(18), best.pm25, best.year, best.city);
}
await writeJson("data/observations-who/who-air.json", out);
