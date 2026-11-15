// Rents in Madrid, Barcelona, Valencia and Málaga from the housing ministry's state rent reference system (SERPAVI,
// Ministerio de Vivienda y Agenda Urbana), built from income tax returns: the median monthly rent per m² of flats
// (collective dwellings) let as someone's main home, every lease declared that year, so sitting tenants as well as new
// ones. Reused under the general conditions for public-sector information (Real Decreto 1495/2011): source and update
// date cited, figures not distorted. A monthly rent is the rate times the flat size in pipeline/rent.ts.
import { isMain, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { FLAT_M2, fromPerM2 } from "../rent.ts";
import { readSheet, sheetNames } from "../xlsx.ts";
import type { City, Observation } from "../../src/core/types.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The edition of March 2026 (tax years 2011 to 2024). The ministry's page lists each new edition.
export const FILE = "https://cdn.mivau.gob.es/portal-web-mivau/vivienda/serpavi/2026-03_09_bd_SERPAVI_2011-2024%20-%20DEFINITIVO%20WEB_v2.xlsx";
export const EDITION = "2026-03-09";
/** Seed city -> INE municipality code. */
export const MUNICIPALITIES: Record<string, string> = { "madrid-es": "28079", "barcelona-es": "08019", "valencia-es": "46250", "malaga-es": "29067" };

type Row = (string | number | null)[];

/** The latest year's median rent per m² of flats and its lease count, for each municipality code, from the Municipios sheet. */
export function serpaviRates(rows: Row[], codes: string[]): Record<string, { year: string; perM2: number; leases: number }> {
  const head = rows[0]!.map(String);
  const years = head.map((h) => h.match(/^ALQM2_LV_M_VC_(\d\d)$/)?.[1]).filter((y): y is string => !!y).sort();
  const yy = years.at(-1);
  const out: ReturnType<typeof serpaviRates> = {};
  if (!yy) return out;
  const rate = head.indexOf(`ALQM2_LV_M_VC_${yy}`);
  const count = head.indexOf(`BI_ALVHEPCO_TVC_${yy}`);
  const code = head.indexOf("CUMUN");
  for (const r of rows.slice(1)) {
    const c = String(r[code] ?? "").padStart(5, "0");
    const perM2 = Number(r[rate]);
    if (codes.includes(c) && Number.isFinite(perM2) && perM2 > 0) out[c] = { year: `20${yy}`, perM2, leases: Number(r[count]) };
  }
  return out;
}

export function serpaviObservations(rows: Row[], cities: City[], retrieved: string): ObservationFile {
  const rates = serpaviRates(rows, Object.values(MUNICIPALITIES));
  const out: ObservationFile = { source: "es-serpavi", retrieved, observations: {} };
  for (const c of cities) {
    const r = rates[MUNICIPALITIES[c.id] ?? ""];
    if (!r) continue;
    out.observations[c.id] = (["rent_1bed", "rent_3bed"] as const).map((metric): Observation => ({
      metric, value: fromPerM2(r.perM2, metric), period: r.year, level: "city", source: "es-serpavi", retrieved,
      note: `${c.name} municipality, median rent of flats let as a main home in ${r.year}, every lease declared in income tax returns (${r.leases} flats): ${r.perM2.toFixed(2)} €/m² × ${FLAT_M2[metric]} m² (SERPAVI, edition ${EDITION})`,
    }));
  }
  return out;
}

if (isMain(import.meta.url)) {
  const file = join(mkdtempSync(join(tmpdir(), "serpavi-")), "serpavi.xlsx");
  execFileSync("curl", ["-sSL", "-A", UA, "-o", file, FILE]);
  const rows = readSheet(file, sheetNames(file).indexOf("Municipios") + 1);
  const out = serpaviObservations(rows, await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/es-rent.json", out);
}
