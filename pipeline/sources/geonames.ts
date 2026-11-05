// City identity (GeoNames id, coordinates, population, time zone) from the GeoNames cities15000 dump, CC BY 4.0.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, UA, writeJson, type SeedCity } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

const dir = mkdtempSync(join(tmpdir(), "geonames-"));
const zip = join(dir, "cities15000.zip");
execFileSync("curl", ["-sSL", "-A", UA, "-o", zip, "https://download.geonames.org/export/dump/cities15000.zip"]);
execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
const rows = readFileSync(join(dir, "cities15000.txt"), "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const seeds = await readJson<SeedCity[]>("data/cities.seed.json");
const out: City[] = [];
for (const s of seeds) {
  const names = new Set([s.name, ...(s.aliases ?? [])].map(fold));
  const match = rows
    .filter((r) => r[8] === s.country && (names.has(fold(r[1]!)) || names.has(fold(r[2]!)) || (r[3] ?? "").split(",").some((a) => names.has(fold(a)))))
    .sort((a, b) => Number(b[14]) - Number(a[14]))[0];
  if (!match) {
    console.error(`${s.id}: no GeoNames match in ${s.country}`);
    continue;
  }
  const city: City = { id: s.id, name: s.name, country: s.country, lat: Number(match[4]), lon: Number(match[5]), population: Number(match[14]) };
  if (s.region) city.region = s.region;
  if (s.aliases) city.aliases = s.aliases;
  (city as City & { geonames: string }).geonames = match[0]!;
  if (match[17]) city.tz = match[17];
  // Column 15 is the stated elevation (often empty), 16 the SRTM terrain height; either lets a station be matched by height.
  const elevation = Number(match[15] || match[16]);
  if (Number.isFinite(elevation) && elevation > -500) city.elevation = elevation;
  out.push(city);
}
await writeJson("data/cities.json", out);
console.log(`${out.length}/${seeds.length} cities written to data/cities.json`);
