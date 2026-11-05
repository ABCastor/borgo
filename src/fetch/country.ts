// Country figures standing in for the city: price level, homicides, life expectancy, out-of-pocket health spending,
// doctors, unemployment and adults with a degree from the World Bank (CC BY 4.0), control of corruption from the World Bank's governance
// indicators (CC BY 4.0), life satisfaction from the OECD (members only). Marked level "country" so every face says so.
import type { Observation } from "../core/types.ts";
import { round, type Fetcher } from "./context.ts";

type WbRow = { date: string; value: number | null };

async function wb(ctx: Parameters<Fetcher["fetch"]>[1], iso2: string, code: string): Promise<{ url: string; rows: Map<string, number> }> {
  const url = `https://api.worldbank.org/v2/country/${iso2}/indicator/${code}?format=json&per_page=100&date=2015:${ctx.now().getUTCFullYear()}`;
  const res = await ctx.json<[unknown, WbRow[] | null]>(url);
  const rows = new Map<string, number>();
  for (const r of res[1] ?? []) if (typeof r.value === "number" && Number.isFinite(r.value)) rows.set(r.date, r.value);
  return { url, rows };
}

const latest = (m: Map<string, number>): [string, number] | null => {
  const y = [...m.keys()].sort().at(-1);
  return y ? [y, m.get(y)!] : null;
};

export const worldBank: Fetcher = {
  source: "worldbank-wdi",
  version: 4,
  runtimes: ["browser", "node"],
  async fetch(city, ctx) {
    const retrieved = ctx.now().toISOString();
    const iso = city.country;
    const [ppp, fx, homicide, life, oop, doctors, jobless, degree] = await Promise.all(["PA.NUS.PRVT.PP", "PA.NUS.FCRF", "VC.IHR.PSRC.P5", "SP.DYN.LE00.IN", "SH.XPD.OOPC.PC.CD", "SH.MED.PHYS.ZS", "SL.UEM.TOTL.ZS", "SE.TER.CUAT.ST.ZS"].map((c) => wb(ctx, iso, c)));
    const base = { level: "country" as const, source: "worldbank-wdi", retrieved, fetcher: "worldbank-wdi@4" };
    const out: Observation[] = [];
    // Price level of household consumption against the United States (= 100): PPP factor over the market rate, same year.
    const years = [...ppp!.rows.keys()].filter((y) => iso === "US" || fx!.rows.has(y)).sort();
    const y = years.at(-1);
    if (y) {
      const rate = iso === "US" ? 1 : fx!.rows.get(y)!;
      out.push({ metric: "price_level", value: round((ppp!.rows.get(y)! / rate) * 100), period: y, ...base, url: ppp!.url, note: "Private consumption PPP over the market exchange rate; United States = 100" });
    }
    const h = latest(homicide!.rows);
    if (h) out.push({ metric: "homicide_rate", value: round(h[1], 2), period: h[0], ...base, url: homicide!.url, note: "Intentional homicides per 100,000 people (UNODC via World Bank)" });
    const l = latest(life!.rows);
    if (l) out.push({ metric: "life_expectancy", value: round(l[1]), period: l[0], ...base, url: life!.url });
    const o = latest(oop!.rows);
    if (o) out.push({ metric: "health_oop", value: round(o[1], 0), period: o[0], ...base, url: oop!.url, note: "Out-of-pocket health expenditure per person, current US dollars (WHO Global Health Expenditure Database via World Bank)" });
    const d = latest(doctors!.rows);
    if (d) out.push({ metric: "doctors", value: round(d[1], 2), period: d[0], ...base, url: doctors!.url, note: "Physicians per 1,000 people (WHO Global Health Workforce Statistics via World Bank)" });
    const u = latest(jobless!.rows);
    if (u) out.push({ metric: "unemployment", value: round(u[1], 1), period: u[0], ...base, url: jobless!.url, note: "Unemployment, % of the labour force, ILO modelled estimate (via World Bank)" });
    const g = latest(degree!.rows);
    if (g) out.push({ metric: "degree_share", value: round(g[1], 1), period: g[0], ...base, url: degree!.url, note: "At least short-cycle tertiary education, % of people aged 25 and over (UNESCO Institute for Statistics via World Bank)" });
    return out;
  },
};

/** Control of corruption, from the Worldwide Governance Indicators: an estimate from about -2.5 (weak) to 2.5 (strong). */
export const wgi: Fetcher = {
  source: "worldbank-wgi",
  version: 2,
  runtimes: ["browser", "node"],
  async fetch(city, ctx) {
    // The indicator endpoint with source=3, not /sources/3/...: only the indicator endpoint lets a browser read it (CORS).
    const url = `https://api.worldbank.org/v2/country/${city.country}/indicator/GOV_WGI_CC.EST?source=3&format=json&per_page=100`;
    const res = await ctx.json<[unknown, { date: string; value: number | null }[] | null]>(url);
    const rows = new Map<string, number>();
    for (const r of res[1] ?? []) if (typeof r.value === "number" && Number.isFinite(r.value)) rows.set(r.date, r.value);
    const l = latest(rows);
    if (!l) return [];
    return [{ metric: "clean_government", value: round(l[1], 2), period: l[0], level: "country", source: "worldbank-wgi", retrieved: ctx.now().toISOString(), url, fetcher: "worldbank-wgi@2", note: "Control of corruption, governance estimate (Worldwide Governance Indicators)" }];
  },
};

// OECD members by ISO alpha-2 -> alpha-3: the only countries the well-being database covers.
const OECD: Record<string, string> = {
  AU: "AUS", AT: "AUT", BE: "BEL", CA: "CAN", CL: "CHL", CO: "COL", CR: "CRI", CZ: "CZE", DK: "DNK", EE: "EST", FI: "FIN", FR: "FRA", DE: "DEU", GR: "GRC",
  HU: "HUN", IS: "ISL", IE: "IRL", IL: "ISR", IT: "ITA", JP: "JPN", KR: "KOR", LV: "LVA", LT: "LTU", LU: "LUX", MX: "MEX", NL: "NLD", NZ: "NZL", NO: "NOR",
  PL: "POL", PT: "PRT", SK: "SVK", SI: "SVN", ES: "ESP", SE: "SWE", CH: "CHE", TR: "TUR", GB: "GBR", US: "USA",
};

function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
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

export const oecd: Fetcher = {
  source: "oecd-wellbeing",
  version: 1,
  // Node only: the OECD answers a browser's own request without the CORS header, so a browser skips it with that
  // reason and the CLI or MCP server fetches it.
  runtimes: ["node"],
  covers: (c) => c.country in OECD,
  async fetch(city, ctx) {
    const iso3 = OECD[city.country]!;
    // Key order: REF_AREA.MEASURE.UNIT_MEASURE.AGE.SEX.EDUCATION_LEV.DOMAIN; 11_1 is life satisfaction, _T the total.
    const url = `https://sdmx.oecd.org/public/rest/data/OECD.WISE.WDP,DSD_HSL@DF_HSL_CWB,1.1/${iso3}.11_1.._T._T._T.?format=csvfilewithlabels&startPeriod=2018`;
    const lines = (await ctx.text(url)).split(/\r?\n/).filter(Boolean);
    const head = csvLine(lines[0] ?? "");
    const col = (n: string) => head.indexOf(n);
    let best: { year: string; value: number } | null = null;
    for (const l of lines.slice(1)) {
      const f = csvLine(l);
      const v = Number(f[col("OBS_VALUE")]);
      const y = f[col("TIME_PERIOD")]!;
      if (f[col("REF_AREA")] !== iso3 || !Number.isFinite(v)) continue;
      if (!best || y > best.year) best = { year: y, value: v };
    }
    if (!best) return [];
    return [{ metric: "life_evaluation", value: round(best.value, 2), period: best.year, level: "country", source: "oecd-wellbeing", retrieved: ctx.now().toISOString(), url, fetcher: "oecd-wellbeing@1", note: "Average answer to how satisfied people are with their life as a whole, 0 to 10" }];
  },
};
