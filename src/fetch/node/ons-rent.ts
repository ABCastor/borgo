// Average private rents by local authority from the ONS Price Index of Private Rents (OGL v3), for any UK city whose
// name matches a local authority ("Manchester", "Bristol, City of", "City of Edinburgh"); London is the region.
// Node only: the xlsx is linked from a page and served without CORS.
import type { Observation } from "../../core/types.ts";
import { fold, type Fetcher } from "../context.ts";
import { xlsxRows } from "./xlsx-file.ts";

const PAGE = "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics";

const bare = (s: string) => fold(s).replace(/^city of /, "").replace(/ city of$/, "").replace(/ city$/, "");

export const onsRent: Fetcher = {
  source: "ons-pipr",
  version: 1,
  runtimes: ["node"],
  covers: (c) => c.country === "GB",
  async fetch(city, ctx) {
    const href = (await ctx.text(PAGE)).match(/href="(\/file\?uri=[^"]+\.xlsx)"/)?.[1];
    if (!href) throw new Error("ONS page: no xlsx link");
    const url = `https://www.ons.gov.uk${href}`;
    const rows = xlsxRows(await ctx.bulk(url), "Table 1");
    const head = rows.findIndex((r) => r[0] === "Time period");
    const header = rows[head]!.map(String);
    const col = (n: string) => header.indexOf(n);
    const names = new Set([city.name, ...(city.aliases ?? [])].map(bare));
    const series = rows.slice(head + 1).filter((r) => names.has(bare(String(r[col("Area name")] ?? ""))) && typeof r[col("Rental price one bed")] === "number");
    const last = series.at(-1);
    if (!last) return [];
    const code = String(last[col("Area code")]);
    const excelDate = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 7);
    const base = { period: excelDate(Number(last[col("Time period")])), level: (code.startsWith("E12") ? "region" : "city") as Observation["level"], source: "ons-pipr", retrieved: ctx.now().toISOString(), url, fetcher: "ons-pipr@1", note: `${last[col("Area name")]}, average of new and existing private tenancies` };
    const out: Observation[] = [{ metric: "rent_1bed", value: Number(last[col("Rental price one bed")]), ...base }];
    const three = last[col("Rental price three bed")];
    if (typeof three === "number") out.push({ metric: "rent_3bed", value: three, ...base });
    return out;
  },
};
