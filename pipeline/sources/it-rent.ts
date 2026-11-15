// Rents in the six Italian seed cities from the Agenzia delle Entrate's Osservatorio del Mercato Immobiliare (OMI):
// the annex to its yearly Rapporto Immobiliare residenziale with every new residential lease registered in the year, by
// municipality and segment. For the open market a newcomer signs, the long-term ordinary segment (ORD_L: not
// subsidised, three years or more), the year's total rent over its total floor area gives a rent per m² a month,
// times 50 and 90 m² (pipeline/rent.ts). New leases only, so the rents new tenancies agreed.
// The Agenzia's terms allow use and processing with the source cited, and forbid selling or handing on the data
// themselves: not a CC BY licence, so the figures live in data/observations-omi/ and its own published file.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMain, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { fromPerM2, FLAT_M2 } from "../rent.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const CSV_URL = "https://www.agenziaentrate.gov.it/portale/documents/d/guest/dati_locazioni_capoluoghi_2018_2024-csv";
/** The seed cities by their cadastral code (COD_NAZ), so a namesake elsewhere never matches. */
export const CODES: Record<string, string> = { L219: "turin-it", F205: "milan-it", H501: "rome-it", F839: "naples-it", A944: "bologna-it", D612: "florence-it" };
export const SEGMENT = "ORD_L";

const num = (s: string | undefined) => Number(String(s ?? "").replace(/\./g, "").replace(",", "."));

export interface OmiRate {
  year: string;
  homes: number;
  m2: number;
  /** Total yearly rent, euro. */
  rent: number;
  /** Euro per m² a month. */
  perM2: number;
}

/** The newest year's ORD_L leases for each cadastral code asked for, from the annex CSV (semicolon-separated). */
export function omiRates(csv: string, codes: string[]): Record<string, OmiRate> {
  const lines = csv.split(/\r?\n/).filter(Boolean).map((l) => l.split(";"));
  const head = lines[0]!;
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const [year, seg, code, homes, m2, rent] = [col(/^ANNO$/), col(/^SEGMENTO_MERCATO$/), col(/^COD_NAZ$/), col(/^Abitazioni locate per intero/), col(/^Superficie in mq/), col(/^Canone annuo/)];
  if ([year, seg, code, homes, m2, rent].some((i) => i < 0)) throw new Error("OMI leases CSV: a column is missing");
  const latest = String(Math.max(...lines.slice(1).map((l) => Number(l[year])).filter(Number.isFinite)));
  const out: Record<string, OmiRate> = {};
  for (const l of lines.slice(1)) {
    if (l[year] !== latest || l[seg] !== SEGMENT || !codes.includes(l[code]!)) continue;
    const r = { year: latest, homes: num(l[homes]), m2: num(l[m2]), rent: num(l[rent]) };
    if (r.m2 > 0 && r.rent > 0) out[l[code]!] = { ...r, perM2: r.rent / r.m2 / 12 };
  }
  return out;
}

export function omiObservations(csv: string, cities: City[], retrieved: string): ObservationFile {
  const rates = omiRates(csv, Object.keys(CODES));
  const out: ObservationFile = { source: "it-omi-locazioni", retrieved, observations: {} };
  for (const [code, id] of Object.entries(CODES)) {
    const r = rates[code];
    const city = cities.find((c) => c.id === id);
    if (!r || !city) continue;
    const rate = Math.round(r.perM2 * 100) / 100;
    out.observations[id] = (["rent_1bed", "rent_3bed"] as const).map(
      (metric): Observation => ({
        metric,
        value: fromPerM2(rate, metric),
        period: r.year,
        level: "city",
        source: "it-omi-locazioni",
        retrieved,
        note: `Comune di ${city.name}, new leases registered in ${r.year}, long-term open-market contracts (ORD_L, three years or more, not subsidised): ${r.homes.toLocaleString("en-GB")} homes, average €${rate.toFixed(2)} per m² a month (the year's total rent over the total floor area), × ${FLAT_M2[metric]} m²`,
      }),
    );
  }
  return out;
}

if (isMain(import.meta.url)) {
  const file = join(mkdtempSync(join(tmpdir(), "omi-")), "locazioni.csv");
  execFileSync("curl", ["-sSL", "-A", UA, "-o", file, CSV_URL]);
  const out = omiObservations(readFileSync(file, "latin1"), await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations-omi/it-rent.json", out);
}
