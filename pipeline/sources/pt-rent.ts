// Rents in Lisbon and Porto from Statistics Portugal (INE), indicator 0014696, published by INE on dados.gov.pt under
// CC BY 4.0: the median rent per m² of new lease contracts of family homes signed in the last 12 months, by
// municipality, quarterly (Metodologia 2026, from the leases declared to the tax authority). New leases only: what a
// newcomer pays. A monthly rent is the rate times the flat size in pipeline/rent.ts.
import { getText, isMain, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import { FLAT_M2, fromPerM2 } from "../rent.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const INDICATOR = "0014696";
export const API = `https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=${INDICATOR}&lang=PT`;
/** Seed city -> INE municipality code (NUTS 2024). */
export const MUNICIPALITIES: Record<string, string> = { "lisbon-pt": "1A01106", "porto-pt": "11A1312" };

export interface IneIndicator { IndicadorCod: string; UltimoPref: string; DataUltimoAtualizacao: string; Dados: Record<string, { geocod: string; geodsg: string; valor?: string }[]> }

/** "2.º Trimestre de 2026" -> "2026-Q2". */
export function quarterOf(label: string): string {
  const m = label.match(/^(\d)\.º Trimestre de (\d{4})$/);
  return m ? `${m[2]}-Q${m[1]}` : label;
}

/** The latest period's rate per m² for each municipality code. */
export function ineRates(ind: IneIndicator, codes: string[]): { period: string; updated: string; rates: Record<string, number> } {
  const period = Object.keys(ind.Dados).includes(ind.UltimoPref) ? ind.UltimoPref : Object.keys(ind.Dados).at(-1) ?? "";
  const rates: Record<string, number> = {};
  for (const r of ind.Dados[period] ?? []) {
    const v = Number(r.valor);
    if (codes.includes(r.geocod) && Number.isFinite(v) && v > 0) rates[r.geocod] = v;
  }
  return { period, updated: ind.DataUltimoAtualizacao, rates };
}

export function ineObservations(ind: IneIndicator, cities: City[], retrieved: string): ObservationFile {
  const { period, updated, rates } = ineRates(ind, Object.values(MUNICIPALITIES));
  const out: ObservationFile = { source: "pt-ine-rent", retrieved, observations: {} };
  for (const c of cities) {
    const rate = rates[MUNICIPALITIES[c.id] ?? ""];
    if (!rate) continue;
    out.observations[c.id] = (["rent_1bed", "rent_3bed"] as const).map((metric): Observation => ({
      metric, value: fromPerM2(rate, metric), period: quarterOf(period), level: "city", source: "pt-ine-rent", retrieved,
      note: `${c.name} municipality, median rent of new lease contracts of family homes in the 12 months to the end of ${quarterOf(period)}: ${rate.toFixed(2)} €/m² × ${FLAT_M2[metric]} m² (INE indicator ${INDICATOR}, updated ${updated})`,
    }));
  }
  return out;
}

if (isMain(import.meta.url)) {
  const [ind] = JSON.parse(await getText(API)) as IneIndicator[];
  if (!ind?.Dados) throw new Error("INE: no data in the answer");
  const out = ineObservations(ind, await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/pt-rent.json", out);
}
