import type { Units } from "./units.ts";

// The shared vocabulary. Everything the engine, the pipeline and the interface exchange is defined here.

export type Iso2 = string;

/** How precisely an observation describes the city it is attached to. */
export type Level = "city" | "metro" | "region" | "country";

export interface City {
  id: string; // kebab-case slug plus country, e.g. "turin-it"
  name: string;
  country: Iso2;
  region?: string; // first-level subdivision, ISO 3166-2 code where useful (e.g. "IT-21", "US-CA", "GB-SCT")
  wikidata?: string;
  geonames?: string;
  lat: number;
  lon: number;
  /** Metres above sea level, when known: lets a weather station be matched to a city at a similar height. */
  elevation?: number;
  population?: number;
  aliases?: string[];
  /** IANA time zone, e.g. "Europe/Rome". */
  tz?: string;
}

export interface Country {
  code: Iso2;
  name: string;
  currency: string; // ISO 4217
  /** Free-movement areas this country belongs to, e.g. "EU", "EEA", "CTA". See data/rights.json. */
  areas: string[];
}

export interface Source {
  id: string;
  name: string;
  publisher: string;
  url: string;
  licence: string; // SPDX id where one exists, otherwise a short name
  licenceUrl?: string;
  /** May the values be stored in this repository and shown on the site? Proprietary sources are link-only. */
  redistributable: boolean;
  /**
   * Share-alike licence (ODbL): values derived from it stay under that licence, so they live apart in
   * data/observations-odbl/ and the site credits them separately.
   */
  shareAlike?: boolean;
}

/** A number, twelve monthly numbers, 288 hourly numbers (12 months x 24 local hours, month by month), or 12 months of temperature bins (see src/core/weather-days.ts). */
export type Value = number | number[];

export interface Observation {
  metric: string;
  value: Value;
  /** What the value describes in time: "2025", "2023-Q4", "1991-2020". */
  period: string;
  level: Level;
  source: string; // Source.id
  /** When it was fetched from the source: an ISO date, or date and time for figures fetched on demand. */
  retrieved: string;
  note?: string;
  /** The address it was fetched from, when it was fetched on demand (provenance). */
  url?: string;
  /** Which fetcher produced it, "<source-id>@<version>". */
  fetcher?: string;
  /** Set when a reviewed proposal corrected this figure (data/corrections.json): when, through which issue, and the official text it cites. */
  correction?: { on: string; issue: number; citation: { publisher: string; title: string; url: string } };
}

export type Direction = "higher" | "lower" | "neutral";

export interface Metric {
  id: string;
  label: string;
  unit: string; // "EUR/month", "°C", "µg/m³", "per 100k", "days", "h", "index"
  category: MetricCategory;
  direction: Direction;
  shape: "scalar" | "monthly" | "hourly" | "bins";
  /** Currency the value is expressed in, when unit is money. Values are stored in local currency unless stated. */
  currency?: "local" | "EUR" | "USD";
  description: string;
  decimals?: number;
  /**
   * The value group (src/core/groups.ts) a line reading this metric belongs to, where the metric says it: "ambition"
   * (work and ambition: skills and builders around), "getting_around" (walking, cycling, transport). The groups' own
   * member lists decide; test/ambition-active.test.ts keeps the two in step.
   */
  group?: "ambition" | "getting_around";
}

export type MetricCategory = "money" | "housing" | "climate" | "environment" | "safety" | "health" | "society" | "opportunity" | "access" | "mobility" | "lifestyle";

export interface FxTable {
  base: "EUR";
  date: string;
  source: string;
  rates: Record<string, number>; // units of currency per 1 EUR
}

export interface RightsArea {
  id: string; // "EU"
  name: string;
  /** Citizens of these countries may live and work in any country of `territory`. */
  members: Iso2[];
  territory: Iso2[];
  source: string; // Source.id
  note?: string;
}

export interface Dataset {
  version: string;
  builtAt: string;
  cities: City[];
  countries: Record<Iso2, Country>;
  sources: Record<string, Source>;
  metrics: Record<string, Metric>;
  observations: Record<string, Observation[]>; // by city id
  fx: FxTable;
  rights: RightsArea[];
  /** Sources under a share-alike licence (ODbL): their observations stay under it wherever the dataset goes. */
  shareAlike?: string[];
}

// ---------- The person using it ----------

export interface Person {
  label: string;
  citizenships: Iso2[];
  /** What the newcomer tax regimes check (src/tax/regimes.ts), and the age that age-dependent tax and pension rules read. Optional: a missing fact makes its condition "you must confirm". */
  newcomer?: NewcomerFacts;
  /** What this person earns. Only for the people after the first: your own pay is `Profile.income`. */
  pay?: Pay;
  /** Who they are to the first person: a partner shares the household budget (childcare is priced for a couple). */
  relation?: "partner" | "family" | "cofounder";
  /** Married to the first person, or in a registered partnership: where a country taxes such couples together, they file jointly. */
  spouse?: boolean;
  /**
   * Newcomer regimes this person chose, by country: regime id from src/tax/regimes.ts. Only for the people after the
   * first (your own are `IncomePlan.regimes`); each is checked against this person's own facts and answers.
   */
  regimes?: Record<Iso2, string>;
}

/** One person's pay, for a partner or co-founder who earns too. */
export interface Pay {
  /** Gross a year, in `currency`. */
  gross: number;
  currency: string;
  /** "per-city": a figure in `perCity` wins for that city; the others use `gross`. */
  mode?: "same" | "per-city";
  perCity?: Record<string, { gross: number; currency: string }>;
  /** Share of gross paid into a pension, 0 to 0.5. */
  pension?: number;
}

/** The few facts about a person that decide whether a regime for people moving in applies. */
export interface NewcomerFacts {
  age?: number;
  /** Children under 18 moving with you. */
  minorChildren?: number;
  /** Whole calendar years since you were last tax resident in a country, by ISO alpha-2; "never" if you never were. Leave out a country you are unsure about. */
  yearsSinceResident?: Record<Iso2, number | "never">;
  /** Conditions no dataset can check (profession, degree, how you were recruited), answered by you: condition id -> yes or no. */
  confirmed?: Record<string, boolean>;
}

export type HousingSize = "1bed" | "3bed";

export interface IncomePlan {
  /** "same": one gross salary everywhere (in `currency`). "per-city": a figure per city (offers, or your own estimates). */
  mode: "same" | "per-city";
  gross: number;
  currency: string;
  perCity: Record<string, { gross: number; currency: string }>;
  /** Optional per-country tax tweaks: special regimes, partly exempt pay, impatriate schemes. */
  taxTweaks: Record<Iso2, TaxTweak>;
  /** Newcomer regimes you have switched on, by country: regime id from src/tax/regimes.ts. Off unless set. Your own tweak fields win over the regime's. */
  regimes?: Record<Iso2, string>;
  /** Share of your gross paid into a pension, 0 to 0.5: pre-tax where the country gives relief (src/tax/pension.ts). */
  pension?: number;
  /** What you spend each month on everything except housing, childcare and health (counted separately), where you live now, and where that is. */
  everyday: { amount: number; currency: string; homeCity: string; /** True while this is the app's starting guess, not something the person set: never claim they live there. */ assumed?: boolean } | null;
  savings: number; // in display currency, for runway
}

export interface TaxTweak {
  /** Share of gross that is taxable (e.g. 0.5 for an impatriate regime). Default 1. */
  taxableShare?: number;
  /**
   * Pay put into a pension before income tax, local currency a year. Set by the pension relief rules
   * (src/tax/pension.ts), not by people: every income-tax layer takes it off its base before the taxable share.
   */
  pretaxDeduction?: number;
  /** Replace the progressive income tax with a flat rate on taxable income (e.g. 0.24). */
  flatRate?: number;
  /** What the flat rate replaces: the national schedule only (default), or every income-tax layer (regional, municipal, church), as in Spain's Beckham regime or Denmark's researcher scheme. */
  flatRateScope?: "national" | "all";
  /** You pay none of the country's employee social contributions (e.g. a foreigner on a Singapore Employment Pass pays no CPF). */
  noSocialContributions?: boolean;
  note?: string;
}

export interface PersonalLine {
  id: string;
  label: string;
  /** 1 (bad) to 5 (great), by city id. Cities without a score are treated as missing for this line. */
  scores: Record<string, number>;
}

export type ComfortBasis = "feels" | "air";

export interface Preferences {
  /**
   * Your comfortable daytime temperature, °C: a dry, mostly clear day whose average temperature from 8 am to 8 pm sits
   * inside it is a nice day. `basis` says which temperature: feels-like (the default) or the air in the shade.
   * A saved range without `basis` is from before nice days and meant a month's average; it is replaced on load.
   */
  comfort: { min: number; max: number; basis?: ComfortBasis };
  normalise: "absolute" | "relative";
  /**
   * A city lacking a figure others have: "lowest" scores it at the lowest score a compared city has on the line,
   * "worst" at 0, "skip" leaves the line out for every city. "average" is an older name, read as "lowest": a gap is
   * never scored above a city that has the figure. Money lines are never filled in (Criterion.sameBasis).
   */
  missing: "lowest" | "skip" | "worst" | "average";
  /** How figures are shown: °C or °F, km or miles, number and date style (src/core/units.ts). Metric when unset. */
  units?: Partial<Units>;
}

export interface Profile {
  name: string;
  displayCurrency: string;
  cities: string[];
  household: Person[];
  housing: { size: HousingSize };
  income: IncomePlan;
  weights: Record<string, number>; // criterion id -> 0..100
  personal: PersonalLine[];
  prefs: Preferences;
  /** Your own numbers where you know better than the data: cityId -> metricId -> value. */
  overrides: Record<string, Record<string, number>>;
  /** Criteria that rule a city out entirely when they fail. */
  dealBreakers: string[];
  /**
   * Where you stand on the position lines (politics, laws), each on its line's own scale: a place scores by how close
   * it sits. Only what you said: a line you have not answered has no score, and nothing here is guessed.
   */
  stances?: Record<string, number>;
  /** The city you measure time zones and flights from (family, partner, current base). Defaults to where you live now. */
  home?: string;
  /** Ages of the children moving with you, in years: childcare, child credits and payroll rules that depend on children read them. */
  children?: number[];
  /**
   * Whether the household pays for childcare for its children under 6. Unset means yes. With no, there is no childcare
   * cost; with yes, your own figure (metric childcare_cost, a month) replaces the OECD reference household's.
   */
  paidChildcare?: boolean;
}
