// Average rents by bedrooms in Toronto, Vancouver and Montréal from CMHC's Rental Market Survey (October), as
// Statistics Canada republishes it (table 34-10-0133-01). Purpose-built rental apartments and rows of three units or
// more, every occupied unit surveyed, old and new tenancies. The figures are CMHC's: its Licence Agreement for the Use
// of Data lets them be redistributed only to people who accept its terms, so they live in data/observations-cmhc/
// and are published apart from the CC BY 4.0 data (src/registry/licences.ts).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import type { City } from "../../src/core/types.ts";

const ZIP = "https://www150.statcan.gc.ca/n1/tbl/csv/34100133-eng.zip";
const GEO: Record<string, string> = { "toronto-ca": "Toronto, Ontario", "vancouver-ca": "Vancouver, British Columbia", "montreal-ca": "Montréal, Quebec" };
const STRUCTURE = "Row and apartment structures of three units and over";
const UNITS = { rent_1bed: "One bedroom units", rent_3bed: "Three bedroom units" } as const;

const dir = mkdtempSync(join(tmpdir(), "cmhc-"));
execFileSync("curl", ["-sSL", "-A", UA, "-o", join(dir, "t.zip"), ZIP]);
execFileSync("unzip", ["-q", "-o", join(dir, "t.zip"), "34100133.csv", "-d", dir]);
const field = (line: string) => line.split('","').map((f) => f.replace(/^\uFEFF?"|"$/g, ""));
const lines = readFileSync(join(dir, "34100133.csv"), "utf8").split("\n").filter(Boolean);
const head = field(lines[0]!);
const col = (n: string) => head.indexOf(n);
const rows = lines.slice(1).map(field);

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "cmhc-rms", retrieved, observations: {} };
for (const c of cities) {
  const geo = GEO[c.id];
  if (!geo) continue;
  out.observations[c.id] = [];
  for (const [metric, unit] of Object.entries(UNITS) as [keyof typeof UNITS, string][]) {
    const series = rows.filter((r) => r[col("GEO")] === geo && r[col("Type of structure")] === STRUCTURE && r[col("Type of unit")] === unit && r[col("VALUE")] !== "");
    const last = series.sort((a, b) => a[col("REF_DATE")]!.localeCompare(b[col("REF_DATE")]!)).at(-1);
    if (!last) continue;
    out.observations[c.id]!.push({ metric, value: Number(last[col("VALUE")]), period: `${last[col("REF_DATE")]}-10`, level: "metro", source: "cmhc-rms", retrieved, note: `${geo} (census metropolitan area), ${unit.toLowerCase()}, average rent of purpose-built rental apartments and rows, October survey (CMHC via Statistics Canada table 34-10-0133-01)` });
  }
  console.log(c.id, out.observations[c.id]!.map((o) => `${o.metric}=${o.value} ${o.period}`).join(" "));
}
await writeJson("data/observations-cmhc/cmhc-rent.json", out);
