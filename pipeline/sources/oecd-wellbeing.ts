// Life satisfaction (0-10) by country from the OECD Well-being Database ("How's Life?", current well-being).
// OECD terms: free reuse, including commercial, with citation.
import { execFileSync } from "node:child_process";
import { readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

const URL = "https://sdmx.oecd.org/public/rest/data/OECD.WISE.WDP,DSD_HSL@DF_HSL_CWB,1.1/all?format=csvfilewithlabels&startPeriod=2018";
const ISO3_TO_2: Record<string, string> = { ITA: "IT", GBR: "GB", IRL: "IE", FRA: "FR", DEU: "DE", NLD: "NL", BEL: "BE", DNK: "DK", SWE: "SE", NOR: "NO", FIN: "FI", CHE: "CH", AUT: "AT", CZE: "CZ", POL: "PL", HUN: "HU", PRT: "PT", ESP: "ES", GRC: "GR", EST: "EE", USA: "US", CAN: "CA", JPN: "JP", AUS: "AU", NZL: "NZ" };

function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) ch === '"' ? (line[i + 1] === '"' ? ((cur += '"'), i++) : (q = false)) : (cur += ch);
    else if (ch === '"') q = true;
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = execFileSync("curl", ["-sSL", "--max-time", "120", "-A", "Mozilla/5.0 (compatible; borgo-data-pipeline)", URL], { maxBuffer: 1 << 28 }).toString().split(/\r?\n/).filter(Boolean);
const head = csvLine(lines[0]!);
const col = (n: string) => head.indexOf(n);
const best = new Map<string, { year: string; value: number }>();
for (const l of lines.slice(1)) {
  const f = csvLine(l);
  if (f[col("MEASURE")] !== "11_1" || f[col("AGE")] !== "_T" || f[col("SEX")] !== "_T" || f[col("EDUCATION_LEV")] !== "_T") continue;
  const iso2 = ISO3_TO_2[f[col("REF_AREA")]!];
  const v = Number(f[col("OBS_VALUE")]);
  const y = f[col("TIME_PERIOD")]!;
  if (!iso2 || !Number.isFinite(v)) continue;
  const prev = best.get(iso2);
  if (!prev || y > prev.year) best.set(iso2, { year: y, value: v });
}

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "oecd-wellbeing", retrieved, observations: {} };
for (const c of cities) {
  const b = best.get(c.country);
  out.observations[c.id] = b
    ? [{ metric: "life_evaluation", value: Math.round(b.value * 100) / 100, period: b.year, level: "country", source: "oecd-wellbeing", retrieved, note: "Average answer to how satisfied people are with their life as a whole, 0 to 10" }]
    : [];
}
await writeJson("data/observations/oecd-wellbeing.json", out);
console.log([...best].map(([k, v]) => `${k} ${v.value} (${v.year})`).join(" · "));
