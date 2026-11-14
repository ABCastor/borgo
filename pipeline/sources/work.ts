// What people earn in each kind of work and how many jobs each field holds, for the seed cities (src/core/work.ts),
// plus the young companies around each one. Several official sources, each for the places it covers, one file each:
//   bls     US metros: BLS Occupational Employment and Wage Statistics, mean annual wage by occupation group (public domain)
//   ses     EU, EFTA: Eurostat Structure of Earnings Survey 2022, mean annual gross earnings by occupation and industry
//   ons     UK regions: ONS Annual Survey of Hours and Earnings, pay by industry (Open Government Licence)
//   ilo     Japan, Singapore pay by industry; UK, Australia, Japan, Singapore, UAE jobs by industry (ILOSTAT, CC BY 4.0)
//   statcan Canada by province: wages and jobs by industry, Labour Force Survey (Statistics Canada Open Licence)
//   abs     Australia by state: average weekly earnings by industry (ABS, CC BY 4.0)
//   lfs     EU, EFTA regions: jobs by industry, NUTS 2 (Eurostat lfst_r_lfe2en2)
//   qcew    US cities: jobs by industry where people work (BLS Quarterly Census of Employment and Wages, public domain)
//   wikidata young companies within 50 km (Wikidata through QLever, CC0)
// Run: node pipeline/sources/work.ts [part ...]   (no part: all of them)
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJson, getText, readJson, today, writeJson, UA, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";
import { jobsMetric, payMetric, SECTORS, type Sector } from "../../src/core/work.ts";
import type { JsonStat } from "../../src/fetch/eurostat-urban.ts";

const cities = await readJson<City[]>("data/cities.json");
const retrieved = today();
const parts = new Set(process.argv.slice(2));
const want = (p: string) => !parts.size || parts.has(p);
const byId = new Map(cities.map((c) => [c.id, c]));

type Obs = Omit<Observation, "retrieved">;
async function save(file: string, source: string, rows: Record<string, Obs[]>) {
  const out: ObservationFile = { source, retrieved, observations: {} };
  for (const [id, list] of Object.entries(rows)) if (list.length && byId.has(id)) out.observations[id] = list.map((o) => ({ ...o, retrieved }));
  await writeJson(file, out);
  console.log(`${file}: ${Object.keys(out.observations).length} cities, ${Object.values(out.observations).flat().length} figures`);
}
const push = (rows: Record<string, Obs[]>, id: string, o: Obs) => (rows[id] ??= []).push(o);

// ---------- Pay: which occupations or industry each kind reads, per source ----------

/** BLS SOC 2018 occupation group per kind (6 digits, no hyphen), with its name. */
const SOC: Record<string, [string, string]> = {
  software: ["150000", "computer and mathematical occupations"],
  engineering: ["170000", "architecture and engineering occupations"],
  science: ["190000", "life, physical and social science occupations"],
  medicine: ["290000", "healthcare practitioners and technical occupations"],
  nursing: ["291141", "registered nurses"],
  teaching: ["250000", "educational instruction and library occupations"],
  finance: ["130000", "business and financial operations occupations"],
  law: ["230000", "legal occupations"],
  marketing: ["270000", "arts, design, entertainment, sports and media occupations"],
  office: ["430000", "office and administrative support occupations"],
  sales: ["410000", "sales and related occupations"],
  hospitality: ["350000", "food preparation and serving occupations"],
  trades: ["470000", "construction and extraction occupations"],
  transport: ["530000", "transportation and material moving occupations"],
  public: ["000000", "all occupations (the survey gives no public-sector figure for a metro area)"],
  management: ["110000", "management occupations"],
  all: ["000000", "all occupations"],
};

/** Eurostat SES: ISCO-08 major group x NACE section per kind. */
const SES: Record<string, [string, string, string]> = {
  software: ["OC2", "J", "professionals in information and communication"],
  engineering: ["OC2", "B-E", "professionals in industry"],
  science: ["OC2", "M", "professionals in professional, scientific and technical activities"],
  medicine: ["OC2", "Q", "professionals in health and social work"],
  nursing: ["OC3", "Q", "technicians and associate professionals in health and social work"],
  teaching: ["OC2", "P", "professionals in education"],
  finance: ["OC2", "K", "professionals in finance and insurance"],
  law: ["OC2", "M", "professionals in professional, scientific and technical activities"],
  marketing: ["OC2", "M", "professionals in professional, scientific and technical activities"],
  office: ["OC4", "B-S", "clerical support workers, all industries"],
  sales: ["OC5", "G", "service and sales workers in wholesale and retail trade"],
  hospitality: ["OC5", "I", "service and sales workers in accommodation and food"],
  trades: ["OC7", "F", "craft and related trades workers in construction"],
  transport: ["OC8", "H", "plant and machine operators in transport and storage"],
  public: ["TOTAL", "O", "everyone in public administration"],
  management: ["OC1", "B-S", "managers, all industries"],
  all: ["TOTAL", "B-S", "all employees"],
};

/** ISIC Rev. 4 section per kind, for the sources that publish pay by industry only (ILO, StatCan, ABS). */
const ISIC: Record<string, [string, string]> = {
  software: ["J", "information and communication"],
  engineering: ["C", "manufacturing"],
  science: ["M", "professional, scientific and technical activities"],
  medicine: ["Q", "health and social work"],
  nursing: ["Q", "health and social work"],
  teaching: ["P", "education"],
  finance: ["K", "finance and insurance"],
  law: ["M", "professional, scientific and technical activities"],
  marketing: ["M", "professional, scientific and technical activities"],
  office: ["N", "administrative and support services"],
  sales: ["G", "wholesale and retail trade"],
  hospitality: ["I", "accommodation and food"],
  trades: ["F", "construction"],
  transport: ["H", "transport and storage"],
  public: ["O", "public administration"],
  management: ["TOTAL", "all industries (no figure for managers alone)"],
  all: ["TOTAL", "all industries"],
};
const KINDS = Object.keys(SOC);

// ---------- BLS OEWS ----------

/** Our city -> OEWS metropolitan area code and name (MSA, 2023 delineations). */
const MSA: Record<string, [string, string]> = {
  "san-francisco-us": ["41860", "San Francisco-Oakland-Fremont metro"],
  "los-angeles-us": ["31080", "Los Angeles-Long Beach-Anaheim metro"],
  "new-york-us": ["35620", "New York-Newark-Jersey City metro"],
  "boston-us": ["14460", "Boston-Cambridge-Newton metro"],
  "seattle-us": ["42660", "Seattle-Tacoma-Bellevue metro"],
  "austin-us": ["12420", "Austin-Round Rock-San Marcos metro"],
  "miami-us": ["33100", "Miami-Fort Lauderdale-West Palm Beach metro"],
  "chicago-us": ["16980", "Chicago-Naperville-Elgin metro"],
  "denver-us": ["19740", "Denver-Aurora-Centennial metro"],
};

if (want("bls")) {
  // Series OEU M 00<area> 000000 <soc> 04: annual mean wage, all industries. The keyless API takes 25 series a request.
  const series = Object.entries(MSA).flatMap(([id, [area]]) => KINDS.map((k) => ({ id, k, s: `OEUM00${area}000000${SOC[k]![0]}04` })));
  const unique = [...new Set(series.map((x) => x.s))];
  const values = new Map<string, [string, number]>();
  for (let i = 0; i < unique.length; i += 25) {
    const body = { seriesid: unique.slice(i, i + 25), startyear: String(new Date().getUTCFullYear() - 2), endyear: String(new Date().getUTCFullYear()) };
    const r = await getJson<{ status: string; message: string[]; Results?: { series: { seriesID: string; data: { year: string; value: string }[] }[] } }>("https://api.bls.gov/publicAPI/v2/timeseries/data/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS: ${r.status} ${r.message.join("; ")}`);
    for (const s of r.Results!.series) {
      const latest = s.data.filter((d) => Number.isFinite(Number(d.value))).sort((a, b) => b.year.localeCompare(a.year))[0];
      if (latest) values.set(s.seriesID, [latest.year, Number(latest.value)]);
    }
  }
  const rows: Record<string, Obs[]> = {};
  for (const { id, k, s } of series) {
    const v = values.get(s);
    if (!v) continue;
    push(rows, id, { metric: payMetric(k), value: v[1], period: v[0], level: "metro", source: "bls-oews", note: `Mean of ${SOC[k]![1]}, ${MSA[id]![1]}, May ${v[0]}`, url: `https://data.bls.gov/timeseries/${s}` });
  }
  await save("data/observations/work-bls.json", "bls-oews", rows);
}

// ---------- Eurostat SES 2022 ----------

const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
function cell(js: JsonStat, at: Record<string, string>): number | undefined {
  let flat = 0;
  for (let d = 0; d < js.id.length; d++) {
    const dim = js.id[d]!;
    const idx = at[dim] !== undefined ? js.dimension[dim]!.category.index[at[dim]!] : 0;
    if (idx === undefined) return undefined;
    flat = flat * js.size[d]! + idx;
  }
  return js.value[String(flat)];
}
const EU_GEO = (c: City) => (c.country === "GR" ? "EL" : c.country);

if (want("ses")) {
  const geos = [...new Set(cities.map(EU_GEO))];
  const js = await getJson<JsonStat>(`${EUROSTAT}/earn_ses22_49?sex=T&indic_se=ERN&unit=NAC&sizeclas=GE10&${geos.map((g) => `geo=${g}`).join("&")}`);
  const have = js.dimension.geo!.category.index;
  const rows: Record<string, Obs[]> = {};
  for (const c of cities) {
    const g = EU_GEO(c);
    if (have[g] === undefined) continue;
    for (const k of KINDS) {
      const [isco, nace, words] = SES[k]!;
      // Some countries publish all industries only without public administration (B-S_X_O): the nearest total.
      const alt = nace === "B-S" ? "B-S_X_O" : undefined;
      const own = cell(js, { geo: g, isco08: isco, nace_r2: nace, time: "2022" });
      const v = own ?? (alt ? cell(js, { geo: g, isco08: isco, nace_r2: alt, time: "2022" }) : undefined);
      if (v === undefined) continue;
      const less = own === undefined ? " (public administration not counted)" : "";
      push(rows, c.id, { metric: payMetric(k), value: Math.round(v), period: "2022", level: "country", source: "eurostat-ses", note: `Mean for ${words}${less}, ${js.dimension.geo!.category.label[g]}, firms of 10 or more, 2022` });
    }
  }
  await save("data/observations/work-ses.json", "eurostat-ses", rows);
}

// ---------- ILOSTAT ----------

const ILO_AREA: Record<string, string> = { GB: "GBR", JP: "JPN", SG: "SGP", AU: "AUS", AE: "ARE" };
/** ILO's codes for the ISIC sections and the groups the job shares use. */
const SECTOR_ISIC: Record<Sector, string[]> = { j: ["J"], k: ["K"], f: ["F"], be: ["B", "C", "D", "E"], mn: ["M", "N"], oq: ["O", "P", "Q"], gi: ["G", "H", "I"] };

async function iloCsv(id: string, areas: string[]): Promise<{ area: string; cls: string; time: string; v: number; source: string }[]> {
  const url = `https://rplumber.ilo.org/data/indicator/?id=${id}&sex=SEX_T&timefrom=${new Date().getUTCFullYear() - 6}&ref_area=${areas.join("+")}&format=.csv`;
  const [head, ...lines] = (await getText(url)).replace(/^\uFEFF/, "").split("\n").filter(Boolean);
  const cols = head!.split(",").map((x) => x.replace(/"/g, ""));
  const at = (n: string) => cols.indexOf(n);
  return lines.map((l) => {
    const f = l.split(",").map((x) => x.replace(/"/g, ""));
    return { area: f[at("ref_area")]!, cls: f[at("classif1")]!, time: f[at("time")]!, v: Number(f[at("obs_value")]), source: f[at("source")]! };
  });
}
/** Each area's newest year with a total, and that year's rows by class. */
function newest(rows: Awaited<ReturnType<typeof iloCsv>>, total: string) {
  const out = new Map<string, { time: string; by: Map<string, number> }>();
  for (const area of new Set(rows.map((r) => r.area))) {
    const years = rows.filter((r) => r.area === area && r.cls === total).map((r) => r.time).sort().reverse();
    if (!years.length) continue;
    out.set(area, { time: years[0]!, by: new Map(rows.filter((r) => r.area === area && r.time === years[0]).map((r) => [r.cls, r.v])) });
  }
  return out;
}

if (want("ilo")) {
  const rows: Record<string, Obs[]> = {};
  const pay = newest(await iloCsv("EAR_EMTA_SEX_ECO_NB_A", ["JPN", "SGP"]), "ECO_ISIC4_TOTAL");
  const emp = newest(await iloCsv("EMP_TEMP_SEX_ECO_NB_A", Object.values(ILO_AREA)), "ECO_ISIC4_TOTAL");
  for (const c of cities) {
    const area = ILO_AREA[c.country];
    if (!area) continue;
    const p = pay.get(area);
    if (p)
      for (const k of KINDS) {
        const [sec, words] = ISIC[k]!;
        const v = p.by.get(`ECO_ISIC4_${sec}`);
        if (v === undefined || !Number.isFinite(v)) continue;
        push(rows, c.id, { metric: payMetric(k), value: Math.round(v * 12), period: p.time, level: "country", source: "ilostat", note: `Average monthly earnings of employees in ${words} times 12, as the national statistics office reports them to the ILO${c.country === "JP" ? " (monthly scheduled earnings, so bonuses are left out)" : ""}` });
      }
    const e = emp.get(area);
    if (e) {
      const total = e.by.get("ECO_ISIC4_TOTAL")!;
      for (const s of Object.keys(SECTOR_ISIC) as Sector[]) {
        const n = SECTOR_ISIC[s].map((x) => e.by.get(`ECO_ISIC4_${x}`));
        if (n.some((x) => x === undefined || !Number.isFinite(x))) continue;
        push(rows, c.id, { metric: jobsMetric(s), value: Math.round((1000 * n.reduce((a, b) => a! + b!, 0)!) / total), period: e.time, level: "country", source: "ilostat", note: `Employment in ${SECTORS[s].label}, whole country, labour force survey` });
      }
    }
  }
  await save("data/observations/work-ilo.json", "ilostat", rows);
}

// ---------- ONS ASHE (UK regions) ----------

/** Our city id -> ASHE region, as the table labels it. */
const UK_REGION: Record<string, [string, string]> = {
  "london-gb": ["LONDON", "London"], "cambridge-gb": ["EAST", "East of England"], "manchester-gb": ["NORTH WEST", "North West England"],
  "bristol-gb": ["SOUTH WEST", "South West England"], "edinburgh-gb": ["SCOTLAND", "Scotland"],
};
/** SIC 2007 code per kind (a two-digit division, or a section letter), with its name. */
const SIC: Record<string, [string, string]> = {
  software: ["62", "computer programming and consultancy"], engineering: ["71", "architecture and engineering"], science: ["72", "scientific research and development"],
  medicine: ["86", "human health"], nursing: ["86", "human health"], teaching: ["P", "education"], finance: ["64", "financial services"], law: ["69", "legal and accounting"],
  marketing: ["73", "advertising and market research"], office: ["N", "administrative and support services"], sales: ["47", "retail"],
  hospitality: ["56", "food and drink service"], trades: ["F", "construction"], transport: ["49", "land transport"], public: ["O", "public administration"],
  management: ["ALL", "all industries (no figure for managers alone)"], all: ["ALL", "all industries"],
};

if (want("ons")) {
  // ASHE table 5 (region by two-digit SIC), sheet "Full-Time" of table 5.7a, annual gross pay: the newest edition listed.
  const page = await getText("https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/regionbyindustry2digitsicashetable5");
  const href = page.match(/href="(\/file\?uri=[^"]+ashetable5(\d{4})(provisional|revised)?\.zip)"/);
  if (!href) throw new Error("ONS: no ASHE table 5 download on the dataset page");
  const res = await fetch(`https://www.ons.gov.uk${href[1]}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ONS ASHE: ${res.status}`);
  const dir = await mkdtemp(join(tmpdir(), "borgo-ashe-"));
  const zip = join(dir, "t5.zip");
  await writeFile(zip, new Uint8Array(await res.arrayBuffer()));
  const entry = execFileSync("unzip", ["-Z1", zip]).toString().split("\n").find((n) => /Table 5\.7a .*Annual pay - Gross/.test(n) && !/CV/.test(n))!;
  execFileSync("unzip", ["-o", "-q", zip, entry, "-d", dir]);
  const { readSheet, sheetNames } = await import("../xlsx.ts");
  const file = join(dir, entry);
  const rows = readSheet(file, sheetNames(file).indexOf("Full-Time") + 1);
  await rm(dir, { recursive: true });
  const year = href[2]!;
  const out: Record<string, Obs[]> = {};
  for (const [id, [region, name]] of Object.entries(UK_REGION)) {
    for (const k of KINDS) {
      const [code, words] = SIC[k]!;
      const row = code === "ALL"
        ? rows.find((r) => String(r[0]).toUpperCase().trim() === `${region} ALL INDUSTRIES AND SERVICES`)
        : rows.find((r) => String(r[0]).toUpperCase().startsWith(`${region}, `) && String(r[1]) === `'${code}`);
      const mean = row ? Number(row[5]) : NaN;
      if (!Number.isFinite(mean) || mean <= 0) continue;
      push(out, id, { metric: payMetric(k), value: Math.round(mean), period: year, level: "region", source: "ons-ashe", note: `Mean annual gross pay of full-time employees in ${words}, ${name}, April ${year}${href[3] === "provisional" ? " (provisional)" : ""}, ASHE table 5.7a` });
    }
  }
  await save("data/observations/work-ons.json", "ons-ashe", out);
}

// ---------- Eurostat regional jobs by industry ----------

/** Our city id -> NUTS 2 region, as pipeline/sources/eurostat-regions.ts. The UK left the survey after 2019. */
const NUTS2: Record<string, string> = {
  "turin-it": "ITC1", "milan-it": "ITC4", "rome-it": "ITI4", "naples-it": "ITF3", "bologna-it": "ITH5", "florence-it": "ITI1",
  "dublin-ie": "IE06", "cork-ie": "IE05", "paris-fr": "FR10", "lyon-fr": "FRK2",
  "berlin-de": "DE30", "munich-de": "DE21", "hamburg-de": "DE60", "amsterdam-nl": "NL32", "rotterdam-nl": "NL36", "brussels-be": "BE10",
  "copenhagen-dk": "DK01", "stockholm-se": "SE11", "oslo-no": "NO08", "helsinki-fi": "FI1B", "zurich-ch": "CH04", "geneva-ch": "CH01",
  "vienna-at": "AT13", "prague-cz": "CZ01", "warsaw-pl": "PL91", "krakow-pl": "PL21", "budapest-hu": "HU11", "lisbon-pt": "PT1A",
  "porto-pt": "PT11", "madrid-es": "ES30", "barcelona-es": "ES51", "valencia-es": "ES52", "malaga-es": "ES61", "athens-gr": "EL30", "tallinn-ee": "EE00",
};
const CITY_REGIONS = new Set(["DE30", "DE60", "AT13", "CZ01", "HU11", "BE10"]);
const LFS_SECTOR: Record<Sector, string> = { j: "J", k: "K", f: "F", be: "B-E", mn: "M_N", oq: "O-Q", gi: "G-I" };

if (want("lfs")) {
  const geo = [...new Set(Object.values(NUTS2))];
  const js = await getJson<JsonStat>(`${EUROSTAT}/lfst_r_lfe2en2?age=Y15-74&sex=T&unit=THS_PER&${geo.map((g) => `geo=${g}`).join("&")}`);
  const times = Object.keys(js.dimension.time!.category.index).sort().reverse();
  const rows: Record<string, Obs[]> = {};
  for (const [id, g] of Object.entries(NUTS2)) {
    const year = times.find((t) => cell(js, { geo: g, nace_r2: "TOTAL", time: t }) !== undefined);
    if (!year) continue;
    const total = cell(js, { geo: g, nace_r2: "TOTAL", time: year })!;
    const label = js.dimension.geo!.category.label[g]!;
    for (const s of Object.keys(LFS_SECTOR) as Sector[]) {
      const v = cell(js, { geo: g, nace_r2: LFS_SECTOR[s], time: year });
      if (v === undefined) continue;
      push(rows, id, { metric: jobsMetric(s), value: Math.round((1000 * v) / total), period: year, level: CITY_REGIONS.has(g) ? "city" : g === "EE00" ? "country" : "region", source: "eurostat-lfs-industry", note: `People in work in ${SECTORS[s].label}, ${label} (${g}), by where they live` });
    }
  }
  await save("data/observations/work-lfs.json", "eurostat-lfs-industry", rows);
}

// ---------- QCEW jobs by industry (US cities) ----------

/** Our city id -> the county or counties it lies in (FIPS), and their names. */
const COUNTIES: Record<string, [string[], string]> = {
  "san-francisco-us": [["06075"], "San Francisco County"],
  "los-angeles-us": [["06037"], "Los Angeles County"],
  "new-york-us": [["36005", "36047", "36061", "36081", "36085"], "the five boroughs"],
  "boston-us": [["25025"], "Suffolk County"],
  "seattle-us": [["53033"], "King County"],
  "austin-us": [["48453"], "Travis County"],
  "miami-us": [["12086"], "Miami-Dade County"],
  "chicago-us": [["17031"], "Cook County"],
  "denver-us": [["08031"], "Denver County"],
};
/**
 * NAICS 2022 codes per jobs field, matched to the European industry sections: information and communication is NAICS
 * 51 plus computer systems design (5415), which Europe counts as computer programming in section J; professional
 * services leave 5415 out. Sector codes are read at QCEW aggregation level 74, 5415 at level 76.
 */
const QCEW_SECTOR: Record<Sector, { add: string[]; less?: string[] }> = {
  j: { add: ["51", "5415"] },
  k: { add: ["52"] },
  f: { add: ["23"] },
  be: { add: ["21", "22", "31-33"] },
  mn: { add: ["54", "55", "56"], less: ["5415"] },
  oq: { add: ["92", "61", "62"] },
  gi: { add: ["42", "44-45", "48-49", "72"] },
};

if (want("qcew")) {
  let year = new Date().getUTCFullYear() - 1;
  const read = async (fips: string) => {
    for (let y = year; ; y--) {
      try {
        const csv = await getText(`https://data.bls.gov/cew/data/api/${y}/a/area/${fips}.csv`);
        year = y;
        return csv;
      } catch (e) {
        if (y < new Date().getUTCFullYear() - 3) throw e;
      }
    }
  };
  const rows: Record<string, Obs[]> = {};
  for (const [id, [fips, name]] of Object.entries(COUNTIES)) {
    /** Jobs by industry code over every ownership (private, local, state, federal), summed over the counties. */
    const jobs = new Map<string, number>();
    let total = 0;
    for (const f of fips) {
      const [head, ...lines] = (await read(f)).split("\n").filter(Boolean);
      const cols = head!.split(",").map((x) => x.replace(/"/g, ""));
      const at = (n: string) => cols.indexOf(n);
      for (const l of lines) {
        const x = l.split(",").map((v) => v.replace(/"/g, ""));
        const own = x[at("own_code")]!, ind = x[at("industry_code")]!, lvl = x[at("agglvl_code")]!;
        const n = Number(x[at("annual_avg_emplvl")]);
        if (own === "0" && ind === "10" && lvl === "70") total += n;
        else if (own !== "0" && (lvl === "74" || (lvl === "76" && ind === "5415"))) jobs.set(ind, (jobs.get(ind) ?? 0) + n);
      }
    }
    for (const s of Object.keys(QCEW_SECTOR) as Sector[]) {
      const { add, less = [] } = QCEW_SECTOR[s];
      const n = add.reduce((t, c) => t + (jobs.get(c) ?? 0), 0) - less.reduce((t, c) => t + (jobs.get(c) ?? 0), 0);
      push(rows, id, { metric: jobsMetric(s), value: Math.round((1000 * n) / total), period: String(year), level: "city", source: "bls-qcew", note: `Jobs located in ${name}, NAICS ${add.join(" + ")}${less.length ? ` less ${less.join(", ")}` : ""}` });
    }
  }
  await save("data/observations/work-qcew.json", "bls-qcew", rows);
}

// ---------- Statistics Canada ----------

const PROVINCE: Record<string, string> = { "toronto-ca": "Ontario", "vancouver-ca": "British Columbia", "montreal-ca": "Quebec" };

/** A StatCan table's CSV rows (the full-table download, unzipped in memory). */
async function statcan(table: string): Promise<Record<string, string>[]> {
  const res = await fetch(`https://www150.statcan.gc.ca/n1/tbl/csv/${table}-eng.zip`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`StatCan ${table}: ${res.status}`);
  const dir = await mkdtemp(join(tmpdir(), "borgo-statcan-"));
  const zip = join(dir, `${table}.zip`);
  await writeFile(zip, new Uint8Array(await res.arrayBuffer()));
  const csv = execFileSync("unzip", ["-p", zip, `${table}.csv`], { maxBuffer: 1 << 30 }).toString();
  await rm(dir, { recursive: true });
  const [head, ...lines] = csv.replace(/^\uFEFF/, "").split("\n").filter(Boolean);
  const parse = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  const cols = parse(head!);
  return lines.map((l) => {
    const f = parse(l);
    return Object.fromEntries(cols.map((c, i) => [c, f[i] ?? ""]));
  });
}
/** NAICS groups as the Labour Force Survey publishes them, per kind and per jobs field. */
const NAICS_PAY: Record<string, [string, string]> = {
  software: ["Information, culture and recreation [51, 71]", "information, culture and recreation"],
  engineering: ["Manufacturing [31-33]", "manufacturing"],
  science: ["Professional, scientific and technical services [54]", "professional, scientific and technical services"],
  medicine: ["Health care and social assistance [62]", "health care and social assistance"],
  nursing: ["Health care and social assistance [62]", "health care and social assistance"],
  teaching: ["Educational services [61]", "educational services"],
  finance: ["Finance, insurance, real estate, rental and leasing [52-53]", "finance, insurance and real estate"],
  law: ["Professional, scientific and technical services [54]", "professional, scientific and technical services"],
  marketing: ["Professional, scientific and technical services [54]", "professional, scientific and technical services"],
  office: ["Business, building and other support services [55-56]", "business, building and other support services"],
  sales: ["Wholesale and retail trade [41, 44-45]", "wholesale and retail trade"],
  hospitality: ["Accommodation and food services [72]", "accommodation and food services"],
  trades: ["Construction [23]", "construction"],
  transport: ["Transportation and warehousing [48-49]", "transportation and warehousing"],
  public: ["Public administration [91]", "public administration"],
  management: ["Total employees, all industries", "all industries (no figure for managers alone)"],
  all: ["Total employees, all industries", "all industries"],
};
const NAICS_JOBS: Record<Sector, string[]> = {
  j: ["Information, culture and recreation [51, 71]"],
  k: ["Finance, insurance, real estate, rental and leasing [52-53]"],
  f: ["Construction [23]"],
  be: ["Manufacturing [31-33]", "Utilities [22]", "Forestry, fishing, mining, quarrying, oil and gas [21, 113-114, 1153, 2100]"],
  mn: ["Professional, scientific and technical services [54]", "Business, building and other support services [55-56]"],
  oq: ["Public administration [91]", "Educational services [61]", "Health care and social assistance [62]"],
  gi: ["Wholesale and retail trade [41, 44-45]", "Transportation and warehousing [48-49]", "Accommodation and food services [72]"],
};

if (want("statcan")) {
  const rows: Record<string, Obs[]> = {};
  // 14-10-0064: employee wages by industry, annual; average weekly wages of full-time employees, current dollars.
  const wages = (await statcan("14100064")).filter((r) => r["Wages"] === "Average weekly wage rate" && r["Type of work"] === "Full-time employees" && r["Gender"] === "Total - Gender" && r["Age group"] === "15 years and over");
  const wYear = wages.map((r) => r["REF_DATE"]!).sort().at(-1)!;
  // 14-10-0023: labour force characteristics by industry, annual; employment, thousands.
  const jobs = (await statcan("14100023")).filter((r) => r["Labour force characteristics"] === "Employment" && r["Gender"] === "Total - Gender" && r["Age group"] === "15 years and over");
  const jYear = jobs.map((r) => r["REF_DATE"]!).sort().at(-1)!;
  for (const [id, prov] of Object.entries(PROVINCE)) {
    for (const k of KINDS) {
      const [naics, words] = NAICS_PAY[k]!;
      const r = wages.find((x) => x["GEO"] === prov && x["REF_DATE"] === wYear && x["North American Industry Classification System (NAICS)"] === naics);
      const v = r ? Number(r["VALUE"]) : NaN;
      if (!Number.isFinite(v) || v <= 0) continue;
      push(rows, id, { metric: payMetric(k), value: Math.round(v * 52), period: wYear, level: "region", source: "statcan-lfs", note: `Average weekly wage of full-time employees in ${words} times 52, ${prov}` });
    }
    const at = (n: string) => Number(jobs.find((x) => x["GEO"] === prov && x["REF_DATE"] === jYear && x["North American Industry Classification System (NAICS)"] === n)?.["VALUE"]);
    const total = at("Total, all industries");
    for (const s of Object.keys(NAICS_JOBS) as Sector[]) {
      const n = NAICS_JOBS[s].map(at);
      if (!Number.isFinite(total) || n.some((x) => !Number.isFinite(x))) continue;
      push(rows, id, { metric: jobsMetric(s), value: Math.round((1000 * n.reduce((a, b) => a + b, 0)) / total), period: jYear, level: "region", source: "statcan-lfs", note: `Employment in ${SECTORS[s].label}, ${prov}, Labour Force Survey` });
    }
  }
  await save("data/observations/work-statcan.json", "statcan-lfs", rows);
}

// ---------- ABS average weekly earnings (Australia) ----------

const STATE: Record<string, [string, string]> = { "sydney-au": ["1", "New South Wales"], "melbourne-au": ["2", "Victoria"] };
/** ANZSIC 2006 division per kind (ANZSIC letters are not ISIC's). */
const ANZSIC: Record<string, [string, string]> = {
  software: ["J", "information media and telecommunications"], engineering: ["C", "manufacturing"], science: ["M", "professional, scientific and technical services"],
  medicine: ["Q", "health care and social assistance"], nursing: ["Q", "health care and social assistance"], teaching: ["P", "education and training"],
  finance: ["K", "financial and insurance services"], law: ["M", "professional, scientific and technical services"], marketing: ["M", "professional, scientific and technical services"],
  office: ["N", "administrative and support services"], sales: ["G", "retail trade"], hospitality: ["H", "accommodation and food services"],
  trades: ["E", "construction"], transport: ["I", "transport, postal and warehousing"], public: ["O", "public administration and safety"],
  management: ["TOT", "all industries (no figure for managers alone)"], all: ["TOT", "all industries"],
};

if (want("abs")) {
  // MEASURE 2: full-time adult average weekly total earnings; ESTIMATE 1 earnings; SEX 3 persons; SECTOR 7 private and public; TSEST 10 original.
  const csv = await getText(`https://data.api.abs.gov.au/rest/data/ABS,AWE,1.0.0/2.1.3.7..10..S?startPeriod=${new Date().getUTCFullYear() - 2}`, { headers: { Accept: "application/vnd.sdmx.data+csv" } });
  const [head, ...lines] = csv.split("\n").filter(Boolean);
  const cols = head!.split(",");
  const recs = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i]!, v])));
  const rows: Record<string, Obs[]> = {};
  // The survey gives each state's figure for all industries, and industries for the whole country only.
  const latest = (region: string, div: string) =>
    recs.filter((x) => x["REGION"] === region && x["INDUSTRY"] === div && x["OBS_VALUE"] !== "" && Number.isFinite(Number(x["OBS_VALUE"]))).sort((a, b) => b["TIME_PERIOD"]!.localeCompare(a["TIME_PERIOD"]!))[0];
  const when = (t: string) => t.replace(/^(\d{4})-S1$/, "May $1").replace(/^(\d{4})-S2$/, "November $1");
  const year = (t: string) => t.slice(0, 4);
  for (const [id, [code, name]] of Object.entries(STATE)) {
    for (const k of KINDS) {
      const [div, words] = ANZSIC[k]!;
      const state = div === "TOT" ? latest(code, div) : undefined;
      const r = state ?? latest("AUS", div);
      if (!r) continue;
      push(rows, id, { metric: payMetric(k), value: Math.round(Number(r["OBS_VALUE"]) * 52), period: year(r["TIME_PERIOD"]!), level: state ? "region" : "country", source: "abs-awe", note: `Full-time adult average weekly total earnings in ${words} times 52, ${state ? name : "Australia"}, ${when(r["TIME_PERIOD"]!)}` });
    }
  }
  await save("data/observations/work-abs.json", "abs-awe", rows);
}

// ---------- Young companies (Wikidata) ----------

if (want("wikidata")) {
  const values = cities.map((c) => `("${c.id}" "POINT(${c.lon} ${c.lat})"^^<http://www.opengis.net/ont/geosparql#wktLiteral>)`).join("\n");
  const query = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?city (COUNT(DISTINCT ?co) AS ?n) WHERE {
  VALUES (?city ?pt) { ${values} }
  ?co wdt:P31/wdt:P279* wd:Q4830453 .
  ?co wdt:P571 ?inc . FILTER(YEAR(?inc) >= 2010)
  ?co wikibase:sitelinks ?sl . FILTER(?sl >= 2)
  ?co wdt:P159 ?hq . ?hq wdt:P625 ?loc .
  FILTER(geof:distance(?loc, ?pt) < 50)
} GROUP BY ?city`;
  const csv = await getText("https://qlever.dev/api/wikidata", { method: "POST", headers: { Accept: "text/csv", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ query }).toString() });
  const got = new Map(csv.split("\n").slice(1).filter(Boolean).map((l) => l.split(",")).map(([id, n]) => [id!, Number(n)]));
  const rows: Record<string, Obs[]> = {};
  // A city with none found has 0: the query covers every seed city.
  for (const c of cities) push(rows, c.id, { metric: "young_companies", value: got.get(c.id) ?? 0, period: retrieved.slice(0, 4), level: "metro", source: "wikidata", note: "Businesses founded 2010 or later, headquarters within 50 km, with at least two Wikimedia sitelinks" });
  await save("data/observations/work-wikidata.json", "wikidata", rows);
}
