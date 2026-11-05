// What the published pages and the static API say about a city or a pair of cities, computed once from the
// dataset and the engine so the HTML, the markdown twin and the JSON never disagree. Pure: dataset in, facts out.
import { evaluate, type CityResult } from "../core/engine.ts";
import { CRITERIA, DEFAULT_COMFORT, figureWords, niceDays } from "../core/criteria.ts";
import { resolve, series, type Resolved } from "../core/lookup.ts";
import { convert, money, type MoneyResult } from "../core/money.ts";
import { longestDay, monthlyDaylight, shortestDay } from "../core/sun.ts";
import type { City, Country, Dataset, Iso2, Level, Metric, Observation, Profile, Source } from "../core/types.ts";
import { mergeCompleteness, type Completeness } from "../tax/common.ts";
import { taxModelFor } from "../tax/index.ts";
import { PRESETS } from "../core/presets.ts";
import { defaultProfile } from "../ui/state.ts";
import { money as fmtMoney, num } from "../ui/format.ts";

export interface SourceRef {
  id: string;
  name: string;
  publisher: string;
  url: string;
  licence: string;
  licenceUrl?: string;
}

export interface Figure {
  metric: string;
  label: string;
  description: string;
  value: number;
  /** The value with its unit, as a person reads it. */
  text: string;
  unit: string;
  period: string;
  level: Level;
  retrieved: string;
  /** One source, or the median of several that agree in level and time. */
  method: "source" | "median";
  range?: [number, number];
  sources: SourceRef[];
  note?: string;
}

export interface Climate {
  high: number[];
  low: number[];
  lowP10: number[] | null;
  highP90: number[] | null;
  recordLow: number[] | null;
  recordHigh: number[] | null;
  /** Nice days a month on the default comfortable range (DEFAULT_COMFORT). */
  nice: number[] | null;
  wetDays: number[] | null;
  daylight: number[];
  period: string;
  source: SourceRef;
}

export interface TakeHomeRow {
  gross: number;
  net: number;
  effectiveRate: number;
}

export interface TakeHome {
  currency: string;
  year: number;
  scope: string;
  sources: { label: string; url: string }[];
  caveats: string[];
  /** Caveats specific to this city (a state or region the model only partly covers), already in `caveats`. */
  local: string[];
  rows: TakeHomeRow[];
  /** How much of what is due here the rows hold: "partial" means a tax is left out and the take-home is too high. */
  completeness: Completeness;
}

export interface FreeMovementArea {
  id: string;
  name: string;
  /** Citizens of these countries may live and work here without a visa. */
  members: Iso2[];
  note?: string;
  source: SourceRef;
}

export interface Budget {
  currency: string;
  gross: number | null;
  net: number | null;
  rent: number | null;
  rentFigure: Figure | null;
  everyday: number | null;
  everydayHow: string | null;
  /** Childcare and health a month, which money left takes off too. */
  childcare: number | null;
  health: number | null;
  left: number | null;
  missing: string[];
  /** How much of what is due money left holds (src/core/money.ts MoneyResult.completeness). */
  completeness: Completeness;
}

export interface CityFacts {
  city: City;
  country: Country;
  path: string;
  figures: Figure[];
  /** Metrics with no open figure for this city yet. */
  gaps: { metric: string; label: string }[];
  climate: Climate | null;
  shortestDay: number;
  longestDay: number;
  takeHome: TakeHome | null;
  freeMovement: FreeMovementArea[];
  budget: Budget;
  comparisons: { path: string; other: City }[];
  linkOut: { label: string; url: string }[];
  /** Plain factual sentences with numbers, periods and sources: what an answer engine can quote. */
  keyFacts: string[];
}

// ---------- Small helpers ----------

export const cityPath = (id: string) => `/city/${id}/`;
export const pairId = (a: string, b: string) => (a < b ? `${a}-vs-${b}` : `${b}-vs-${a}`);
export const comparePath = (a: string, b: string) => `/compare/${pairId(a, b)}/`;

function sourceRef(data: Dataset, id: string): SourceRef {
  const s: Source | undefined = data.sources[id];
  return s ? { id: s.id, name: s.name, publisher: s.publisher, url: s.url, licence: s.licence, licenceUrl: s.licenceUrl } : { id, name: id, publisher: id, url: "", licence: "unknown" };
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export const countryLabel = (data: Dataset, iso: Iso2) => data.countries[iso]?.name ?? regionNames.of(iso) ?? iso;

/** "the United Kingdom", "the Netherlands", "Italy": a country name as it sits in a sentence. */
export const inSentence = (name: string) => (/^(United |Netherlands|Czech Republic|Philippines|Bahamas|Gambia)/.test(name) ? `the ${name}` : name);

/** Round to two significant figures, so reference salaries read as numbers people actually earn. */
export function nice(x: number): number {
  if (x <= 0) return 0;
  const p = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
}

export function hoursText(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 60 ? `${hh + 1} h 00 min` : `${hh} h ${String(mm).padStart(2, "0")} min`;
}

export const levelText = (level: Level, country: string) =>
  level === "city" ? "city" : level === "metro" ? "metro area" : level === "region" ? "region" : `${country}-wide`;

// ---------- The reference profile every published page uses ----------

/**
 * What the published pages assume, said on each page: the app's default profile with the given cities, the Balanced
 * weights, and a reference salary of 60,000 EUR a year. The app itself assumes no salary; a page needs one to show a
 * month's budget, and names it wherever it is used.
 */
export const REFERENCE_GROSS = 60_000;
export function referenceProfile(data: Dataset, cities: string[]): Profile {
  const base = defaultProfile(data);
  return { ...base, cities, weights: { ...PRESETS[0]!.weights }, income: { ...base.income, gross: REFERENCE_GROSS } };
}

/** The query the app reads to open with these cities, keeping the visitor's own saved profile (src/ui/state.ts loadProfile). */
export function appQuery(cities: string[]): string {
  return `cities=${cities.join(",")}`;
}

/** Reference salaries: 30k, 60k and 100k euros a year, in local currency, rounded. */
export function referenceSalaries(data: Dataset, currency: string): number[] {
  return [30_000, 60_000, 100_000].map((eur) => nice(convert(data, eur, "EUR", currency) ?? eur));
}

// ---------- Figures ----------

function figureFrom(data: Dataset, city: City, metric: Metric, r: Resolved): Figure | null {
  if (typeof r.value !== "number" || r.origin.kind === "you") return null;
  const local = data.countries[city.country]?.currency ?? "EUR";
  const obs: Observation[] = r.origin.kind === "consensus" ? r.origin.observations : [r.origin.observation];
  const best = r.origin.observation;
  const decimals = metric.decimals ?? 1;
  const text = figureText(r.value, metric, local, decimals);
  return {
    metric: metric.id,
    label: metric.label,
    description: metric.description,
    value: r.value,
    text,
    unit: metric.currency === "local" ? `${local}${metric.unit}` : metric.currency ? `${metric.currency}${metric.unit}` : metric.unit,
    period: best.period,
    level: r.level,
    retrieved: best.retrieved,
    method: r.origin.kind === "consensus" ? "median" : "source",
    range: r.origin.kind === "consensus" ? [r.origin.min, r.origin.max] : undefined,
    sources: obs.map((o) => sourceRef(data, o.source)),
    note: best.note && !/undefined/.test(best.note) ? best.note : undefined,
  };
}

/** "/month" → "a month", "/year per person" → "a year per person": a metric's period as a person says it. */
export function perText(unit: string): string {
  return unit.startsWith("/") ? `a ${unit.slice(1)}` : unit;
}

/**
 * A figure with its unit as a person reads it: money in its own currency (the city's for "local", else the metric's)
 * over the metric's own period, so an annual fee reads "a year"; anything else as a number with its unit.
 */
export function figureText(value: number, metric: Metric, local: string, decimals = metric.decimals ?? 1): string {
  const currency = metric.currency === "local" ? local : metric.currency;
  if (currency) return `${fmtMoney(value, currency)} ${perText(metric.unit)}`.trim();
  const words = figureWords(metric, value);
  if (words) return words;
  return `${num(value, decimals)} ${metric.unit}`;
}

function climateOf(data: Dataset, city: City): Climate | null {
  const hi = resolve(data, null, city, "temp_high");
  const lo = resolve(data, null, city, "temp_low");
  const h = series(hi);
  const l = series(lo);
  if (!h || !l || !hi || hi.origin.kind === "you") return null;
  const get = (m: string) => series(resolve(data, null, city, m));
  const nice = niceDays(data, referenceProfile(data, [city.id]), city);
  return { high: h, low: l, lowP10: get("temp_low_p10"), highP90: get("temp_high_p90"), recordLow: get("temp_record_low"), recordHigh: get("temp_record_high"), nice: nice?.months ?? null, wetDays: get("wet_days_monthly"), daylight: monthlyDaylight(city.lat), period: hi.origin.observation.period, source: sourceRef(data, hi.origin.observation.source) };
}

function takeHomeOf(data: Dataset, city: City): TakeHome | null {
  const model = taxModelFor(city.country);
  if (!model) return null;
  const results = referenceSalaries(data, model.currency).map((gross) => model.compute({ gross, region: city.region, city: city.id }));
  const rows = results.map((t) => ({ gross: t.gross, net: t.net, effectiveRate: t.effectiveRate }));
  const caveats = [...new Set(results.flatMap((t) => t.caveats))];
  const sources = [...new Map(results.flatMap((t) => t.sources).map((s) => [s.url, s])).values()];
  return { currency: model.currency, year: model.year, scope: model.scope, sources, caveats, local: caveats.filter((c) => !model.caveats.includes(c)), rows, completeness: mergeCompleteness(...results.map((t) => t.completeness)) };
}

function freeMovementOf(data: Dataset, country: Iso2): FreeMovementArea[] {
  const seen = new Set<string>();
  const out: FreeMovementArea[] = [];
  for (const a of data.rights) {
    if (!a.territory.includes(country)) continue;
    const members = a.members.filter((m) => m !== country);
    const key = `${a.name}:${members.join()}`;
    if (seen.has(key) || members.length === 0) continue;
    seen.add(key);
    out.push({ id: a.id, name: a.name, members, note: a.note, source: sourceRef(data, a.source) });
  }
  return out;
}

function budgetOf(data: Dataset, city: City): Budget {
  const profile = referenceProfile(data, [city.id]);
  const m: MoneyResult = money(data, profile, city);
  const metric = data.metrics[`rent_${profile.housing.size}`];
  const rentFigure = m.rent && metric ? figureFrom(data, city, metric, m.rent.resolved) : null;
  return {
    currency: m.localCurrency,
    gross: m.gross,
    net: m.net,
    rent: m.rent?.monthly ?? null,
    rentFigure,
    everyday: m.everyday?.monthly ?? null,
    everydayHow: m.everyday?.how ?? null,
    childcare: m.childcare?.monthly ?? null,
    health: m.health?.monthly ?? null,
    left: m.monthlyLeft,
    missing: m.missing,
    completeness: m.completeness,
  };
}

// ---------- Which pairs get a comparison page ----------

function km(a: City, b: City): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The pairs people plausibly weigh against each other: every pair within one country, each city's five nearest
 * cities, its three nearest in kind (closest population within 2,500 km), and the four largest cities within
 * 1,500 km (the London-or-Dublin question). Each pair once, ids in order.
 */
export function comparisonPairs(data: Dataset): [string, string][] {
  const keys = new Set<string>();
  const add = (a: City, b: City) => {
    if (a.id !== b.id) keys.add(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  };
  for (const a of data.cities) {
    const others = data.cities.filter((b) => b.id !== a.id);
    for (const b of others) if (b.country === a.country) add(a, b);
    const byDistance = [...others].sort((x, y) => km(a, x) - km(a, y));
    for (const b of byDistance.slice(0, 5)) add(a, b);
    const pop = (c: City) => Math.log(c.population ?? 1);
    const kin = others.filter((b) => km(a, b) <= 2_500 && b.population).sort((x, y) => Math.abs(pop(x) - pop(a)) - Math.abs(pop(y) - pop(a)));
    for (const b of kin.slice(0, 3)) add(a, b);
    const big = others.filter((b) => km(a, b) <= 1_500).sort((x, y) => (y.population ?? 0) - (x.population ?? 0));
    for (const b of big.slice(0, 4)) add(a, b);
  }
  return [...keys].sort().map((k) => k.split("|") as [string, string]);
}

// ---------- City facts ----------

/** One line per city for indexes such as llms.txt: country, take-home, rent, summer high, air. */
export function summaryLine(f: CityFacts): string {
  const parts = [f.country.name];
  const t = f.takeHome;
  if (t) parts.push(`take-home ${fmtMoney(t.rows[1]!.net / 12, t.currency)} a month on ${fmtMoney(t.rows[1]!.gross, t.currency)} gross${t.completeness.status === "partial" ? ` (partial: before ${t.completeness.missing.join(", ")})` : ""}`);
  const rent = f.figures.find((x) => x.metric === "rent_1bed");
  if (rent) parts.push(`one-bedroom rent ${rent.text}`);
  if (f.climate) parts.push(`warmest-month high ${num(Math.max(...f.climate.high), 1)} °C`);
  const pm = f.figures.find((x) => x.metric === "pm25");
  if (pm) parts.push(`PM2.5 ${num(pm.value, 1)} µg/m³`);
  return parts.join("; ");
}

export function cityFacts(data: Dataset, cityId: string, pairs: [string, string][] = comparisonPairs(data)): CityFacts {
  const city = data.cities.find((c) => c.id === cityId);
  if (!city) throw new Error(`unknown city ${cityId}`);
  const country = data.countries[city.country]!;
  const figures: Figure[] = [];
  const gaps: CityFacts["gaps"] = [];
  for (const metric of Object.values(data.metrics)) {
    if (metric.shape !== "scalar") continue;
    const r = resolve(data, null, city, metric.id);
    const f = r ? figureFrom(data, city, metric, r) : null;
    f ? figures.push(f) : gaps.push({ metric: metric.id, label: metric.label });
  }
  const climate = climateOf(data, city);
  const takeHome = takeHomeOf(data, city);
  const freeMovement = freeMovementOf(data, city.country);
  const budget = budgetOf(data, city);
  const comparisons = pairs
    .filter(([a, b]) => a === city.id || b === city.id)
    .map(([a, b]) => {
      const other = data.cities.find((c) => c.id === (a === city.id ? b : a))!;
      return { path: comparePath(a, b), other };
    })
    .sort((x, y) => x.other.name.localeCompare(y.other.name));
  const slug = encodeURIComponent(city.name.replace(/ /g, "-"));
  const linkOut = [
    { label: `Numbeo: cost of living in ${city.name}`, url: `https://www.numbeo.com/cost-of-living/in/${slug}` },
    { label: `WeatherSpark: year-round weather in ${city.name}`, url: `https://weatherspark.com/search?q=${encodeURIComponent(city.name)}` },
    { label: `Wikipedia: ${city.name}`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(city.name.replace(/ /g, "_"))}` },
  ];
  const facts: CityFacts = {
    city,
    country,
    path: cityPath(city.id),
    figures,
    gaps,
    climate,
    shortestDay: shortestDay(city.lat),
    longestDay: longestDay(city.lat),
    takeHome,
    freeMovement,
    budget,
    comparisons,
    linkOut,
    keyFacts: [],
  };
  facts.keyFacts = keyFacts(data, facts);
  return facts;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const citeSource = (s: SourceRef) => `${s.name}, ${s.publisher.split(",")[0]}`;

function cite(f: Figure): string {
  const names = f.sources.map(citeSource).join("; ");
  return f.method === "median" ? `median of ${f.sources.length} sources: ${names}, ${f.period}` : `${names}, ${f.period}`;
}

/** Sentences an answer engine can lift whole: subject, number, unit, period and source in one line. */
function keyFacts(data: Dataset, f: CityFacts): string[] {
  const out: string[] = [];
  const name = f.city.name;
  const cn = inSentence(f.country.name);
  const Cn = cn.charAt(0).toUpperCase() + cn.slice(1);
  const fig = (id: string) => f.figures.find((x) => x.metric === id);
  if (f.city.population) out.push(`${name} has about ${num(f.city.population)} residents (GeoNames).`);
  const t = f.takeHome;
  if (t) {
    const mid = t.rows[1]!;
    out.push(
      `On a gross salary of ${fmtMoney(mid.gross, t.currency)} a year, an employee in ${name} takes home about ${fmtMoney(mid.net, t.currency)} a year (${fmtMoney(mid.net / 12, t.currency)} a month) after income tax and employee contributions, an effective rate of ${num(mid.effectiveRate * 100, 1)}% (${f.country.name} ${t.year} rules).${t.local.length ? ` ${t.local.join(" ")}` : ""}${t.completeness.status === "partial" ? ` This figure is partial: it leaves out ${t.completeness.missing.join(", ")}, so the real take-home is lower.` : ""}`,
    );
  }
  const rent = fig("rent_1bed");
  if (rent) out.push(`A one-bedroom home in ${name} rents for about ${rent.text} (${levelText(rent.level, cn)} figure; ${cite(rent)}).`);
  if (f.climate) {
    const c = f.climate;
    const hot = c.high.indexOf(Math.max(...c.high));
    const cold = c.low.indexOf(Math.min(...c.low));
    out.push(
      `In ${name} the average daily high (air temperature in the shade) peaks at ${num(c.high[hot]!, 1)} °C in ${MONTHS[hot]} and the average daily low falls to ${num(c.low[cold]!, 1)} °C in ${MONTHS[cold]} (${citeSource(c.source)}, ${c.period}).`,
    );
  }
  if (f.climate?.nice) {
    const n = f.climate.nice;
    const best = n.indexOf(Math.max(...n));
    out.push(
      `${name} has about ${num(n.reduce((a, b) => a + b, 0))} nice days a year, days that are dry, mostly clear and feel ${DEFAULT_COMFORT.min} to ${DEFAULT_COMFORT.max} °C on average from 8 am to 8 pm, most of them in ${MONTHS[best]} (${num(n[best]!)}) (${citeSource(f.climate.source)}, ${f.climate.period}).`,
    );
  }
  if (f.climate?.recordHigh && f.climate.recordLow)
    out.push(`Between ${f.climate.period.replace("-", " and ")} the air in ${name} reached ${num(Math.max(...f.climate.recordHigh), 1)} °C at its hottest and ${num(Math.min(...f.climate.recordLow), 1)} °C at its coldest (${citeSource(f.climate.source)}).`);
  const wet = fig("wet_days");
  if (wet) out.push(`It rains or snows (at least 1 mm) on about ${num(wet.value)} days a year in ${name} (${cite(wet)}).`);
  out.push(`The shortest day in ${name} lasts ${hoursText(f.shortestDay)} and the longest ${hoursText(f.longestDay)} (computed from latitude).`);
  const pm = fig("pm25");
  if (pm) out.push(`Fine dust (PM2.5) in ${name} averages ${num(pm.value, 1)} µg/m³ a year, ${num(pm.value / 5, 1)} times the WHO guideline of 5 µg/m³ (${cite(pm)}).`);
  const pl = fig("price_level");
  if (pl) out.push(`Everyday prices in ${cn} sit at ${num(pl.value, 1)} on an index where the United States is 100 (${cite(pl)}).`);
  const life = fig("life_expectancy");
  if (life) out.push(`Life expectancy at birth in ${cn} is ${num(life.value, 1)} years (${cite(life)}).`);
  const hom = fig("homicide_rate");
  if (hom) out.push(`${Cn} records ${num(hom.value, 2)} intentional homicides per 100,000 people a year (${cite(hom)}).`);
  const areas = f.freeMovement;
  const who = (a: FreeMovementArea) =>
    a.members.length <= 3 ? `${a.members.map((m) => inSentence(countryLabel(data, m))).join(" and ")} (${a.name})` : `${a.members.length} other countries under ${a.name}`;
  out.push(
    areas.length
      ? `Besides citizens of ${cn}, citizens of ${areas.map(who).join(" and of ")} can live and work in ${name} without a visa.`
      : `Only citizens of ${cn} can live and work in ${name} without a visa or permit; everyone else needs one.`,
  );
  return out;
}

// ---------- Comparisons ----------

export interface CompareLine {
  id: string;
  label: string;
  question: string;
  a: { text: string; points: number; imputed: boolean; sources: SourceRef[]; level: Level | null };
  b: { text: string; points: number; imputed: boolean; sources: SourceRef[]; level: Level | null };
  weight: number;
}

export interface CompareFacts {
  path: string;
  a: CityFacts;
  b: CityFacts;
  profile: Profile;
  results: [CityResult, CityResult]; // in a, b order
  winner: City | null; // null when within 2 points
  lines: CompareLine[];
  /** The lines that move the totals most, biggest first. */
  drivers: { label: string; leader: City; points: number }[];
  qa: { q: string; a: string }[];
  appParam: string;
}

function side(data: Dataset, r: CityResult, id: string): CompareLine["a"] {
  const l = r.lines.find((x) => x.id === id)!;
  const sources = l.raw.sources.flatMap((s) => (s.origin.kind === "you" ? [] : s.origin.kind === "consensus" ? s.origin.observations : [s.origin.observation])).map((o) => sourceRef(data, o.source));
  const unique = [...new Map(sources.map((s) => [s.id, s])).values()];
  return { text: l.raw.text, points: l.points, imputed: l.imputed, sources: unique, level: l.raw.sources[0]?.level ?? null };
}

export function compareFacts(data: Dataset, aId: string, bId: string, pairs: [string, string][] = comparisonPairs(data)): CompareFacts {
  const [x, y] = aId < bId ? [aId, bId] : [bId, aId];
  const a = cityFacts(data, x, pairs);
  const b = cityFacts(data, y, pairs);
  const profile = referenceProfile(data, [x, y]);
  const ev = evaluate(data, profile);
  const ra = ev.results.find((r) => r.city.id === x)!;
  const rb = ev.results.find((r) => r.city.id === y)!;
  const lines: CompareLine[] = CRITERIA.map((c) => ({ id: c.id, label: c.label, question: c.question, a: side(data, ra, c.id), b: side(data, rb, c.id), weight: ra.lines.find((l) => l.id === c.id)!.weight }));
  const drivers = lines
    .map((l) => ({ label: l.label, d: l.a.points - l.b.points }))
    .filter((d) => Math.abs(d.d) >= 0.5)
    .sort((p, q) => Math.abs(q.d) - Math.abs(p.d))
    .slice(0, 3)
    .map((d) => ({ label: d.label, leader: d.d > 0 ? a.city : b.city, points: Math.abs(d.d) }));
  const gap = ra.total - rb.total;
  const winner = Math.abs(gap) < 2 ? null : gap > 0 ? a.city : b.city;
  const qa = compareQa(data, a, b, ra, rb);
  return { path: comparePath(x, y), a, b, profile, results: [ra, rb], winner, lines, drivers, qa, appParam: appQuery([x, y]) };
}

/** Questions the page truly answers, each from a figure shown on it. */
function compareQa(data: Dataset, a: CityFacts, b: CityFacts, ra: CityResult, rb: CityResult): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  const A = a.city.name;
  const B = b.city.name;
  const cost = (r: CityResult) => r.money.display.monthlyCost;
  const ca = cost(ra);
  const cb = cost(rb);
  if (ca !== null && cb !== null) {
    const cheaper = ca < cb ? A : B;
    out.push({
      q: `Is it cheaper to live in ${A} or ${B}?`,
      a: `For one person renting a one-bedroom home, ${cheaper} is cheaper: about ${fmtMoney(Math.min(ca, cb), "EUR")} a month against ${fmtMoney(Math.max(ca, cb), "EUR")}, rent and everyday spending included. Rent comes from official rent statistics and everyday spending is scaled by each country's World Bank price level.`,
    });
  } else {
    const pa = a.figures.find((f) => f.metric === "price_level");
    const pb = b.figures.find((f) => f.metric === "price_level");
    if (pa && pb && a.country.code !== b.country.code)
      out.push({
        q: `Is it cheaper to live in ${A} or ${B}?`,
        a: `Everyday prices are lower in ${inSentence(pa.value < pb.value ? a.country.name : b.country.name)}: ${num(Math.min(pa.value, pb.value), 1)} against ${num(Math.max(pa.value, pb.value), 1)} on the World Bank price level index (United States = 100, ${pa.period}). Open rent data is missing for ${[ra, rb].filter((r) => !r.money.rent).map((r) => r.city.name).join(" and ")}, so the full monthly cost needs your own rent.`,
      });
  }
  const na = ra.money.net;
  const nb = rb.money.net;
  // Only figures that hold every tax due are set side by side: a partial one would look like an advantage.
  const whole = (c: Completeness) => c.status === "complete" || c.status === "approximate";
  if (na !== null && nb !== null && a.takeHome && b.takeHome && whole(ra.money.tax?.completeness ?? a.takeHome.completeness) && whole(rb.money.tax?.completeness ?? b.takeHome.completeness)) {
    const ga = ra.money.gross!;
    out.push({
      q: `How much do you take home on ${fmtMoney(convert(data, ga, ra.money.localCurrency, "EUR") ?? ga, "EUR")} a year in ${A} and in ${B}?`,
      a: `About ${fmtMoney(na, ra.money.localCurrency)} a year in ${A} (${a.country.name} ${a.takeHome.year} tax rules) and ${fmtMoney(nb, rb.money.localCurrency)} in ${B} (${b.country.name} ${b.takeHome.year} tax rules), after income tax and employee social contributions.`,
    });
  }
  const left = (r: CityResult) => r.money.display.monthlyLeft;
  if (left(ra) !== null && left(rb) !== null && whole(ra.money.completeness) && whole(rb.money.completeness))
    out.push({
      q: `Where do you keep more money each month, ${A} or ${B}?`,
      a: `On ${fmtMoney(ra.money.gross === null ? 0 : convert(data, ra.money.gross, ra.money.localCurrency, "EUR") ?? 0, "EUR")} gross, renting a one-bedroom home: ${fmtMoney(left(ra)!, "EUR")} a month left in ${A} and ${fmtMoney(left(rb)!, "EUR")} in ${B}, after tax, rent, everyday spending and health care.`,
    });
  if (a.climate && b.climate) {
    const warm = (c: Climate) => c.high.reduce((s, v) => s + v, 0) / 12;
    const wa = warm(a.climate);
    const wb = warm(b.climate);
    out.push({
      q: `Which is warmer, ${A} or ${B}?`,
      a: `${wa > wb ? A : B} is warmer: average daily highs of the air over the year are ${num(Math.max(wa, wb), 1)} °C against ${num(Math.min(wa, wb), 1)} °C in ${wa > wb ? B : A} (${citeSource(a.climate.source)}, ${a.climate.period}).`,
    });
  }
  const pa = a.figures.find((f) => f.metric === "pm25");
  const pb = b.figures.find((f) => f.metric === "pm25");
  if (pa && pb)
    out.push({
      q: `Which has cleaner air, ${A} or ${B}?`,
      a: `${pa.value < pb.value ? A : B} has cleaner air: an annual PM2.5 mean of ${num(Math.min(pa.value, pb.value), 1)} µg/m³ against ${num(Math.max(pa.value, pb.value), 1)} µg/m³ (WHO Ambient Air Quality Database; WHO guideline 5 µg/m³; ${pa.period} and ${pb.period}).`,
    });
  if (a.country.code !== b.country.code) {
    const shared = b.freeMovement.some((x) => x.members.includes(a.country.code));
    out.push({
      q: `Can a citizen of ${inSentence(a.country.name)} live and work in ${B} without a visa?`,
      a: shared
        ? `Yes. ${b.freeMovement.find((x) => x.members.includes(a.country.code))?.name ?? "Free movement"} rules let citizens of ${inSentence(a.country.name)} live and work in ${inSentence(b.country.name)} without a visa.`
        : `No. Citizens of ${inSentence(a.country.name)} need a visa or permit to live and work in ${inSentence(b.country.name)}${b.freeMovement.length ? `; free movement there covers ${b.freeMovement.map((x) => x.name).join(" and ")} citizens` : ""}.`,
    });
  }
  return out;
}
