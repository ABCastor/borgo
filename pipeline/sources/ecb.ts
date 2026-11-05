// Euro foreign exchange reference rates from the European Central Bank (free reuse with attribution).
import { getText, writeJson } from "../lib.ts";

const xml = await getText("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
const rates: Record<string, number> = {};
for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]!] = Number(m[2]);
if (!date || Object.keys(rates).length < 20) throw new Error("ECB feed did not parse");
// The ECB does not publish AED; the dirham is pegged at 3.6725 per US dollar by the UAE Central Bank.
if (rates.USD) rates.AED = Math.round(rates.USD * 3.6725 * 1e4) / 1e4;
await writeJson("data/fx.json", { base: "EUR", date, source: "ecb-fx", rates });
console.log(`ECB rates for ${date}: ${Object.keys(rates).length} currencies`);
