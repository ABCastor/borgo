// Country-level indicators from the World Bank World Development Indicators, CC BY 4.0: price level, homicides, life
// expectancy and out-of-pocket health spending.
import { getJson, readJson, today, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";

type Row = { countryiso3code: string; country: { id: string }; date: string; value: number | null };

async function indicator(code: string, countries: string[]): Promise<Map<string, Map<string, number>>> {
  const url = `https://api.worldbank.org/v2/country/${countries.join(";")}/indicator/${code}?format=json&per_page=2000&date=2015:2025`;
  const res = await getJson<[unknown, Row[] | null]>(url);
  const out = new Map<string, Map<string, number>>();
  for (const r of res[1] ?? []) {
    if (r.value === null) continue;
    const iso2 = r.country.id;
    if (!out.has(iso2)) out.set(iso2, new Map());
    out.get(iso2)!.set(r.date, r.value);
  }
  return out;
}

function latest(m: Map<string, number> | undefined): [string, number] | null {
  if (!m || m.size === 0) return null;
  const year = [...m.keys()].sort().at(-1)!;
  return [year, m.get(year)!];
}

const cities = await readJson<City[]>("data/cities.json");
const countries = [...new Set(cities.map((c) => c.country))];
const retrieved = today();
const [ppp, fx, homicide, life, oop] = await Promise.all([
  indicator("PA.NUS.PRVT.PP", countries),
  indicator("PA.NUS.FCRF", countries),
  indicator("VC.IHR.PSRC.P5", countries),
  indicator("SP.DYN.LE00.IN", countries),
  indicator("SH.XPD.OOPC.PC.CD", countries),
]);

const byCountry = new Map<string, Observation[]>();
for (const iso of countries) {
  const obs: Observation[] = [];
  const base = { level: "country" as const, source: "worldbank-wdi", retrieved };
  // Price level of household consumption relative to the United States (US = 100): PPP factor / market exchange rate, same year.
  const p = ppp.get(iso);
  const f = fx.get(iso);
  const years = p ? [...p.keys()].filter((y) => f?.has(y) || iso === "US").sort() : [];
  const y = years.at(-1);
  if (y && p) {
    const rate = iso === "US" ? 1 : f!.get(y)!;
    obs.push({ metric: "price_level", value: Math.round((p.get(y)! / rate) * 1000) / 10, period: y, ...base, note: "Private consumption PPP over the market exchange rate; United States = 100" });
  }
  const h = latest(homicide.get(iso));
  if (h) obs.push({ metric: "homicide_rate", value: Math.round(h[1] * 100) / 100, period: h[0], ...base, note: "Intentional homicides per 100,000 people (UNODC via World Bank)" });
  const l = latest(life.get(iso));
  if (l) obs.push({ metric: "life_expectancy", value: Math.round(l[1] * 10) / 10, period: l[0], ...base });
  const o = latest(oop.get(iso));
  if (o) obs.push({ metric: "health_oop", value: Math.round(o[1]), period: o[0], ...base, note: "Out-of-pocket health expenditure per person, current US dollars (WHO Global Health Expenditure Database via World Bank)" });
  byCountry.set(iso, obs);
}

const out: ObservationFile = { source: "worldbank-wdi", retrieved, observations: {} };
for (const c of cities) out.observations[c.id] = byCountry.get(c.country) ?? [];
await writeJson("data/observations/worldbank.json", out);
for (const [iso, obs] of byCountry) console.log(iso, obs.map((o) => `${o.metric}=${o.value}(${o.period})`).join(" "));
