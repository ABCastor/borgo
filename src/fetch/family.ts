// What a family's money depends on beyond pay: childcare after public support (OECD tax-benefit model), public
// holidays (Nager.Date), and the paid holiday the law guarantees (hand-encoded from the labour codes cited below).
// Country figures standing in for the city, marked level "country", except holidays, which count the city's region too.
import type { Iso2, Observation } from "../core/types.ts";
import { round, type Fetcher } from "./context.ts";

/** Countries the OECD tax-benefit models cover, ISO alpha-2 to alpha-3. */
export const OECD_TAXBEN: Record<Iso2, string> = {
  AU: "AUS", AT: "AUT", BE: "BEL", BG: "BGR", CA: "CAN", CH: "CHE", CL: "CHL", CY: "CYP", CZ: "CZE", DE: "DEU", DK: "DNK", ES: "ESP", EE: "EST",
  FI: "FIN", FR: "FRA", GB: "GBR", GR: "GRC", HR: "HRV", HU: "HUN", IE: "IRL", IS: "ISL", IL: "ISR", IT: "ITA", JP: "JPN", KR: "KOR", LT: "LTU",
  LU: "LUX", LV: "LVA", MT: "MLT", NL: "NLD", NO: "NOR", NZ: "NZL", PL: "POL", PT: "PRT", RO: "ROU", SK: "SVK", SI: "SVN", SE: "SWE", US: "USA",
};

export function csvLine(line: string): string[] {
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

/**
 * OECD net childcare cost, national currency a year, children aged 2 and 3 in full-time care: a couple on 100% and
 * 67% of the average wage, or a single parent on the average wage, neither on social assistance or housing benefit.
 * `_T` is the net cost, `CF` the fees before support.
 */
export const oecdChildcare: Fetcher = {
  source: "oecd-childcare",
  version: 1,
  // Node only: the OECD answers a browser's own request without the CORS header, so a browser skips it with that
  // reason and the CLI or MCP server fetches it.
  runtimes: ["node"],
  covers: (c) => c.country in OECD_TAXBEN,
  async fetch(city, ctx) {
    const url = nccUrl(OECD_TAXBEN[city.country]!, ctx.now().getUTCFullYear() - 4);
    return nccObservations(await ctx.text(url), OECD_TAXBEN[city.country]!, { retrieved: ctx.now().toISOString(), url });
  },
};

/** The query for one country (alpha-3), or for every country when `iso3` is empty. */
export function nccUrl(iso3: string, from: number): string {
  return `https://sdmx.oecd.org/public/rest/data/OECD.ELS.JAI,DSD_TAXBEN_NCC@DF_NCC,1.1/${iso3}.NCF.XDC.AW100.C_C1+C_C2+S_C1+S_C2.Y2_3.AW67+_Z.YES.NO.NO._T+CF.A?format=csvfilewithlabels&startPeriod=${from}`;
}

/** One country's figures from the OECD's CSV: the latest year with a value, per household type and cost part. */
export function nccObservations(csv: string, iso3: string, o: { retrieved: string; url: string }): Observation[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = csvLine(lines[0] ?? "");
  const col = (n: string) => head.indexOf(n);
  const best = new Map<string, { year: string; value: number }>();
  for (const l of lines.slice(1)) {
    const f = csvLine(l);
    if (f[col("REF_AREA")] !== iso3) continue;
    // The query asks for exactly this; a saved copy of the whole table holds every variant.
    const want: [string, string][] = [["UNIT_MEASURE", "XDC"], ["INCOME_CURR", "AW100"], ["SOC_ASS_BENEFIT", "NO"], ["HOUSE_BENEFIT", "NO"], ["AGE_CHILDREN", "Y2_3"]];
    if (want.some(([c, v]) => col(c) >= 0 && f[col(c)] !== v)) continue;
    const hh = f[col("HOUSEHOLD_TYPE")]!;
    const part = f[col("INCOME_PART")]!;
    // Couples: the second earner on 67% of the average wage; single parents: no second earner.
    if (hh.startsWith("C_") !== (part === "AW67")) continue;
    if (!hh.startsWith("C_") && part !== "_Z") continue;
    const raw = f[col("OBS_VALUE")];
    const v = Number(raw);
    if (raw === undefined || raw === "" || !Number.isFinite(v)) continue;
    const k = `${hh}|${f[col("CHILDCARE_COST")]}`;
    const y = f[col("TIME_PERIOD")]!;
    if (!best.has(k) || y > best.get(k)!.year) best.set(k, { year: y, value: v });
  }
  const base = { level: "country" as const, source: "oecd-childcare", retrieved: o.retrieved, url: o.url, fetcher: "oecd-childcare@1" };
  const out: Observation[] = [];
  const put = (metric: string, key: string, note: string) => {
    const b = best.get(key);
    if (b) out.push({ metric, value: round(Math.max(0, b.value), 0), period: b.year, note, ...base });
  };
  put("childcare_fees_1", "C_C1|CF", "Fees for one child aged 2 or 3 in full-time care, before support (OECD tax-benefit model)");
  put("childcare_fees_2", "C_C2|CF", "Fees for two children aged 2 and 3 in full-time care, before support (OECD tax-benefit model)");
  put("childcare_net_couple_1", "C_C1|_T", "Net cost after childcare benefits, tax breaks and other benefit changes: couple on 100% and 67% of the average wage");
  put("childcare_net_couple_2", "C_C2|_T", "Net cost after childcare benefits, tax breaks and other benefit changes: couple on 100% and 67% of the average wage");
  put("childcare_net_single_1", "S_C1|_T", "Net cost after childcare benefits, tax breaks and other benefit changes: single parent on the average wage");
  put("childcare_net_single_2", "S_C2|_T", "Net cost after childcare benefits, tax breaks and other benefit changes: single parent on the average wage");
  return out;
}

type NagerHoliday = { date: string; global: boolean; counties: string[] | null; types: string[] };

/** Public holidays that fall on a weekday this year, nationwide or in the city's region (Nager.Date, MIT). */
export const nagerHolidays: Fetcher = {
  source: "nager-date",
  version: 1,
  runtimes: ["browser", "node"],
  async fetch(city, ctx) {
    const year = ctx.now().getUTCFullYear();
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${city.country}`;
    // A country Nager.Date does not cover answers with an empty body.
    const body = (await ctx.text(url)).trim();
    const list = body ? (JSON.parse(body) as NagerHoliday[]) : [];
    if (!Array.isArray(list) || !list.length) return [];
    const days = new Set<string>();
    for (const h of list) {
      if (!h.types.includes("Public")) continue;
      if (!h.global && !(city.region && h.counties?.includes(city.region))) continue;
      const wd = new Date(`${h.date}T12:00:00Z`).getUTCDay();
      if (wd >= 1 && wd <= 5) days.add(h.date);
    }
    return [{
      metric: "public_holidays",
      value: days.size,
      period: String(year),
      level: city.region && list.some((h) => !h.global && h.counties?.includes(city.region!)) ? "region" : "country",
      source: "nager-date",
      retrieved: ctx.now().toISOString(),
      url,
      fetcher: "nager-date@1",
      note: `Public holidays on Monday to Friday in ${year}${city.region ? `, nationwide and in ${city.region}` : ", nationwide"}`,
    }];
  },
};

/**
 * The legal minimum of paid holiday for a full-time employee on a five-day week, working days a year, from each
 * country's labour law. Where the law counts in other units the conversion is in the note. Age rules (Hungary,
 * Norway) are applied in the money model from the person's age.
 */
export const STATUTORY_LEAVE: Record<Iso2, { days: number; note: string; source: { label: string; url: string } }> = {
  AE: { days: 30 * 5 / 7, note: "30 calendar days after a year of service, represented as 30 × 5/7 five-day-week equivalent days, not an exact workday entitlement; public holidays within leave count towards it", source: { label: "UAE government: types of leave, Labour Law art. 29", url: "https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/Types-of-leaves" } },
  AT: { days: 25, note: "5 weeks (30 working days on a six-day count); 6 weeks after 25 years of service", source: { label: "Urlaubsgesetz § 2", url: "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10008376" } },
  AU: { days: 20, note: "4 weeks", source: { label: "Fair Work Ombudsman: annual leave", url: "https://www.fairwork.gov.au/leave/annual-leave" } },
  BE: { days: 20, note: "4 weeks after a full year of work in the previous year", source: { label: "ONVA, the national annual holiday office", url: "https://www.onva.fgov.be/fr/ouvriers/duree-de-vacances/calcul-des-jours-de-vacances" } },
  CA: { days: 10, note: "Federal baseline: 2 weeks after 1 year, 3 after 5 years and 4 after 10; provincial rules and service entitlements differ", source: { label: "Employment and Social Development Canada: Labour Bulletin, March 2026", url: "https://www.canada.ca/en/employment-social-development/corporate/portfolio/labour/bulletin/march-2026.html" } },
  CH: { days: 20, note: "4 weeks; 5 weeks under 20", source: { label: "ch.ch: vacation entitlement, Code of Obligations art. 329a", url: "https://www.ch.ch/en/work/working-hours/vacation--public-holidays-and-absences-from-work/" } },
  CZ: { days: 20, note: "4 weeks", source: { label: "EURES: Czechia working conditions, Labour Code § 213", url: "https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-czechia_en" } },
  DE: { days: 20, note: "24 working days on a six-day count", source: { label: "Bundesurlaubsgesetz § 3", url: "https://www.gesetze-im-internet.de/burlg/__3.html" } },
  DK: { days: 25, note: "2.08 days for each month worked: 5 weeks", source: { label: "Ferieloven", url: "https://www.retsinformation.dk/eli/lta/2018/60" } },
  EE: { days: 20, note: "28 calendar days", source: { label: "Estonian Labour Inspectorate: types of holidays, Employment Contracts Act § 55", url: "https://www.tooelu.ee/en/26/types-holidays" } },
  ES: { days: 30 * 5 / 7, note: "30 calendar days, represented as 30 × 5/7 five-day-week equivalent days, not an exact workday entitlement", source: { label: "Estatuto de los Trabajadores, art. 38", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430" } },
  FI: { days: 20, note: "2 days per full accrual month before one year of employment (24 on a six-day count); 2.5 thereafter (30 on a six-day count, equivalent to 25 on a five-day week)", source: { label: "Vuosilomalaki 162/2005", url: "https://www.finlex.fi/fi/laki/ajantasa/2005/20050162" } },
  FR: { days: 25, note: "5 weeks (30 working days on a six-day count)", source: { label: "Service-Public: congés payés", url: "https://www.service-public.gouv.fr/particuliers/vosdroits/F2258" } },
  GB: { days: 28, note: "5.6 weeks (28 days) a year; bank holidays may be included and are not an additional guaranteed paid entitlement", source: { label: "GOV.UK: holiday entitlement", url: "https://www.gov.uk/holiday-entitlement-rights" } },
  GR: { days: 20, note: "20 days in the first year on a five-day week, rising with service to 25", source: { label: "EURES: Greece working conditions, statutory annual leave", url: "https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-greece_en" } },
  HU: { days: 20, note: "20 working days, plus days by age from 25", source: { label: "National Legislation Database: Labour Code (Mt.) §§ 116-117", url: "https://njt.hu/jogszabaly/2012-1-00-00" } },
  IE: { days: 20, note: "4 working weeks", source: { label: "Organisation of Working Time Act 1997, s. 19", url: "https://www.irishstatutebook.ie/eli/1997/act/20/section/19/enacted/en/html" } },
  IT: { days: 20, note: "4 weeks", source: { label: "D.Lgs. 66/2003, art. 10", url: "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2003-04-08;66" } },
  JP: { days: 10, note: "10 days after 6 months of service, rising to 20 after 6½ years", source: { label: "MHLW: Understanding and Utilizing Labor Laws, annual leave under art. 39", url: "https://www.mhlw.go.jp/content/001762303.pdf" } },
  NL: { days: 20, note: "4 times the weekly working hours", source: { label: "EURES: Netherlands working conditions, statutory annual leave", url: "https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-netherlands_en" } },
  NO: { days: 21, note: "25 working days on a six-day count (4 weeks and 1 day); an extra week from 60", source: { label: "Ferieloven § 5", url: "https://lovdata.no/dokument/NL/lov/1988-04-29-21" } },
  PL: { days: 20, note: "20 days, 26 after 10 years of work, which counts up to 8 years of education", source: { label: "Ministry of Family, Labour and Social Policy: duration of annual leave", url: "https://www.gov.pl/web/family/the-duration-of-annual-leave" } },
  PT: { days: 22, note: "22 working days", source: { label: "Código do Trabalho, art. 238", url: "https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2009-34546475" } },
  SE: { days: 25, note: "25 days", source: { label: "Semesterlag (1977:480) § 4", url: "https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/semesterlag-1977480_sfs-1977-480/" } },
  SG: { days: 7, note: "7 days in the first year, one more each year to 14", source: { label: "MOM: annual leave entitlement", url: "https://www.mom.gov.sg/employment-practices/leave/annual-leave/eligibility-and-entitlement" } },
  US: { days: 0, note: "No general federal paid vacation requirement under the FLSA; government contracts and state or local paid-leave laws can impose additional obligations", source: { label: "US Department of Labor: vacation leave", url: "https://www.dol.gov/general/topic/workhours/vacation_leave" } },
};

/** The statutory minimum from the table above: no network, so it runs anywhere. */
export const labourLaw: Fetcher = {
  source: "labour-law",
  version: 1,
  runtimes: ["browser", "node"],
  covers: (c) => c.country in STATUTORY_LEAVE,
  async fetch(city, ctx) {
    const l = STATUTORY_LEAVE[city.country]!;
    return [{ metric: "annual_leave", value: l.days, period: "2026", level: "country", source: "labour-law", retrieved: ctx.now().toISOString(), url: l.source.url, fetcher: "labour-law@1", note: `${l.note} (${l.source.label})` }];
  },
};
