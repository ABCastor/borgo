// Where a first visit starts: the region of the visitor's country, as the edge reads it from the request (Cloudflare's
// request.cf.country, src/site/worker.ts), and the cities each region starts with. The country is a suggestion for the
// first screen only: it is read for that one answer, never stored or logged, and the visitor can start from any region.
// Browser-, Worker- and Node-safe: no data, no DOM.

export type RegionId = "europe" | "north-america" | "latin-america" | "asia-pacific" | "middle-east-africa";

export interface VisitRegion {
  id: RegionId;
  /** As a sentence names it: "near Canada, in North America". */
  name: string;
  /** Seed cities in the order a first visit prefers them; the shortlist keeps the first five whose money figure is whole. */
  candidates: string[];
}

export const REGIONS: VisitRegion[] = [
  { id: "europe", name: "Europe", candidates: ["lisbon-pt", "barcelona-es", "berlin-de", "london-gb", "madrid-es", "amsterdam-nl", "vienna-at", "paris-fr", "dublin-ie", "stockholm-se", "edinburgh-gb", "valencia-es"] },
  { id: "north-america", name: "North America", candidates: ["new-york-us", "san-francisco-us", "toronto-ca", "boston-us", "austin-us", "seattle-us", "vancouver-ca", "montreal-ca", "chicago-us", "london-gb", "dublin-ie", "berlin-de"] },
  { id: "latin-america", name: "Latin America", candidates: ["madrid-es", "lisbon-pt", "barcelona-es", "miami-us", "toronto-ca", "valencia-es", "malaga-es", "montreal-ca"] },
  { id: "asia-pacific", name: "Asia and Oceania", candidates: ["singapore-sg", "sydney-au", "tokyo-jp", "melbourne-au", "london-gb", "toronto-ca", "vancouver-ca", "berlin-de"] },
  { id: "middle-east-africa", name: "the Middle East and Africa", candidates: ["dubai-ae", "london-gb", "berlin-de", "toronto-ca", "singapore-sg", "madrid-es", "dublin-ie", "paris-fr"] },
];

export const DEFAULT_REGION: RegionId = "europe";

// ISO 3166-1 alpha-2 codes by region; any other country, and an unknown one, starts from Europe.
const OF: Record<Exclude<RegionId, "europe">, string> = {
  "north-america": "US CA PM GL BM",
  "latin-america": "MX GT BZ SV HN NI CR PA CU DO HT JM PR BS BB TT AG DM GD KN LC VC AW CW SX BQ VG VI KY TC AI MS GP MQ BL MF CO VE EC PE BO CL AR UY PY BR GY SR GF FK",
  "asia-pacific": "CN JP KR KP TW HK MO MN SG MY TH VN LA KH MM PH ID BN TL IN PK BD LK NP BT MV AF KZ UZ KG TJ TM AU NZ PG FJ SB VU NC PF WS TO KI TV NR FM MH PW GU MP AS CK NU",
  "middle-east-africa": "AE SA QA KW BH OM YE IQ IR IL PS JO LB SY TR EG LY TN DZ MA EH MR ML SN GM GW GN SL LR CI GH TG BJ NE NG BF TD SD SS ER DJ ET SO KE UG RW BI TZ CD CG CF CM GQ GA ST AO ZM ZW MW MZ MG MU SC KM NA BW ZA LS SZ CV RE YT SH",
};
const REGION_OF = new Map<string, RegionId>(Object.entries(OF).flatMap(([r, codes]) => codes.split(" ").map((c) => [c, r as RegionId] as const)));

/** The region a country code starts from: Europe for any country not listed, and for none. */
export function regionOf(country: string | null | undefined): RegionId {
  return (country && REGION_OF.get(country.toUpperCase())) || DEFAULT_REGION;
}

/** Where the app page prerendered for a region sits in dist/ (scripts/first-page.ts); the Worker serves it as /. */
export const regionPage = (region: RegionId) => (region === DEFAULT_REGION ? "/" : `/r/${region}/`);

export const regionById = (id: string | null | undefined): VisitRegion => REGIONS.find((r) => r.id === id) ?? REGIONS[0]!;

/** A country's English name ("CA" -> "Canada"), or null when the code is not one. */
export function countryName(code: string | null | undefined): string | null {
  if (!code || !/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code && !/^Unknown/.test(name) ? name : null;
  } catch {
    return null;
  }
}

// Country names a sentence gives an article: "near the United States".
const THE = /^(United |Netherlands|Philippines|Bahamas|Gambia|Maldives|Czech Republic|Dominican Republic|Central African Republic|Comoros|Marshall Islands|Solomon Islands|Cayman Islands|Falkland Islands|Turks|British Virgin|U\.S\. )/;

/**
 * The sentence that says why a first visit shows its cities, the same in the page the edge serves and in the app: the
 * country when the request carried one, and whether the list goes beyond the region (`mixed`).
 */
export function fromText(region: RegionId, country: string | null | undefined, where: VisitSpread): string {
  const r = regionById(region).name;
  const name = countryName(country);
  const these = where === "in" ? `are in ${r}` : where === "mixed" ? `start in ${r}, then add a few elsewhere` : `are outside ${r}, where no city in Borgo has every money figure yet`;
  return name ? `This visit comes from ${THE.test(name) ? "the " : ""}${name} (read from the request, never kept), so these cities ${these}.` : `These cities ${these}.`;
}

/** Whether a first visit's cities are all in its region, some, or none. */
export type VisitSpread = "in" | "mixed" | "out";
export const spreadOf = (region: RegionId, countries: string[]): VisitSpread => {
  const n = countries.filter((c) => regionOf(c) === region).length;
  return n === countries.length ? "in" : n ? "mixed" : "out";
};
