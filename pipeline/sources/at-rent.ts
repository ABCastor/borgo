// Rents in Vienna from Statistik Austria's housing microcensus (Mikrozensus Wohnen, "Ergebnisse im Überblick:
// Wohnkosten", table 2; free reuse citing STATISTIK AUSTRIA, edits marked): the average monthly rent per m² of main
// tenancies (Hauptmietwohnungen) in the province of Vienna, which is the city, service charges included. Every
// tenancy, sitting tenants as well as new ones, a little over half of them municipal or cooperative flats. A monthly
// rent is the rate times the flat size in pipeline/rent.ts (a figure derived from the table, so marked as edited).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMain, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { readOds } from "../ods.ts";
import { FLAT_M2, fromPerM2 } from "../rent.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const FILE = "https://www.statistik.at/fileadmin/pages/351/ergebnisse_im_ueberblick_wohnkosten_Mikrozensus.ods";

type Row = (string | number | null)[];

/** The latest year's average rent per m² (service charges included) for one province, from table 2. */
export function microcensusRate(rows: Row[], province: string): { year: string; perM2: number } | null {
  const head = rows.find((r) => r[0] === "Jahr");
  const col = head?.findIndex((c) => String(c).replace(/[\s-]/g, "") === province) ?? -1;
  const start = rows.findIndex((r) => r.some((c) => typeof c === "string" && /pro m\s?2/.test(c)));
  if (col < 0 || start < 0) return null;
  let last: { year: string; perM2: number } | null = null;
  for (const r of rows.slice(start + 1)) {
    const year = String(r[0] ?? "").match(/^(\d{4})/)?.[1];
    if (!year) break;
    if (typeof r[col] === "number") last = { year, perM2: r[col] as number };
  }
  return last;
}

export function microcensusObservations(rows: Row[], cities: City[], retrieved: string): ObservationFile {
  const out: ObservationFile = { source: "at-mikrozensus", retrieved, observations: {} };
  const vienna = cities.find((c) => c.id === "vienna-at");
  const r = microcensusRate(rows, "Wien");
  if (!vienna || !r) return out;
  out.observations[vienna.id] = (["rent_1bed", "rent_3bed"] as const).map((metric): Observation => ({
    metric, value: fromPerM2(r.perM2, metric), period: r.year, level: "city", source: "at-mikrozensus", retrieved,
    note: `Vienna, average monthly rent of every main tenancy in ${r.year}, service charges included: ${r.perM2.toFixed(2)} €/m² × ${FLAT_M2[metric]} m² (STATISTIK AUSTRIA, Mikrozensus Wohnen; edited: rate times a flat size)`,
  }));
  return out;
}

if (isMain(import.meta.url)) {
  const file = join(mkdtempSync(join(tmpdir(), "statat-")), "wohnkosten.ods");
  execFileSync("curl", ["-sSL", "-A", UA, "-o", file, FILE]);
  const out = microcensusObservations(readOds(file)["Tabelle_2"] ?? [], await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/at-rent.json", out);
}
