// Rents in Zurich and Geneva from the Federal Statistical Office (BFS, table T 09.03.03.42, opendata.swiss "open use,
// must provide the source"): the average monthly net rent (without service and heating charges) of rented and
// cooperative flats in the ten largest cities, by number of rooms, from three pooled years of the structural survey.
// Every tenancy, so sitting rents. Swiss rooms leave out the kitchen: 2 rooms is one bedroom, 4 rooms three bedrooms.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJson, isMain, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { readSheet } from "../xlsx.ts";
import type { City, Observation } from "../../src/core/types.ts";

const SEARCH = "https://ckan.opendata.swiss/api/3/action/package_search?q=name:durchschnittlicher-mietpreis-in-franken-nach-zimmerzahl-fur-die-10-grossten-stadte*&rows=50";
/** Seed city -> the names the table gives it, in the BFS's languages. */
export const NAMES: Record<string, string[]> = { "zurich-ch": ["Zürich", "Zurich", "Zurigo"], "geneva-ch": ["Genf", "Genève", "Ginevra"] };
export const ROOMS = { rent_1bed: 2, rent_3bed: 4 } as const;

type Row = (string | number | null)[];

/** Average rent by city name and number of rooms, from the table's first sheet. */
export function bfsRents(rows: Row[]): { period: string; rents: Record<string, Partial<Record<number, number>>> } {
  const period = String(rows.flat().find((c) => typeof c === "string" && /^\d{4}-\d{4}/.test(c)) ?? "").slice(0, 9);
  const head = rows.find((r) => r.includes(2) && r.includes(4) && r.some((c) => c === "Total"))!;
  const rents: Record<string, Partial<Record<number, number>>> = {};
  for (const r of rows) {
    if (typeof r[0] !== "string" || typeof r[1] !== "number") continue;
    for (const rooms of [2, 4]) {
      const v = r[head.indexOf(rooms)];
      if (typeof v === "number" && v > 0) (rents[r[0].trim()] ??= {})[rooms] = v;
    }
  }
  return { period, rents };
}

export function bfsObservations(rows: Row[], cities: City[], retrieved: string): ObservationFile {
  const { period, rents } = bfsRents(rows);
  const out: ObservationFile = { source: "ch-bfs-rent", retrieved, observations: {} };
  for (const c of cities) {
    const name = NAMES[c.id]?.find((n) => rents[n]);
    if (!name) continue;
    const list: Observation[] = [];
    for (const [metric, rooms] of Object.entries(ROOMS) as [keyof typeof ROOMS, number][]) {
      const v = rents[name]![rooms];
      if (v) list.push({ metric, value: v, period, level: "city", source: "ch-bfs-rent", retrieved, note: `${c.name}, average monthly net rent (without service and heating charges) of every rented ${rooms}-room flat, structural surveys ${period} pooled (BFS T 09.03.03.42)` });
    }
    if (list.length) out.observations[c.id] = list;
  }
  return out;
}

if (isMain(import.meta.url)) {
  const found = await getJson<{ result: { results: { name: string; resources: { format: string; download_url?: string; url: string }[] }[] } }>(SEARCH);
  const latest = found.result.results.sort((a, b) => a.name.localeCompare(b.name)).at(-1)!;
  const xls = latest.resources.find((r) => /xls/i.test(r.format))!;
  const file = join(mkdtempSync(join(tmpdir(), "bfs-")), "rent.xlsx");
  execFileSync("curl", ["-sSL", "-A", UA, "-o", file, xls.download_url ?? xls.url]);
  const out = bfsObservations(readSheet(file, 1), await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/ch-rent.json", out);
}
