// Rents in Berlin, Hamburg and Munich from the 2022 census (Zensus 2022, Statistische Ämter des Bundes und der Länder,
// Datenlizenz Deutschland Namensnennung 2.0), table 4000W-0009: the average net cold rent per m² (without heating and
// service charges) of every rented flat on census day, 15 May 2022, by floor area. Sitting rents, so well below what a
// new lease costs in these cities. A one-bedroom home takes the rate of flats of 40-59 m², a three-bedroom home that of
// 80-99 m², each times the flat size in pipeline/rent.ts. Read through the census database's own download, which needs
// no account.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJson, isMain, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { FLAT_M2, fromPerM2 } from "../rent.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const TABLE = "4000W-0009";
const API = `https://ergebnisse.zensus2022.de/proxy/api/rest/tables/${TABLE}`;
/** Seed city -> municipality key (Gemeindeschlüssel, 12 digits). */
export const MUNICIPALITIES: Record<string, string> = { "berlin-de": "110000000000", "hamburg-de": "020000000000", "munich-de": "091620000000" };
/** The floor-area band each size takes its rate from. */
export const BANDS = { rent_1bed: "40 - 59 m²", rent_3bed: "80 - 99 m²" } as const;

/** Rate per m² by municipality key and floor-area band, from the table's CSV download (semicolons, decimal commas). */
export function zensusRates(csv: string): Record<string, Record<string, number>> {
  const lines = csv.split(/\r?\n/).map((l) => l.split(";"));
  const head = lines.find((l) => l.some((c) => /^\d{12} /.test(c)));
  const out: Record<string, Record<string, number>> = {};
  if (!head) return out;
  const cols = new Map<string, number>();
  head.forEach((c, i) => {
    const key = c.match(/^(\d{12}) /)?.[1];
    if (key && !cols.has(key)) cols.set(key, i);
  });
  for (const l of lines) {
    if (!/^\d\d\.\d\d\.\d{4}$/.test(l[0] ?? "")) continue;
    for (const [key, i] of cols) {
      const v = Number((l[i] ?? "").replace(",", "."));
      if (l[i] && Number.isFinite(v) && v > 0) (out[key] ??= {})[l[1]!] = v;
    }
  }
  return out;
}

export function zensusObservations(csv: string, cities: City[], retrieved: string): ObservationFile {
  const rates = zensusRates(csv);
  const out: ObservationFile = { source: "de-zensus", retrieved, observations: {} };
  for (const c of cities) {
    const r = rates[MUNICIPALITIES[c.id] ?? ""];
    if (!r) continue;
    const list: Observation[] = [];
    for (const metric of ["rent_1bed", "rent_3bed"] as const) {
      const rate = r[BANDS[metric]];
      if (rate) list.push({ metric, value: fromPerM2(rate, metric), period: "2022", level: "city", source: "de-zensus", retrieved, note: `${c.name}, average net cold rent (without heating and service charges) of every rented flat of ${BANDS[metric]} on census day 15 May 2022: ${rate.toFixed(2)} €/m² × ${FLAT_M2[metric]} m² (Zensus 2022, table ${TABLE})` });
    }
    if (list.length) out.observations[c.id] = list;
  }
  return out;
}

/** The table's CSV for the seed municipalities: its default view, with the columns set to those municipalities. */
export async function download(keys: string[]): Promise<string> {
  type Block = { mainAttributes: { attribute: string }[] };
  const structure = await getJson<{ initialState: { variableBlocks: Record<string, Block & { mainVariable: string }>; tableStructure: { colTitle: { blockCode: string }[] } } }>(`${API}/structure`);
  const state = structure.initialState;
  const [code, block] = Object.entries(state.variableBlocks).find(([, b]) => b.mainVariable === "GEOGM4")!;
  block.mainAttributes = keys.map((attribute) => ({ attribute, childVariable: null, childAttributes: [], isHidden: false, isDocumentary: false }));
  state.tableStructure.colTitle[0]!.blockCode = code;
  const res = await fetch(`${API}/download/csv/de`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify(state) });
  if (!res.ok) throw new Error(`Zensus download ${res.status}`);
  const zip = join(mkdtempSync(join(tmpdir(), "zensus-")), "table.zip");
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  return execFileSync("unzip", ["-p", zip]).toString("utf8").replace(/^\uFEFF/, "");
}

if (isMain(import.meta.url)) {
  const out = zensusObservations(await download(Object.values(MUNICIPALITIES)), await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value}`).join(" "));
  await writeJson("data/observations/de-rent.json", out);
}
