// Paid leave for mothers and fathers from the OECD Family Database (table PF2.1, CC BY 4.0): weeks at full pay, the
// "full-rate equivalent" (weeks times the average payment rate for someone on average earnings). Node only: an xlsx
// without CORS. Country figures, matched by the English country name the table uses.
import type { Observation } from "../../core/types.ts";
import { round, type Fetcher } from "../context.ts";
import { xlsxRows } from "./xlsx-file.ts";

export const PF21_URL = "https://webfs.oecd.org/els-com/Family_Database/PF2_1_Parental_leave_systems.xlsx";

/** The table's names for the countries it covers, where they differ from a plain English name lookup. */
const NAMES: Record<string, string> = {
  AU: "Australia", AT: "Austria", BE: "Belgium", BG: "Bulgaria", CA: "Canada", CH: "Switzerland", CL: "Chile", CO: "Colombia", CR: "Costa Rica", CY: "Cyprus",
  CZ: "Czechia", DE: "Germany", DK: "Denmark", EE: "Estonia", ES: "Spain", FI: "Finland", FR: "France", GB: "United Kingdom", GR: "Greece", HR: "Croatia",
  HU: "Hungary", IE: "Ireland", IL: "Israel", IS: "Iceland", IT: "Italy", JP: "Japan", KR: "Korea", LT: "Lithuania", LU: "Luxembourg", LV: "Latvia",
  MT: "Malta", MX: "Mexico", NL: "Netherlands", NO: "Norway", NZ: "New Zealand", PL: "Poland", PT: "Portugal", RO: "Romania", SE: "Sweden",
  SI: "Slovenia", SK: "Slovak Republic", TR: "Türkiye", US: "United States",
};

/** Column 10 (index 10) of tables PF2.1.A and B is the total full-rate equivalent in weeks. */
function totals(rows: (string | number | null)[][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const name = typeof r[0] === "string" ? r[0].trim() : "";
    const v = r[10];
    if (name && typeof v === "number" && Number.isFinite(v)) out.set(name, v);
  }
  return out;
}

let parsed: { bytes: Uint8Array; mothers: Map<string, number>; fathers: Map<string, number>; year: string } | null = null;

export const oecdFamily: Fetcher = {
  source: "oecd-family-db",
  version: 1,
  runtimes: ["node"],
  covers: (c) => c.country in NAMES,
  async fetch(city, ctx) {
    const bytes = await ctx.bulk(PF21_URL);
    if (parsed?.bytes !== bytes) {
      const a = xlsxRows(bytes, "Table PF2.1.A");
      const title = a.flat().find((x) => typeof x === "string" && /in weeks, (\d{4})/.test(x)) as string | undefined;
      parsed = { bytes, mothers: totals(a), fathers: totals(xlsxRows(bytes, "Table PF2.1.B")), year: title?.match(/(\d{4})\s*$/)?.[1] ?? "" };
    }
    const name = NAMES[city.country]!;
    const base = { level: "country" as const, source: "oecd-family-db", retrieved: ctx.now().toISOString(), url: PF21_URL, fetcher: "oecd-family-db@1", period: parsed.year || "latest" };
    const out: Observation[] = [];
    const m = parsed.mothers.get(name);
    const f = parsed.fathers.get(name);
    if (m !== undefined) out.push({ metric: "leave_mothers", value: round(m, 1), note: `Paid maternity, parental and home-care leave available to mothers, in full-rate-equivalent weeks (OECD PF2.1.A, policies in April ${parsed.year || "of the table's year"}; not a current-year statutory entitlement)`,  ...base });
    if (f !== undefined) out.push({ metric: "leave_fathers", value: round(f, 1), note: `Paid paternity leave and leave reserved for fathers, in full-rate-equivalent weeks (OECD PF2.1.B, policies in April ${parsed.year || "of the table's year"}; not a current-year statutory entitlement)`,  ...base });
    return out;
  },
};
