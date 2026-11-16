// Rents in Budapest from the Hungarian Central Statistical Office (KSH), experimental statistics
// "KSH–ingatlan.com-lakbérindex", table annex (tablamelleklet.xlsx; everything on ksh.hu is CC BY 4.0, "Forrás: KSH"
// with a working link): table 3 gives the average monthly rent of flats advertised for rent on ingatlan.com in each
// half-year, in thousand forints, and table 4 their average floor area. Asking rents of homes on offer, so what a
// newcomer is quoted. A monthly rent is the half-year's average rent over its average area, times the flat size in
// pipeline/rent.ts. ingatlan.com's own listings are proprietary and are not read: only KSH's published table is.
// ksh.hu refuses plain HTTP clients: save the month's table annex from a browser and pass it,
// node pipeline/sources/hu-rent.ts <tablamelleklet.xlsx> (the link is on the latest release's page, ANNEX_PAGE).
import { isMain, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import { FLAT_M2, fromPerM2 } from "../rent.ts";
import { readSheet, sheetNames } from "../xlsx.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const ANNEX_PAGE = "https://www.ksh.hu/s/kiserleti-statisztika/";
/** The annex's sheets: table 3 (average rent, thousand Ft a month) and table 4 (average floor area, m²). */
export const SHEETS = { rent: "3.", size: "4." } as const;

type Row = (string | number | null)[];

/** The newest half-year's value in the Budapest column of table 3 or 4: { period: "2026-H1", value }. */
export function halfYearValue(rows: Row[], column = "Budapest"): { period: string; value: number } | null {
  const head = rows.findIndex((r) => r.some((c) => typeof c === "string" && c.trim() === column));
  if (head < 0) return null;
  const col = rows[head]!.findIndex((c) => typeof c === "string" && c.trim() === column);
  let year = "";
  let last: { period: string; value: number } | null = null;
  for (const r of rows.slice(head + 1)) {
    if (typeof r[0] === "number" || /^\d{4}$/.test(String(r[0] ?? ""))) year = String(r[0]);
    const half = String(r[1] ?? "").trim();
    const v = r[col];
    if (year && (half === "I." || half === "II.") && typeof v === "number" && v > 0) last = { period: `${year}-H${half === "I." ? 1 : 2}`, value: v };
  }
  return last;
}

/** Budapest's asking rent per m² a month for the newest half-year both tables give. */
export function kshRate(rent: Row[], size: Row[]): { period: string; rentK: number; m2: number; perM2: number } | null {
  const r = halfYearValue(rent);
  const s = halfYearValue(size);
  if (!r || !s || r.period !== s.period) return null;
  return { period: r.period, rentK: r.value, m2: s.value, perM2: (r.value * 1000) / s.value };
}

const HALF = { H1: "first", H2: "second" } as const;

export function kshObservations(sheets: Record<keyof typeof SHEETS, Row[]>, cities: City[], retrieved: string): ObservationFile {
  const out: ObservationFile = { source: "hu-ksh-rent", retrieved, observations: {} };
  const r = kshRate(sheets.rent, sheets.size);
  if (!r || !cities.some((c) => c.id === "budapest-hu")) return out;
  const [year, h] = r.period.split("-") as [string, keyof typeof HALF];
  out.observations["budapest-hu"] = (["rent_1bed", "rent_3bed"] as const).map((metric): Observation => ({
    metric, value: fromPerM2(r.perM2, metric), period: r.period, level: "city", source: "hu-ksh-rent", retrieved,
    note: `Budapest, average monthly asking rent of flats advertised for rent on ingatlan.com in the ${HALF[h]} half of ${year}: ${Math.round(r.rentK)} thousand Ft over an average ${Math.round(r.m2)} m², ${Math.round(r.perM2).toLocaleString("en-GB")} Ft/m² × ${FLAT_M2[metric]} m² (Forrás: KSH, KSH–ingatlan.com-lakbérindex, tables 3 and 4; edited: rate times a flat size)`,
  }));
  return out;
}

if (isMain(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error(`ksh.hu refuses plain HTTP clients: save the latest release's table annex (tablamelleklet.xlsx, linked from ${ANNEX_PAGE}) from a browser and pass the file`);
  const names = sheetNames(file);
  const sheet = (n: string) => readSheet(file, names.indexOf(n) + 1);
  const out = kshObservations({ rent: sheet(SHEETS.rent), size: sheet(SHEETS.size) }, await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/hu-rent.json", out);
}
