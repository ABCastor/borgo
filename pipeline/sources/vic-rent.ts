// Rents in Melbourne from the Victorian Department of Families, Fairness and Housing's Rental Report (DataVic,
// CC BY 4.0): the median weekly rent of new bonds lodged in the latest quarter in the City of Melbourne local
// government area, for one-bedroom and three-bedroom flats, so the rents new tenancies agreed. Weekly to monthly:
// 52 weeks over 12 months. The report has no figure for Greater Melbourne as a whole, so the central city stands in.
// The department's host refuses plain HTTP clients: when the download fails, save the file from a browser and pass it,
// node pipeline/sources/vic-rent.ts <file.xlsx>.
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJson, isMain, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { weeklyToMonthly } from "../rent.ts";
import { readSheet, sheetNames } from "../xlsx.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const PACKAGE = "https://discover.data.vic.gov.au/api/3/action/package_show?id=rental-report-quarterly-quarterly-median-rents-by-lga";
export const SHEETS = { rent_1bed: "1 bedroom flat", rent_3bed: "3 bedroom flat" } as const;
export const LGA = "Melbourne";

type Row = (string | number | null)[];

/** The newest quarter's count and median for the LGA, from one dwelling type's sheet. */
export function vicRent(rows: Row[], lga = LGA): { quarter: string; bonds: number; weekly: number } | null {
  const periods = rows[1] ?? [];
  const kinds = rows[2] ?? [];
  const last = kinds.lastIndexOf("Median");
  const row = rows.find((r) => r[1] === lga);
  if (last < 1 || !row) return null;
  const weekly = Number(row[last]);
  return weekly > 0 ? { quarter: String(periods[last] ?? ""), bonds: Number(row[last - 1]), weekly } : null;
}

/** "Jun 2026" -> "2026-Q2". */
export function quarterOf(label: string): string {
  const m = label.match(/^(Mar|Jun|Sep|Dec)\w* (\d{4})$/);
  return m ? `${m[2]}-Q${["Mar", "Jun", "Sep", "Dec"].indexOf(m[1]!) + 1}` : label;
}

export function vicObservations(sheets: Record<keyof typeof SHEETS, Row[]>, cities: City[], retrieved: string): ObservationFile {
  const out: ObservationFile = { source: "vic-rental-report", retrieved, observations: {} };
  if (!cities.some((c) => c.id === "melbourne-au")) return out;
  const list: Observation[] = [];
  for (const metric of ["rent_1bed", "rent_3bed"] as const) {
    const r = vicRent(sheets[metric]);
    if (r) list.push({ metric, value: weeklyToMonthly(r.weekly), period: quarterOf(r.quarter), level: "city", source: "vic-rental-report", retrieved, note: `City of Melbourne (local government area), median weekly rent of ${SHEETS[metric]}s in new bonds lodged in the ${r.quarter} quarter: A$${r.weekly} a week (${r.bonds} bonds), × 52 / 12` });
  }
  if (list.length) out.observations["melbourne-au"] = list;
  return out;
}

if (isMain(import.meta.url)) {
  let file = process.argv[2];
  if (!file) {
    const pkg = await getJson<{ result: { resources: { url: string; name: string }[] } }>(PACKAGE);
    const url = pkg.result.resources.at(-1)!.url;
    file = join(mkdtempSync(join(tmpdir(), "vic-")), "rents.xlsx");
    execFileSync("curl", ["-sSL", "--http1.1", "-m", "60", "-A", UA, "-o", file, url]);
    if (!statSync(file, { throwIfNoEntry: false })?.size) throw new Error(`${url} refused the download: save it from a browser and pass the file`);
  }
  const names = sheetNames(file);
  const sheet = (n: string) => readSheet(file!, names.indexOf(n) + 1);
  const out = vicObservations({ rent_1bed: sheet(SHEETS.rent_1bed), rent_3bed: sheet(SHEETS.rent_3bed) }, await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/vic-rent.json", out);
}
