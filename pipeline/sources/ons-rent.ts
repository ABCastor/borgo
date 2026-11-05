// Average private rents by bedrooms and local authority from the ONS Price Index of Private Rents (OGL v3).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getText, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import { readSheet, sheetNames } from "../xlsx.ts";
import type { City, Observation } from "../../src/core/types.ts";

const PAGE = "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics";
// City id -> ONS area code (London is the region; the others are local authorities).
const AREAS: Record<string, string> = {
  "london-gb": "E12000007",
  "cambridge-gb": "E07000008",
  "manchester-gb": "E08000003",
  "bristol-gb": "E06000023",
  "edinburgh-gb": "S12000036",
};

const html = await getText(PAGE);
const href = html.match(/href="(\/file\?uri=[^"]+\.xlsx)"/)?.[1];
if (!href) throw new Error("ONS page: no xlsx link");
const file = join(mkdtempSync(join(tmpdir(), "ons-")), "pipr.xlsx");
execFileSync("curl", ["-sSL", "-A", UA, "-o", file, `https://www.ons.gov.uk${href}`]);
const sheet = sheetNames(file).indexOf("Table 1") + 1;
const rows = readSheet(file, sheet);
const head = rows.findIndex((r) => r[0] === "Time period");
const header = rows[head]!.map(String);
const col = (n: string) => header.indexOf(n);
const excelDate = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 7);

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const out: ObservationFile = { source: "ons-pipr", retrieved, observations: {} };
for (const c of cities) {
  const code = AREAS[c.id];
  if (!code) continue;
  const series = rows.slice(head + 1).filter((r) => r[col("Area code")] === code && typeof r[col("Rental price one bed")] === "number");
  const last = series.at(-1);
  if (!last) continue;
  const period = excelDate(Number(last[col("Time period")]));
  const obs: Observation[] = [];
  const base = { period, level: (code.startsWith("E12") ? "region" : "city") as Observation["level"], source: "ons-pipr", retrieved, note: `${last[col("Area name")]}, average of new and existing private tenancies` };
  obs.push({ metric: "rent_1bed", value: Number(last[col("Rental price one bed")]), ...base });
  const three = last[col("Rental price three bed")];
  if (typeof three === "number") obs.push({ metric: "rent_3bed", value: three, ...base });
  out.observations[c.id] = obs;
  console.log(c.id, period, obs.map((o) => `${o.metric}=${o.value}`).join(" "));
}
await writeJson("data/observations/ons-rent.json", out);
