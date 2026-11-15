// Rents in Sydney from the NSW Department of Communities and Justice's Rent and Sales Report (CC BY 4.0): the median
// weekly rent of new bonds lodged in Greater Sydney in the latest quarter, for one- and three-bedroom homes of every
// dwelling type, so the rents new tenancies agreed. Weekly to monthly: 52 weeks over 12 months.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getText, isMain, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { weeklyToMonthly } from "../rent.ts";
import { readSheet, sheetNames } from "../xlsx.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const PAGE = "https://dcj.nsw.gov.au/about-us/families-and-communities-statistics/housing-rent-and-sales/rent-and-sales-report.html";
export const BEDROOMS = { rent_1bed: "1 Bedroom", rent_3bed: "3 Bedrooms" } as const;

type Row = (string | number | null)[];
const num = (v: string | number | null | undefined) => Number(String(v ?? "").replace(/,/g, ""));

/** Greater Sydney's median weekly rent and new bonds by number of bedrooms, from the report's LGA sheet. */
export function nswRents(rows: Row[]): { period: string; rents: Partial<Record<keyof typeof BEDROOMS, { weekly: number; bonds: number }>> } {
  const period = String(rows.flat().find((c) => typeof c === "string" && /^Reporting period:/.test(c)) ?? "").replace(/^Reporting period:\s*/, "");
  const rents: ReturnType<typeof nswRents>["rents"] = {};
  for (const [metric, beds] of Object.entries(BEDROOMS) as [keyof typeof BEDROOMS, string][]) {
    const r = rows.find((x) => x[1] === "Greater Sydney" && x[2] === "Total" && x[3] === "Total" && x[4] === "Total" && x[5] === beds);
    const weekly = num(r?.[7]);
    if (r && weekly > 0) rents[metric] = { weekly, bonds: num(r[9]) };
  }
  return { period, rents };
}

/** "April to June 2026" -> "2026-Q2". */
export function quarterOf(period: string): string {
  const m = period.match(/(\w+) to (\w+) (\d{4})/);
  const end = m ? ["March", "June", "September", "December"].indexOf(m[2]!) : -1;
  return m && end >= 0 ? `${m[3]}-Q${end + 1}` : period;
}

export function nswObservations(rows: Row[], cities: City[], retrieved: string): ObservationFile {
  const { period, rents } = nswRents(rows);
  const out: ObservationFile = { source: "nsw-rent-sales", retrieved, observations: {} };
  const sydney = cities.find((c) => c.id === "sydney-au");
  if (!sydney) return out;
  const list: Observation[] = [];
  for (const metric of ["rent_1bed", "rent_3bed"] as const) {
    const r = rents[metric];
    if (r) list.push({ metric, value: weeklyToMonthly(r.weekly), period: quarterOf(period), level: "metro", source: "nsw-rent-sales", retrieved, note: `Greater Sydney, median weekly rent of ${BEDROOMS[metric].toLowerCase()} homes in new bonds lodged ${period}: A$${r.weekly} a week (${r.bonds} bonds), × 52 / 12` });
  }
  if (list.length) out.observations[sydney.id] = list;
  return out;
}

if (isMain(import.meta.url)) {
  const href = (await getText(PAGE)).match(/href="([^"]*rent-tables-[^"]*\.xlsx)"/)?.[1];
  if (!href) throw new Error("Rent and Sales Report: no rent tables link");
  const file = join(mkdtempSync(join(tmpdir(), "nsw-")), "rent.xlsx");
  execFileSync("curl", ["-sSL", "-A", UA, "-o", file, new URL(href, PAGE).toString()]);
  const out = nswObservations(readSheet(file, sheetNames(file).indexOf("LGA") + 1), await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/au-rent.json", out);
}
