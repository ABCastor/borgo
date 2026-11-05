// The seed cities' climate for the committed snapshot, with the same fetcher a person runs (src/fetch/open-meteo.ts).
// Open-Meteo weighs a five-year hourly request as many calls, so cities go one at a time with a pause; the run is
// resumable: a city already holding this fetcher version's figures is skipped. Pass city ids to redo only those.
import { readJson, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";
import { makeCtx } from "../../src/fetch/context.ts";
import { openMeteo } from "../../src/fetch/open-meteo.ts";

const FILE = "data/observations/open-meteo.json";
const PAUSE_MS = Number(process.env.OPEN_METEO_PAUSE_MS ?? 45_000);

const cities = await readJson<City[]>("data/cities.json");
const prev = await readJson<ObservationFile>(FILE).catch(() => null);
const out: ObservationFile = { source: "open-meteo-era5", retrieved: new Date().toISOString().slice(0, 10), observations: prev?.observations ?? {} };
const only = process.argv.slice(2);
const ctx = makeCtx({ runtime: "node", backoff: 60_000 });
const current = `open-meteo-era5@${openMeteo.version}`;

for (const c of cities) {
  const done = out.observations[c.id]?.some((o) => o.fetcher === current);
  if (only.length ? !only.includes(c.id) : done) continue;
  try {
    out.observations[c.id] = await openMeteo.fetch(c, ctx);
  } catch (e) {
    console.error(`${c.id}: ${(e as Error).message}; kept the previous figures`);
    continue;
  }
  await writeJson(FILE, out);
  console.log(c.id, out.observations[c.id]!.length, "figures");
  await new Promise((r) => setTimeout(r, PAUSE_MS));
}
