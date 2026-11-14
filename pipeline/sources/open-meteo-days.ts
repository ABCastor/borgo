// The seed cities' days by kind of weather (nice_kinds_*), for nice days a person defines beyond temperature: the same
// Open-Meteo ERA5 request as pipeline/sources/open-meteo.ts, less snowfall, reduced by src/core/weather-days.ts. Cities
// go one at a time with a pause; the run is resumable (a city already holding them is skipped). Pass city ids to redo
// only those, and --from <dir> to read archive responses saved there as <city-id>.json rather than fetch them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";
import { lastFullYears } from "../../src/fetch/context.ts";
import { kindsObservations, openMeteo } from "../../src/fetch/open-meteo.ts";
import { toDays, type Hourly } from "../../src/core/weather-days.ts";

const FILE = "data/observations/open-meteo-days.json";
const PAUSE_MS = Number(process.env.OPEN_METEO_PAUSE_MS ?? 60_000);
const HOURLY = ["temperature_2m", "apparent_temperature", "dew_point_2m", "precipitation", "cloud_cover", "wind_speed_10m"];

const args = process.argv.slice(2);
const fromAt = args.indexOf("--from");
const from = fromAt >= 0 ? args[fromAt + 1] : undefined;
const only = args.filter((x, i) => !x.startsWith("--") && (fromAt < 0 || i !== fromAt + 1));
const cities = await readJson<City[]>("data/cities.json");
const prev = await readJson<ObservationFile>(FILE).catch(() => null);
const out: ObservationFile = { source: "open-meteo-era5", retrieved: new Date().toISOString().slice(0, 10), observations: prev?.observations ?? {} };
const y = lastFullYears(new Date());
const fetcher = `open-meteo-era5@${openMeteo.version}`;

for (const c of cities) {
  if (only.length ? !only.includes(c.id) : out.observations[c.id]?.length) continue;
  const ask = (tz: string) => `https://archive-api.open-meteo.com/v1/archive?latitude=${c.lat}&longitude=${c.lon}&start_date=${y.start}&end_date=${y.end}&timezone=${encodeURIComponent(tz)}&hourly=${HOURLY.join(",")}`;
  let url = ask("auto");
  const saved = from ? join(from, `${c.id}.json`) : "";
  let hourly: Hourly;
  try {
    const body = saved && existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")) : await (await fetch(url)).json();
    // Open-Meteo gives the whole period at one UTC offset. A saved response read at a fixed offset ("Etc/GMT+7": the
    // daylight-saving offset the snapshot's other climate figures were read at) says so in the address it cites.
    if (typeof body.timezone === "string" && body.timezone.startsWith("Etc/")) url = ask(body.timezone);
    hourly = { snowfall: [], ...body.hourly } as Hourly;
    if (!hourly.time?.length) throw new Error(body.reason ?? "no hourly data");
  } catch (e) {
    console.error(`${c.id}: ${(e as Error).message}; kept the previous figures`);
    continue;
  }
  const days = toDays(hourly);
  const base = { period: y.period, level: "city" as const, source: "open-meteo-era5", retrieved: out.retrieved, url, fetcher };
  out.observations[c.id] = kindsObservations(days, base, `Days a month on average, ${y.period}; the tests are in docs/weather-scores.md. ERA5 reanalysis at the city's coordinates (a grid about 25 km wide)`);
  await writeJson(FILE, out);
  console.log(c.id, days.length, "days");
  if (!(saved && existsSync(saved))) await new Promise((r) => setTimeout(r, PAUSE_MS));
}
