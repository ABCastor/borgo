// Airports near each city, from OurAirports (public domain, updated nightly by its contributors).
// Two figures: how far the nearest large airport with scheduled flights is, and how many airports with scheduled
// passenger flights sit within 100 km. Direct destinations are not counted: no open, current route source exists
// (OpenFlights routes stopped in 2014), so this measures reach, not connectivity.
import { greatCircleKm } from "../../src/core/geo.ts";
import { getText, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

const URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const RADIUS_KM = 100;

function csvLine(line: string): string[] {
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

const [head, ...lines] = (await getText(URL)).split("\n").filter(Boolean);
const cols = csvLine(head!);
const at = (name: string) => cols.indexOf(name);
const airports = lines
  .map(csvLine)
  .filter((r) => r[at("scheduled_service")] === "yes" && (r[at("type")] === "large_airport" || r[at("type")] === "medium_airport"))
  .map((r) => ({
    name: r[at("name")]!,
    iata: r[at("iata_code")]!,
    large: r[at("type")] === "large_airport",
    lat: Number(r[at("latitude_deg")]),
    lon: Number(r[at("longitude_deg")]),
  }));
if (airports.length < 1000) throw new Error(`only ${airports.length} scheduled airports parsed: the file layout changed`);

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "ourairports", retrieved, observations: {} };
for (const c of cities) {
  const ranked = airports.map((a) => ({ ...a, km: greatCircleKm(c, a) })).sort((a, b) => a.km - b.km);
  const nearest = ranked.find((a) => a.large)!;
  const near = ranked.filter((a) => a.km <= RADIUS_KM);
  const base = { period: retrieved, level: "city" as const, source: "ourairports", retrieved };
  out.observations[c.id] = [
    { metric: "airport_km", value: Math.round(nearest.km), ...base, note: `${nearest.name}${nearest.iata ? ` (${nearest.iata})` : ""}, straight line from the centre` },
    { metric: "airports_100km", value: near.length, ...base, note: near.map((a) => a.iata || a.name).join(", ") || "none" },
  ];
  console.log(c.id.padEnd(18), String(Math.round(nearest.km)).padStart(4), nearest.iata, near.length, near.map((a) => a.iata).join(" "));
}
await writeJson("data/observations/ourairports.json", out);
