// Rents in Singapore from the Urban Redevelopment Authority's "Rentals of Non-Landed Residential Buildings, Quarterly"
// on data.gov.sg (Singapore Open Data Licence 1.0): for each major private condominium or flat project with at least 10
// rental contracts signed in the quarter, the median monthly rent per square foot. Singapore's rate here is the median of
// those project medians in the latest quarter, each weighted by its number of contracts, converted to m² and times the
// flat size in pipeline/rent.ts. Public (HDB) flats, which most residents live in, are not part of it.
import { getJson, isMain, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import { FLAT_M2, fromPerM2 } from "../rent.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const DATASET = "d_149ac00a2734bb0a03867bbe2ec0e7b0";
export const SQFT_PER_M2 = 10.7639;

export interface UraRow { qtr: string; project_name: string; median: string; rental_contracts: string }

/** The contract-weighted median of project medians (S$ per sq ft a month) in the latest quarter. */
export function uraRate(rows: UraRow[]): { quarter: string; psf: number; projects: number; contracts: number } | null {
  const quarter = rows.map((r) => r.qtr).sort().at(-1);
  if (!quarter) return null;
  const q = rows.filter((r) => r.qtr === quarter && Number(r.median) > 0 && Number(r.rental_contracts) > 0).map((r) => ({ psf: Number(r.median), n: Number(r.rental_contracts) })).sort((a, b) => a.psf - b.psf);
  const total = q.reduce((s, r) => s + r.n, 0);
  let seen = 0;
  const mid = q.find((r) => (seen += r.n) >= total / 2);
  return mid ? { quarter, psf: mid.psf, projects: q.length, contracts: total } : null;
}

export function uraObservations(rows: UraRow[], cities: City[], retrieved: string): ObservationFile {
  const out: ObservationFile = { source: "sg-ura-rentals", retrieved, observations: {} };
  const r = uraRate(rows);
  const sg = cities.find((c) => c.id === "singapore-sg");
  if (!r || !sg) return out;
  out.observations[sg.id] = (["rent_1bed", "rent_3bed"] as const).map((metric): Observation => ({
    metric, value: fromPerM2(r.psf * SQFT_PER_M2, metric), period: r.quarter, level: "city", source: "sg-ura-rentals", retrieved,
    note: `Private non-landed homes (condominiums and private flats) in major projects, ${r.quarter}: median rent S$${r.psf.toFixed(2)} per sq ft a month (the contract-weighted median over ${r.projects} projects, ${r.contracts} contracts) × ${FLAT_M2[metric]} m²`,
  }));
  return out;
}

if (isMain(import.meta.url)) {
  const d = await getJson<{ result: { records: UraRow[] } }>(`https://data.gov.sg/api/action/datastore_search?resource_id=${DATASET}&limit=5000`);
  const out = uraObservations(d.result.records, await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/sg-rent.json", out);
}
