// Prints the coverage table of docs/data-sources.md from the built dataset (dataset.json and the files beside it under
// other terms): run after `npm run data`.
import { join } from "node:path";
import { ROOT } from "./lib.ts";
import type { Observation } from "../src/core/types.ts";
import { loadPublishedDataset } from "../src/registry/load.ts";

// Source ids whose script is named differently (one script can fill several sources); "source:metric" where one
// source's metrics come from different scripts.
const SCRIPT: Record<string, string> = { "worldbank-wdi:degree_share": "ambition", "worldbank-wdi:doctors": "positions", "worldbank-wdi:unemployment": "positions", github: "ambition", "ghsl-ucdb": "ghsl", "worldbank-wdi": "worldbank", "who-aqdb": "who-air", "ons-pipr": "ons-rent", "cso-rtb": "cso-rent", "open-meteo-era5": "open-meteo", "natural-earth": "geography", "terrain-tiles": "geography", "wmo-normals": "sunshine", meteostat: "sunshine", "cmhc-rms": "cmhc-rent", "fr-carte-loyers": "fr-rent", "oecd-family-db": "family", "oecd-childcare": "family", "nager-date": "family", "labour-law": "family", "abortion-law": "positions", "worldbank-wgi": "positions" };

const ds = loadPublishedDataset(join(ROOT, "public/data/dataset.json"));
const rows = ["| Metric | Source | Licence | Level | Coverage | Period | Refresh |", "|---|---|---|---|---|---|---|"];
for (const m of Object.values(ds.metrics)) {
  const obs = Object.entries(ds.observations).flatMap(([city, list]) => list.filter((o: Observation) => o.metric === m.id).map((o) => ({ city, ...o })));
  const srcs = [...new Set(obs.map((o) => o.source))];
  const periods = [...new Set(obs.map((o) => o.period))].sort();
  const period = periods.length <= 1 ? (periods[0] ?? "") : `${periods[0]} to ${periods.at(-1)}`;
  const names = srcs.map((s) => `[${ds.sources[s]!.name}](${ds.sources[s]!.url})`).join("; ") || "none yet";
  const licences = [...new Set(srcs.map((s) => ds.sources[s]!.licence))].join("; ");
  const levels = [...new Set(obs.map((o) => o.level))].join(", ");
  const cities = new Set(obs.map((o) => o.city)).size;
  const refresh = [...new Set(srcs.map((s) => `\`node pipeline/sources/${SCRIPT[`${s}:${m.id}`] ?? SCRIPT[s] ?? s}.ts\``))].join(", ");
  rows.push(`| ${m.label} (\`${m.id}\`) | ${names} | ${licences} | ${levels} | ${cities}/${ds.cities.length} | ${period} | ${refresh} |`);
}
console.log(rows.join("\n"));
