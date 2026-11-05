// Asking rents in Paris and Lyon from the ministry of housing's "carte des loyers" (2025 edition, Licence Ouverte 2.0):
// modelled rents per m², charges included, of unfurnished flats advertised on leboncoin and SeLoger in the third quarter,
// for flats of one or two rooms and of three rooms or more. Both cities are published by arrondissement; the city's
// rate here is their mean weighted by each arrondissement's number of adverts. A monthly rent is the rate times the
// flat size in pipeline/rent.ts (50 m² for one bedroom from the 1-2 room rate, 90 m² for three bedrooms from the 3+ room rate).
import { readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { FLAT_M2, fromPerM2 } from "../rent.ts";
import type { City } from "../../src/core/types.ts";

const BASE = "https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/";
const FILES = { rent_1bed: `${BASE}20251211-144934/pred-app12-mef-dhup.csv`, rent_3bed: `${BASE}20251211-144951/pred-app3-mef-dhup.csv` } as const;
const ROOMS = { rent_1bed: "flats of one or two rooms", rent_3bed: "flats of three rooms or more" } as const;
const PREFIX: Record<string, { insee: RegExp; name: string }> = { "paris-fr": { insee: /^751\d\d$/, name: "Paris" }, "lyon-fr": { insee: /^6938\d$/, name: "Lyon" } };

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "fr-carte-loyers", retrieved, observations: {} };
for (const [metric, url] of Object.entries(FILES) as [keyof typeof FILES, string][]) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const text = new TextDecoder("latin1").decode(await res.arrayBuffer());
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const cols = head!.split(";").map((c) => c.replace(/"/g, ""));
  const rows = lines.map((l) => Object.fromEntries(l.split(";").map((v, i) => [cols[i], v.replace(/"/g, "")])));
  for (const c of cities) {
    const p = PREFIX[c.id];
    if (!p) continue;
    const parts = rows.filter((r) => p.insee.test(r.INSEE_C!));
    const n = parts.reduce((s, r) => s + Number(r.nbobs_com), 0);
    const rate = parts.reduce((s, r) => s + Number(r.loypredm2!.replace(",", ".")) * Number(r.nbobs_com), 0) / n;
    if (!parts.length || !Number.isFinite(rate)) continue;
    (out.observations[c.id] ??= []).push({ metric, value: fromPerM2(rate, metric), period: "2025-Q3", level: "city", source: "fr-carte-loyers", retrieved, note: `${p.name}, asking rent of ${ROOMS[metric]}, charges included: ${rate.toFixed(2)} €/m² (mean of ${parts.length} arrondissements weighted by ${n} adverts) × ${FLAT_M2[metric]} m²` });
  }
}
for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value}`).join(" "));
await writeJson("data/observations/fr-rent.json", out);
