// The answers agents and terminals get: plain JSON built from the same engine the site runs.
// Every figure carries its provenance; every gap is named, with what would fill it.
import { CRITERIA, moneyGap } from "../core/criteria.ts";
import { ENGINE_VERSION, evaluate, LIMITS, weightOf, type Check, type CityResult, type Evaluation, type LineResult } from "../core/engine.ts";
import { LINK_ONLY, linksOut, type LinkOut } from "../core/links.ts";
import { resolve, type Resolved } from "../core/lookup.ts";
import { convert, paidChildcare, rentMetric, type MoneyResult } from "../core/money.ts";
import { PRESETS } from "../core/presets.ts";
import { householdRights, type RightResult } from "../core/rights.ts";
import { longestDay, monthlyDaylight, shortestDay } from "../core/sun.ts";
import type { City, Dataset, Level, Metric, Profile, Source, TaxTweak, Value } from "../core/types.ts";
import { TAX_MODELS, taxModelFor } from "../tax/index.ts";
import type { Completeness, TaxLine } from "../tax/common.ts";
import { householdTax } from "../tax/household.ts";
import { PENSION_RELIEF, pensionPlans, pensionStatus, type PensionStatus } from "../tax/pension.ts";
import { chosenRegime, REGIMES, regimeById, regimesFor, withRegime } from "../tax/regimes.ts";
import { findCity, matchCity } from "./cities.ts";
import { buildProfile, type QueryArgs } from "./profile.ts";

/** The shape of every report, versioned: a program reading `reportVersion` knows which fields to expect. */
export const REPORT_VERSION = "2.0";
export type Detail = "summary" | "full";

export interface Figure {
  metric: string;
  label: string;
  unit: string;
  value: Value | null;
  /** "you" when the person's own number replaced the data. */
  origin: "source" | "you" | "none";
  /** Who and when, in a few words: "Meteostat, 1961-1990" or "World Bank, 2023, country level". */
  cite?: string;
  period?: string;
  level?: Level;
  /** A wider area's figure standing in for the city. */
  approximate?: boolean;
  source?: Pick<Source, "id" | "name" | "publisher" | "url" | "licence" | "licenceUrl">;
  retrieved?: string;
  note?: string;
}

/**
 * What an answer was computed from. Two answers match when their profiles resolve the same and these match: the
 * snapshot (version, builtAt), the exchange rates (fxDate) and the engine with its tax models (engine). A person's
 * cache of fetched places and their own numbers are figures too, and are not identified here.
 */
export interface DatasetInfo {
  version: string;
  builtAt: string;
  fxDate: string;
  engine: string;
}

function unitOf(data: Dataset, m: Metric | undefined, city: City): string {
  if (!m) return "";
  return m.currency === "local" ? `${data.countries[city.country]?.currency ?? ""}${m.unit}` : m.unit;
}

export function figure(data: Dataset, city: City, metric: string, r: Resolved | null): Figure {
  const m = data.metrics[metric];
  const base = { metric, label: m?.label ?? metric, unit: unitOf(data, m, city) };
  if (!r) return { ...base, value: null, origin: "none" };
  if (r.origin.kind === "you") return { ...base, value: r.value, origin: "you", level: "city" };
  const o = r.origin.observation;
  const s = data.sources[o.source];
  // The publisher's own name, without the "archived by" or "and its providers" tail: "Meteostat, 1991-2020".
  const sname = (s?.publisher || s?.name || o.source).split(/,|\(| and its | archived /)[0]!.trim();
  return {
    ...base,
    value: r.value,
    origin: "source",
    cite: `${sname}, ${o.period}${r.level !== "city" ? `, ${r.level} level` : ""}`,
    period: o.period,
    level: r.level,
    approximate: r.level !== "city" && r.level !== "metro",
    source: s ? { id: s.id, name: s.name, publisher: s.publisher, url: s.url, licence: s.licence, licenceUrl: s.licenceUrl } : { id: o.source, name: o.source, publisher: "", url: "", licence: "" },
    retrieved: o.retrieved,
    note: o.note,
  };
}

/** `metric` names the figure when it is the person's own number, which carries no observation. */
function figureFromResolved(data: Dataset, city: City, r: Resolved, metric = ""): Figure {
  return figure(data, city, r.origin.kind === "source" ? r.origin.observation.metric : metric, r);
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const roundOrNull = (n: number | null, d: number) => (n === null ? null : round(n, d));

export const dsInfo = (data: Dataset): DatasetInfo => ({ version: data.version, builtAt: data.builtAt, fxDate: data.fx.date, engine: ENGINE_VERSION });

// ---------- compare ----------

export interface Amount {
  local: number | null;
  /** The same amount in the display currency. */
  shown: number | null;
}

export interface MoneyBreakdown {
  localCurrency: string;
  displayCurrency: string;
  salaryFrom: "same" | "per-city" | "none";
  yearly: { gross: Amount; net: Amount; tax: (TaxLine & { shown: number | null })[]; effectiveRate: number | null };
  monthly: { net: Amount; pension: Amount; rent: Amount; everyday: Amount; childcare: Amount; health: Amount; cost: Amount; left: Amount };
  /** Each earner, you first: gross, pension, take-home a year (local currency). */
  earners: { label: string; gross: number | null; salaryFrom: "same" | "per-city" | "none"; pension: number; net: number | null }[];
  /** How a married couple is taxed here, with the rule in a sentence. */
  filing: { mode: "individual" | "joint"; note: string | null } | null;
  /** The newcomer regime counted, if any: only one the person chose, "established" or a "scenario" with conditions to confirm. */
  regime: MoneyResult["regime"];
  /** How much of what is due the money figures hold (src/core/money.ts MoneyResult.completeness). */
  completeness: Completeness;
  /** Set when the money cannot be used for scoring (completeness partial or unsupported): why. */
  incomplete: string | null;
  /** What take-home pay holds, and what the month's costs hold, apart: a missing tax model never voids a known cost. */
  taxCompleteness: Completeness;
  costCompleteness: Completeness;
  /** With a partial figure: the most money left a month can be (display currency), since what is left out only lowers it. */
  leftAtMost: number | null;
  /** How the pension share is treated here, when one is set: relief modelled, none by law, or not modelled (saving only). */
  pensionRelief: { plan: string; status: PensionStatus; text: string } | null;
  /** Every earner's newcomer regime counted here, with whose it is. */
  regimes: MoneyResult["regimes"];
  childcare: { how: string; sources: Figure[] } | null;
  /** Whether the household pays for childcare (false: no childcare cost is counted). */
  paidChildcare: boolean;
  health: { how: string; sources: Figure[] } | null;
  /** Paid days off by law, and what they are worth at the first earner's pay (local, a year). */
  leave: { holidayDays: number | null; holidayNote: string | null; publicHolidays: number | null; mothersWeeks: number | null; fathersWeeks: number | null; value: Amount; sources: Figure[] };
  /** The gross you would need here to keep what you keep where you live now; null at home or when anything is missing. */
  breakEven: { gross: Amount; home: string; targetMonthlyShown: number; vsCurrentPay: number | null } | null;
  /** What the total leaves out without blocking it (premiums bought outside pay, for one). */
  gaps: string[];
  rentSource: Figure | null;
  everydayHow: string | null;
  everydaySources: Figure[];
  runwayMonths: number | null;
  taxModel: { country: string; year: number; caveats: string[]; sources: { label: string; url: string }[] } | null;
  missing: string[];
}

export interface Line {
  id: string;
  label: string;
  question: string;
  personal: boolean;
  weight: number;
  /** 0..1, null when there is no data. */
  score: number | null;
  /** Points this line adds to the total, out of 100. */
  points: number;
  value: number | null;
  text: string;
  approximate: boolean;
  /** No figure for this city: scored at the lowest compared city on this line (or 0 with missing "worst"). */
  imputed: boolean;
  /** Scored on an observed figure; coverage counts only these. */
  observed: boolean;
  /** Set when every city is scored on another basis for this line (money left on take-home pay). */
  basis: string | null;
  failed: boolean;
  /** As a must-pass: pass, fail, or unknown (no figure, or not everyone's passports). */
  check: Check;
  dealBreaker: boolean;
  sources: Figure[];
}

export interface CityVerdict {
  id: string;
  name: string;
  country: string;
  rank: number;
  total: number;
  /** Share of the total weight scored on observed figures, on whatever basis each line was scored. */
  coverage: number;
  /** Share of the total weight observed on each line's own basis: money scored on take-home pay instead does not count. */
  requestedCoverage: number;
  /** The lowest and highest total this city could have on the lines as asked, once its missing figures are known. */
  bounds: { low: number; high: number };
  ruledOut: string[];
  /** Must-pass lines nobody can say this city passes yet. */
  unresolved: string[];
  /** Plain sentences explaining the place in the ranking. */
  why: string[];
  lines: Line[];
  money: MoneyBreakdown;
  rights: RightResult[];
  missing: string[];
}

export interface RankRow {
  rank: number;
  id: string;
  name: string;
  country: string;
  total: number;
  coverage: number;
  requestedCoverage: number;
  /** "passes": every must-pass observed to pass (or none set); "unknown": one cannot be checked yet; "ruled out": one fails. */
  status: "passes" | "unknown" | "ruled out";
  ruledOut: string[];
  unresolved: string[];
  monthlyLeft: number | null;
  /** Only with a partial money figure: the most money left a month can be. */
  monthlyLeftAtMost?: number;
}

export interface CompareReport {
  reportVersion: string;
  detail: "full";
  dataset: DatasetInfo;
  /** One sentence: who leads, qualified when a must-pass is unknown, the lead is provisional, money was compared on another basis or little of the score is observed. */
  verdict: string;
  /** True when missing figures, partial money or money on another basis could still change who leads (Evaluation.provisional). */
  provisional: boolean;
  /** Who could overtake the leader, then what is missing, one sentence each. */
  provisionalReasons: string[];
  /** The money line asked for and the basis it was scored on for every city. */
  moneyBasis: Evaluation["moneyBasis"];
  /** How this set was scored, when it matters: a line on another basis or left out for every city, periods that differ. */
  notes: string[];
  /** Must-pass lines that cannot be checked yet, by city. */
  requiredUnknowns: { id: string; name: string; lines: string[] }[];
  assumptions: string[];
  ranking: RankRow[];
  cities: CityVerdict[];
  /** What the person could add to make the comparison sharper, most useful first. */
  whatToAdd: string[];
  displayCurrency: string;
  profile: Profile;
}

function moneyBreakdown(data: Dataset, profile: Profile, r: CityResult): MoneyBreakdown {
  const m = r.money;
  const local = m.localCurrency;
  const shown = profile.displayCurrency;
  const amt = (v: number | null): Amount => ({ local: roundOrNull(v, 0), shown: v === null ? null : roundOrNull(convert(data, v, local, shown), 0) });
  const net = m.net;
  return {
    localCurrency: local,
    displayCurrency: shown,
    salaryFrom: m.grossFrom,
    yearly: {
      gross: amt(m.gross),
      net: amt(net),
      tax: (m.tax?.lines ?? []).map((l) => ({ ...l, shown: roundOrNull(convert(data, l.amount, local, shown), 0) })),
      effectiveRate: m.tax ? round(m.tax.effectiveRate, 4) : null,
    },
    monthly: {
      net: amt(net === null ? null : net / 12),
      pension: amt(m.pension / 12),
      rent: amt(m.rent?.monthly ?? null),
      everyday: amt(m.everyday?.monthly ?? null),
      childcare: amt(m.childcare?.monthly ?? null),
      health: amt(m.health?.monthly ?? null),
      cost: amt(m.monthlyCost),
      left: amt(m.monthlyLeft),
    },
    earners: m.earners.map((e) => ({ label: e.label, gross: roundOrNull(e.gross, 0), salaryFrom: e.grossFrom, pension: round(e.pension, 0), net: roundOrNull(e.net, 0) })),
    filing: m.filing,
    regime: m.regime,
    completeness: m.completeness,
    incomplete: moneyGap(m),
    taxCompleteness: m.taxCompleteness,
    costCompleteness: m.costCompleteness,
    leftAtMost: (() => {
      const l = r.lines.find((x) => x.id === "money_left");
      const raw = profile.weights && l ? (l.basis ? null : l.raw) : null;
      return raw?.upperBound !== undefined ? round(raw.upperBound, 0) : moneyGap(m) && m.completeness.status === "partial" && m.display.monthlyLeft !== null ? round(m.display.monthlyLeft, 0) : null;
    })(),
    pensionRelief: m.pension > 0 ? pensionStatus(r.city.country) : null,
    regimes: m.regimes,
    paidChildcare: paidChildcare(profile),
    childcare: m.childcare ? { how: m.childcare.how, sources: m.childcare.resolved.map((x) => figureFromResolved(data, r.city, x)) } : null,
    health: m.health ? { how: m.health.how, sources: m.health.resolved.map((x) => figureFromResolved(data, r.city, x)) } : null,
    leave: {
      holidayDays: roundOrNull(m.leave.holiday, 1),
      holidayNote: m.leave.holidayNote,
      publicHolidays: m.leave.publicHolidays,
      mothersWeeks: m.leave.mothers,
      fathersWeeks: m.leave.fathers,
      value: amt(m.leave.value),
      sources: m.leave.resolved.map((x) => figureFromResolved(data, r.city, x)),
    },
    breakEven: r.breakEven
      ? { gross: amt(r.breakEven.gross), home: r.breakEven.home, targetMonthlyShown: round(r.breakEven.target, 0), vsCurrentPay: r.breakEven.current ? round((r.breakEven.gross - r.breakEven.current) / r.breakEven.current, 3) : null }
      : null,
    gaps: m.gaps,
    rentSource: m.rent ? figure(data, r.city, rentMetric(profile), m.rent.resolved) : null,
    everydayHow: m.everyday?.how ?? null,
    everydaySources: (m.everyday?.resolved ?? []).map((x) => figureFromResolved(data, r.city, x, "price_level")),
    runwayMonths: roundOrNull(m.runwayMonths, 1),
    taxModel: m.tax ? { country: m.tax.country, year: m.tax.year, caveats: m.tax.caveats, sources: m.tax.sources } : null,
    missing: m.missing,
  };
}

/** The line's label, with the person's own definition where the line has one (the nice-day range). */
function labelOf(profile: Profile, id: string, label: string): string {
  if (id !== "nice_days") return label;
  const c = profile.prefs.comfort;
  return `${label} (${c.min}-${c.max} °C ${(c.basis ?? "feels") === "air" ? "air" : "feels-like"}, 8 am-8 pm, dry and mostly clear)`;
}

function line(data: Dataset, profile: Profile, city: City, l: LineResult): Line {
  return {
    id: l.id,
    label: labelOf(profile, l.id, l.label),
    question: l.question,
    personal: l.personal,
    weight: l.weight,
    score: roundOrNull(l.score, 3),
    points: round(l.points, 2),
    value: l.raw.value,
    text: l.raw.text,
    approximate: !!l.raw.approximate,
    imputed: l.imputed,
    observed: l.observed,
    basis: l.basis,
    failed: l.failed,
    check: l.check,
    dealBreaker: profile.dealBreakers.includes(l.id),
    sources: l.raw.sources.map((s) => figureFromResolved(data, city, s, CRITERIA.find((c) => c.id === l.id)?.metric)),
  };
}

const pts = (n: number) => `${n.toFixed(1)} pts`;

/** Where a city stands out from the others compared, weighted by what the person cares about. */
function explain(r: CityResult, all: CityResult[]): string[] {
  const out: string[] = [];
  if (r.ruledOut.length) out.push(`Ruled out by your deal-breakers: ${r.ruledOut.join(", ")}.`);
  const leader = all[0]!;
  const deltas = r.lines
    .filter((l) => l.weight > 0 && l.score !== null)
    .map((l) => {
      const others = all.filter((o) => o !== r).map((o) => o.lines.find((x) => x.id === l.id)?.score).filter((v): v is number => typeof v === "number");
      const mean = others.length ? others.reduce((a, b) => a + b, 0) / others.length : l.score!;
      return { l, d: (l.score! - mean) * l.weight };
    });
  const ahead = deltas.filter((x) => x.d > 0.5).sort((a, b) => b.d - a.d).slice(0, 3);
  const behind = deltas.filter((x) => x.d < -0.5).sort((a, b) => a.d - b.d).slice(0, 3);
  if (ahead.length) out.push(`Ahead of the others on ${ahead.map((x) => `${x.l.label.toLowerCase()} (${x.l.raw.text})`).join(", ")}.`);
  if (behind.length) out.push(`Behind on ${behind.map((x) => `${x.l.label.toLowerCase()} (${x.l.raw.text})`).join(", ")}.`);
  if (r !== leader && !r.ruledOut.length) {
    const gaps = r.lines
      .map((l) => ({ l, gap: (leader.lines.find((x) => x.id === l.id)?.points ?? 0) - l.points }))
      .filter((x) => x.gap > 0.5)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 2);
    if (gaps.length) out.push(`Trails ${leader.city.name} by ${(leader.total - r.total).toFixed(1)} points, mostly on ${gaps.map((x) => `${x.l.label.toLowerCase()} (${pts(x.gap)})`).join(" and ")}.`);
  }
  if (r.unresolved.length) out.push(`Not known whether it passes ${r.unresolved.map((x) => x.toLowerCase()).join(" and ")}, a must-pass.`);
  const filled = r.lines.filter((l) => l.weight > 0 && l.imputed);
  if (filled.length) out.push(`No figure, so scored as the lowest of the cities that have one: ${filled.map((l) => l.label.toLowerCase()).join(", ")}.`);
  return out;
}

function whatToAdd(data: Dataset, profile: Profile, results: CityResult[]): string[] {
  const out: string[] = [];
  const names = (rs: CityResult[]) => rs.map((r) => r.city.name).join(", ");
  const lacking = (what: string) => results.filter((r) => r.money.missing.includes(what));
  if (lacking("salary").length) out.push("A gross yearly salary (one figure, or an offer per city) to compute take-home pay and money left.");
  if (!profile.income.everyday) out.push("Your monthly spending on everything except housing, and the city where you spend it today, to compute living costs.");
  if (!profile.household.length) out.push("The passports of everyone moving, to check who may live and work in each country.");
  const noPassport = profile.household.filter((p) => !p.citizenships.length).map((p) => p.label);
  if (noPassport.length) out.push(`Passports for ${noPassport.join(", ")}, to check who may live and work in each country.`);
  const noRent = lacking("rent");
  if (noRent.length)
    out.push(`Rent for ${names(noRent)}: no official figure yet; give your own as an override (${rentMetric(profile)}, monthly, local currency).`);
  const noTax = results.filter((r) => r.money.missing.some((x) => x.startsWith("a tax model")));
  const noFx = results.filter((r) => r.money.missing.some((x) => x.startsWith("an exchange rate")));
  if (noFx.length) out.push(`No exchange rate for ${[...new Set(noFx.map((r) => data.countries[r.city.country]?.currency ?? "?"))].join(", ")} (the ECB does not publish one), so money for ${names(noFx)} cannot be computed; nothing is guessed.`);
  if (noTax.length) out.push(`No take-home pay model yet for ${[...new Set(noTax.map((r) => data.countries[r.city.country]?.name ?? r.city.country))].join(", ")} (models: ${Object.keys(TAX_MODELS).join(", ")}).`);
  for (const c of CRITERIA) {
    if (!c.metric || weightOf(profile, c) === 0) continue;
    const gaps = results.filter((r) => !r.lines.find((x) => x.id === c.id)?.observed);
    if (gaps.length) out.push(`${c.label}: no open data yet for ${names(gaps)}; add your own number (${c.metric}) if you know it.`);
  }
  if (!profile.personal.length) out.push("Your own 1-5 lines for what no dataset knows (family nearby, a partner's job, a gut feeling).");
  return out;
}

/** Lines whose figures describe different periods across the cities compared: precision the inputs do not have. */
function periodNotes(cities: CityVerdict[]): string[] {
  const out: string[] = [];
  const ids = cities[0]?.lines.filter((l) => l.weight > 0 && !l.personal).map((l) => l.id) ?? [];
  for (const id of ids) {
    const per = new Map<string, string[]>();
    for (const c of cities) {
      const f = c.lines.find((l) => l.id === id)?.sources[0];
      if (f?.origin !== "source" || !f.period) continue;
      per.set(f.period, [...(per.get(f.period) ?? []), c.name]);
    }
    if (per.size > 1) {
      const label = cities[0]!.lines.find((l) => l.id === id)!.label;
      out.push(`${label}: the figures cover different periods (${[...per].map(([p, names]) => `${p} for ${names.join(", ")}`).join("; ")}), so small differences mean little.`);
    }
  }
  return out;
}

/** The basis money was compared on, as a sentence, when it is not the one asked for. */
function basisSentence(b: Evaluation["moneyBasis"]): string {
  if (!b || b.used === "money_left") return "";
  if (b.used === "net_pay") return " Money was compared on take-home pay only, without costs.";
  if (b.used === "cost") return " Money was compared on costs only, without pay.";
  return " Money is not in the score: no city has a figure every city can be compared on.";
}

/** "Lisbon, Berlin or 3 more". */
const orList = (names: string[]) => (names.length <= 1 ? names.join("") : names.length <= 3 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : `${names.slice(0, 2).join(", ")} or ${names.length - 2} more`);

function verdictOf(ranking: RankRow[], unresolvedNext: string | null, ev: Pick<Evaluation, "provisional" | "rivals" | "moneyBasis">): string {
  const base = verdictCore(ranking, unresolvedNext, ev.provisional ? orList(ev.rivals) : null);
  return `${base}${basisSentence(ev.moneyBasis)}`.replace(/\s+/g, " ").trim();
}

function verdictCore(ranking: RankRow[], unresolvedNext: string | null, rivals: string | null): string {
  const lead = ranking[0];
  if (!lead) return "No city to rank.";
  if (lead.status === "ruled out") return `Every city fails a must-pass; ${lead.name} fails least badly on your weights (${lead.total}/100).`;
  if (lead.status === "unknown")
    return `No city can be said to pass every must-pass yet. ${lead.name} scores highest (${lead.total}/100), but whether it passes ${lead.unresolved.map((x) => x.toLowerCase()).join(" and ")} is unknown${unresolvedNext ? `: ${unresolvedNext}` : ""}.`;
  if (ranking.length === 1) return `${lead.name} scores ${lead.total}/100 on your weights; add another city to compare.${lead.requestedCoverage < 0.7 ? ` Only ${Math.round(lead.requestedCoverage * 100)}% of the score rests on observed figures.` : ""}`;
  const second = ranking[1];
  const close = second && second.status === "passes" && lead.total - second.total < 2 ? ` ${second.name} is within ${(lead.total - second.total).toFixed(1)} points: a near tie.` : "";
  const thin = lead.requestedCoverage < 0.7 ? ` Only ${Math.round(lead.requestedCoverage * 100)}% of its score rests on observed figures.` : "";
  if (rivals) return `Provisional: ${lead.name} leads for now, ${lead.total}/100, but ${rivals} could still overtake it once the missing figures are known.${thin}`;
  return `${lead.name} ranks first on your weights, ${lead.total}/100.${close}${thin}`;
}

/** Compared cities that share a name are told apart by their country ("Cambridge, GB" and "Cambridge, US") everywhere the answer names them. */
export function withDistinctNames(data: Dataset, ids: string[]): Dataset {
  const compared = data.cities.filter((c) => ids.includes(c.id));
  const twice = new Set(compared.map((c) => c.name).filter((n, i, all) => all.indexOf(n) !== i));
  if (!twice.size) return data;
  return { ...data, cities: data.cities.map((c) => (ids.includes(c.id) && twice.has(c.name) ? { ...c, name: `${c.name}, ${c.country}` } : c)) };
}

export function compare(input: Dataset, args: QueryArgs): CompareReport {
  const { profile, assumptions } = buildProfile(input, args);
  const data = withDistinctNames(input, profile.cities);
  const ev = evaluate(data, profile);
  const cities = ev.results.map((r): CityVerdict => {
    const money = moneyBreakdown(data, profile, r);
    const lines = r.lines.map((l) => line(data, profile, r.city, l));
    return {
      id: r.city.id,
      name: r.city.name,
      country: r.city.country,
      rank: r.rank,
      total: round(r.total, 1),
      coverage: round(r.coverage, 2),
      requestedCoverage: round(r.requestedCoverage, 2),
      bounds: { low: round(r.bounds.low, 1), high: round(r.bounds.high, 1) },
      ruledOut: r.ruledOut,
      unresolved: r.unresolved,
      why: explain(r, ev.results),
      lines,
      money,
      rights: r.rights,
      missing: [...money.missing, ...(money.incomplete ? [money.incomplete] : []), ...lines.filter((l) => !l.observed && l.weight > 0).map((l) => l.label)],
    };
  });
  const ranking: RankRow[] = cities.map((c) => ({
    rank: c.rank,
    id: c.id,
    name: c.name,
    country: c.country,
    total: c.total,
    coverage: c.coverage,
    requestedCoverage: c.requestedCoverage,
    status: c.ruledOut.length ? "ruled out" : c.unresolved.length ? "unknown" : "passes",
    ruledOut: c.ruledOut,
    unresolved: c.unresolved,
    monthlyLeft: c.money.incomplete ? null : c.money.monthly.left.shown,
    ...(c.money.leftAtMost !== null ? { monthlyLeftAtMost: c.money.leftAtMost } : {}),
  }));
  const add = whatToAdd(data, profile, ev.results);
  // What would settle the leader's unknown must-pass comes first.
  const lead = cities[0];
  const leadNext = lead?.unresolved.length
    ? lead.lines.filter((l) => l.dealBreaker && l.check === "unknown").map((l) => `${l.label}: ${l.text}`).join("; ")
    : null;
  return {
    reportVersion: REPORT_VERSION,
    detail: "full",
    dataset: dsInfo(data),
    verdict: verdictOf(ranking, leadNext, ev),
    provisional: ev.provisional,
    provisionalReasons: ev.provisionalReasons,
    moneyBasis: ev.moneyBasis,
    notes: [...ev.notes, ...periodNotes(cities)],
    requiredUnknowns: cities.filter((c) => c.unresolved.length).map((c) => ({ id: c.id, name: c.name, lines: c.unresolved })),
    assumptions,
    ranking,
    cities,
    whatToAdd: add,
    displayCurrency: profile.displayCurrency,
    profile,
  };
}

// ---------- the compact compare, for agents ----------

export interface CompareSummary {
  reportVersion: string;
  detail: "summary";
  dataset: DatasetInfo;
  verdict: string;
  provisional: boolean;
  provisionalReasons: string[];
  moneyBasis: CompareReport["moneyBasis"];
  notes: string[];
  requiredUnknowns: CompareReport["requiredUnknowns"];
  /** What to add next, most useful first: the inputs that would settle an unknown or sharpen the ranking. */
  nextInputs: string[];
  assumptions: string[];
  displayCurrency: string;
  /** Every city ranked, or the top `limit`. */
  ranking: RankRow[];
  /** How many ranked cities are left out by `limit`. */
  moreCities: number;
  /** The lines that count (weighted, or must-pass), with who and when when every city's figure shares it. */
  lines: { id: string; label: string; weight: number; mustPass: boolean; cite?: string }[];
  /** The top `limit` cities in brief: each line's points and figure, money in the display currency, who can move there. */
  cities: {
    id: string;
    name: string;
    rank: number;
    total: number;
    coverage: number;
    /** Only when it differs from `coverage`: the share observed on each line's own basis. */
    requestedCoverage?: number;
    /** In the order of `lines`; `cite` only where it differs from the line's; `noFigure` when the city has none (scored as the lowest city). */
    lines: { id: string; points: number; text: string; noFigure?: true; check?: Check; cite?: string }[];
    money: {
      takeHomeYear: number | null;
      effectiveRate: number | null;
      takeHomeMonth: number | null;
      costMonth: number | null;
      leftMonth: number | null;
      /** Only with a partial figure: the most money left a month can be. */
      leftMonthAtMost?: number;
      regime: string | null;
      incomplete: string | null;
      /** Only with a pension share: how it is treated here. */
      pensionRelief?: string;
      /** Only when the household pays for no childcare. */
      paidChildcare?: false;
      missing: string[];
      gaps: string[];
    } | null;
    rights: (Omit<RightResult, "allowed" | "sources"> & { sources?: RightResult["sources"] })[];
  }[];
  /** The tax model's first official source, by country; detail "full" lists every one. */
  taxSources: Record<string, { label: string; url: string }[]>;
  /** Where the figures in these lines come from, once each. */
  sources: { id: string; name: string; licence: string; url: string }[];
}

/** The compact form of a comparison: enough to answer and to cite, small enough for a context window. */
/** The compact form's reasons for each described city: prose for the text answer, kept out of the structured one. */
export function summaryWhy(r: CompareReport, limit = 10): Record<string, string[]> {
  return Object.fromEntries(r.cities.slice(0, Math.max(1, limit)).map((c) => [c.id, c.why]));
}

export function summarize(r: CompareReport, opts: { limit?: number } = {}): CompareSummary {
  const limit = Math.max(1, opts.limit ?? 10);
  const top = r.cities.slice(0, limit);
  const salaryGiven = r.cities.some((c) => c.money.salaryFrom !== "none");
  const costsGiven = r.cities.some((c) => c.money.monthly.cost.shown !== null);
  const used = new Map<string, CompareSummary["sources"][number]>();
  const taxSources: CompareSummary["taxSources"] = {};
  for (const c of top) {
    for (const l of c.lines) if (l.weight > 0) for (const f of l.sources) if (f.origin === "source" && f.source) used.set(f.source.id, { id: f.source.id, name: f.source.name, licence: f.source.licence, url: f.source.url });
    if (c.money.taxModel && (salaryGiven || costsGiven)) taxSources[c.money.taxModel.country] ??= c.money.taxModel.sources.slice(0, 1);
  }
  // Lines that count for at least one city, and must-pass lines; a line no city has a figure for is in the notes.
  const counted = (top[0]?.lines ?? []).filter((l) => l.dealBreaker || (l.weight > 0 && r.cities.some((c) => c.lines.find((x) => x.id === l.id)?.score !== null)));
  const cites = new Map(counted.map((l) => {
    const all = new Set(top.map((c) => c.lines.find((x) => x.id === l.id)?.sources[0]?.cite));
    return [l.id, all.size === 1 ? [...all][0] : undefined];
  }));
  return {
    reportVersion: r.reportVersion,
    detail: "summary",
    dataset: r.dataset,
    verdict: r.verdict,
    provisional: r.provisional,
    provisionalReasons: r.provisionalReasons,
    moneyBasis: r.moneyBasis,
    notes: r.notes,
    requiredUnknowns: r.requiredUnknowns,
    nextInputs: r.whatToAdd,
    // "No salary given..." says again what nextInputs asks for; the full report keeps both.
    assumptions: r.assumptions.filter((a) => !/^No (passports|monthly spending|salary|household) given/.test(a)),
    displayCurrency: r.displayCurrency,
    ranking: r.ranking.slice(0, limit),
    moreCities: Math.max(0, r.ranking.length - limit),
    lines: counted.map((l) => ({ id: l.id, label: l.label, weight: l.weight, mustPass: l.dealBreaker, ...(cites.get(l.id) ? { cite: cites.get(l.id) } : {}) })),
    cities: top.map((c) => ({
      id: c.id,
      name: c.name,
      rank: c.rank,
      total: c.total,
      coverage: c.coverage,
      ...(c.requestedCoverage !== c.coverage ? { requestedCoverage: c.requestedCoverage } : {}),
      lines: counted.map(({ id }) => {
        const l = c.lines.find((x) => x.id === id)!;
        const cite = l.sources[0]?.cite;
        return { id, points: round(l.points, 1), text: l.text, ...(l.observed ? {} : { noFigure: true as const }), ...(l.dealBreaker ? { check: l.check } : {}), ...(cite && cite !== cites.get(id) ? { cite } : {}) };
      }),
      money:
        salaryGiven || costsGiven
          ? {
              takeHomeYear: c.money.yearly.net.shown,
              effectiveRate: c.money.yearly.effectiveRate,
              takeHomeMonth: c.money.monthly.net.shown,
              costMonth: c.money.monthly.cost.shown,
              leftMonth: c.money.incomplete ? null : c.money.monthly.left.shown,
              ...(c.money.leftAtMost !== null ? { leftMonthAtMost: c.money.leftAtMost } : {}),
              regime: c.money.regimes.length ? c.money.regimes.map((x) => `${x.name}${c.money.regimes.length > 1 || x.person !== c.money.earners[0]?.label ? ` (${x.person})` : ""}${x.status === "scenario" ? ", a scenario: conditions to confirm" : ""}`).join("; ") : null,
              incomplete: c.money.incomplete,
              ...(c.money.pensionRelief ? { pensionRelief: c.money.pensionRelief.text } : {}),
              ...(c.money.paidChildcare ? {} : { paidChildcare: false as const }),
              missing: c.money.missing,
              gaps: c.money.gaps,
            }
          : null,
      rights: c.rights.map(({ allowed: _, sources, ...x }) => (sources.length ? { ...x, sources } : x)),
    })),
    taxSources,
    sources: [...used.values()],
  };
}

// ---------- one city ----------

export interface CityReport {
  reportVersion: string;
  detail: Detail;
  dataset: DatasetInfo;
  /** Set when the name was read loosely: "Read "Lisboan" as Lisbon". */
  note: string | null;
  city: City;
  countryName: string;
  currency: string;
  /** Every figure, or those asked for; in summary, only figures with a value, and long series counted rather than listed. */
  figures: Figure[];
  daylight: { shortest: number; longest: number; monthly: number[] };
  taxModel: { country: string; year: number; scope: string } | null;
  rights: RightResult[];
  linksOut: LinkOut[];
  /** The sources behind these figures, once each. */
  sources: { id: string; name: string; publisher: string; licence: string; url: string }[];
}

/** A series longer than this is counted, not listed, in a summary. */
const SERIES_IN_SUMMARY = 24;

export function cityReport(data: Dataset, query: string, opts: { passports?: string[][]; metrics?: string[]; detail?: Detail } = {}): CityReport {
  const { city, note } = matchCity(data, query);
  const detail = opts.detail ?? "full";
  const country = data.countries[city.country];
  for (const m of opts.metrics ?? []) if (!data.metrics[m]) throw new Error(`Unknown metric "${m}". Metrics: ${Object.keys(data.metrics).join(", ")}.`);
  const ids = opts.metrics?.length ? opts.metrics : Object.keys(data.metrics);
  let figures = ids.map((id) => figure(data, city, id, resolve(data, null, city, id)));
  const sources = [...new Map(figures.filter((f) => f.source).map((f) => [f.source!.id, { id: f.source!.id, name: f.source!.name, publisher: f.source!.publisher, licence: f.source!.licence, url: f.source!.url }])).values()];
  if (detail === "summary") {
    // A figure with a value, its source as "who, when", and a long series counted rather than listed.
    // Figures asked for by name stay, with or without a value; otherwise only those with one.
    figures = figures
      .filter((f) => f.value !== null || !!opts.metrics?.length)
      .map((f): Figure => {
        const long = Array.isArray(f.value) && f.value.length > SERIES_IN_SUMMARY;
        return { metric: f.metric, label: f.label, unit: f.unit, value: long ? null : f.value, origin: f.origin, ...(f.cite ? { cite: f.cite } : {}), ...(f.approximate ? { approximate: true } : {}), ...(long ? { note: `${(f.value as number[]).length} values: ask with detail "full" for them` } : {}) };
      });
  }
  const model = taxModelFor(city.country);
  const household = (opts.passports ?? []).map((p, i) => ({ label: i === 0 ? "You" : `Person ${i + 1}`, citizenships: p.map((c) => c.toUpperCase()) }));
  return {
    reportVersion: REPORT_VERSION,
    detail,
    dataset: dsInfo(data),
    note,
    city,
    countryName: country?.name ?? city.country,
    currency: country?.currency ?? "",
    figures,
    daylight: { shortest: shortestDay(city.lat), longest: longestDay(city.lat), monthly: monthlyDaylight(city.lat) },
    taxModel: model ? { country: model.country, year: model.year, scope: model.scope } : null,
    rights: householdRights(data, household, city.country),
    linksOut: linksOut(city),
    sources,
  };
}

// ---------- take-home pay ----------

export interface NetPayArgs {
  /** ISO alpha-2 or country name; optional when `city` is given. */
  country?: string;
  /** A city id or name: sets the country, region and municipal taxes. */
  city?: string;
  /** ISO 3166-2 subdivision, e.g. "US-CA", "GB-SCT", "IT-21". */
  region?: string;
  gross: number;
  /** Currency of `gross`; defaults to the country's own. */
  currency?: string;
  tweak?: TaxTweak;
  displayCurrency?: string;
  /** Age in years, where the tax depends on it (youth relief, pension caps, care insurance). */
  age?: number;
  /** Children's ages, for child credits and allowances. */
  children?: number[];
  /** Share of gross paid into a pension, 0 to 0.5. */
  pension?: number;
  /** A newcomer regime id from the catalogue for this country: applied on top of `tweak`. */
  regime?: string;
  /** A second earner in the same city, in the same currency as `gross`. `spouse` asks for joint filing where the country has it. */
  partner?: { gross: number; age?: number; pension?: number; spouse?: boolean };
}

export interface NetPayReport {
  reportVersion: string;
  dataset: DatasetInfo;
  country: string;
  countryName: string;
  region: string | null;
  city: string | null;
  cityName: string | null;
  year: number;
  scope: string;
  currency: string;
  gross: number;
  net: number;
  monthlyNet: number;
  effectiveRate: number;
  lines: (TaxLine & { saving?: boolean })[];
  /** Paid into pensions a year: part of gross, not of take-home pay, and not a tax. */
  pension: number;
  /** Each person, when a partner is given. */
  people: { label: string; gross: number; pension: number; net: number }[] | null;
  filing: { mode: "individual" | "joint"; note: string | null } | null;
  regime: { id: string; name: string; status: "established" | "scenario"; unconfirmed: string[] } | null;
  /** How much of what is due the take-home figure holds (src/tax/common.ts Completeness). */
  completeness: Completeness;
  /** How a pension share is treated here, when one is set: relief modelled, none by law, or not modelled (saving only). */
  pensionRelief: { plan: string; status: PensionStatus; text: string } | null;
  shown: { currency: string; gross: number | null; net: number | null; monthlyNet: number | null } | null;
  caveats: string[];
  sources: { label: string; url: string }[];
}

function findCountry(data: Dataset, q: string): string {
  const f = q.trim().toLowerCase();
  const hit = Object.values(data.countries).find((c) => c.code.toLowerCase() === f || c.name.toLowerCase() === f);
  if (hit) return hit.code;
  if (f === "uk") return "GB";
  if (f === "usa") return "US";
  if (/^[a-z]{2}$/.test(f)) return f.toUpperCase();
  throw new Error(`Unknown country "${q}". Use an ISO alpha-2 code such as IT, GB, IE, US.`);
}

/** The checks every face runs on a take-home pay question before any tax is computed. */
export function netPayProblems(args: NetPayArgs): string[] {
  const out: string[] = [];
  const g = args.gross;
  if (typeof g !== "number" || !Number.isFinite(g) || g <= 0) out.push(`gross must be a yearly salary above 0; got ${JSON.stringify(g)}.`);
  else if (g > LIMITS.yearly) out.push(`gross looks like a typo: ${g.toLocaleString("en-GB")} is more than ${LIMITS.yearly.toLocaleString("en-GB")}.`);
  const pg = args.partner?.gross;
  if (args.partner && (typeof pg !== "number" || !Number.isFinite(pg) || pg < 0 || pg > LIMITS.yearly)) out.push(`partner.gross must be a yearly salary of 0 or more; got ${JSON.stringify(pg)}.`);
  for (const [v, what] of [[args.age, "age"], [args.partner?.age, "partner.age"]] as const) if (v !== undefined && !(Number.isInteger(v) && v >= 14 && v <= 110)) out.push(`${what} is whole years from 14 to 110; got ${v}.`);
  for (const a of args.children ?? []) if (!(Number.isFinite(a) && a >= 0 && a < 30)) out.push(`children are ages in years from 0 to 29; got ${a}.`);
  for (const [k, v] of Object.entries(args.tweak ?? {})) if ((k === "taxableShare" || k === "flatRate") && !(typeof v === "number" && v >= 0 && v <= 1)) out.push(`tweak.${k} is from 0 to 1; got ${v}.`);
  return out;
}

export function netPay(data: Dataset, args: NetPayArgs): NetPayReport {
  const problems = netPayProblems(args);
  if (problems.length) throw new Error(problems.join(" "));
  const city = args.city ? findCity(data, args.city) : null;
  const country = city ? city.country : args.country ? findCountry(data, args.country) : null;
  if (!country) throw new Error("Give a country or a city.");
  if (city && args.country && findCountry(data, args.country) !== city.country) throw new Error(`${city.name} is in ${data.countries[city.country]?.name ?? city.country}, not ${args.country}: give one or the other.`);
  if (args.currency && args.currency.toUpperCase() !== "EUR" && !data.fx.rates[args.currency.toUpperCase()]) throw new Error(`Unknown currency "${args.currency}": use an ISO 4217 code the ECB publishes, such as EUR, GBP, USD, CHF.`);
  const model = taxModelFor(country);
  if (!model) throw new Error(`No take-home pay model for ${data.countries[country]?.name ?? country} yet. Models: ${Object.values(TAX_MODELS).map((m) => `${m.country} (${m.year})`).join(", ")}.`);
  const currency = (args.currency ?? model.currency).toUpperCase();
  const gross = convert(data, args.gross, currency, model.currency);
  if (gross === null) throw new Error(`No exchange rate for ${currency}.`);
  const region = args.region ?? city?.region;
  const regime = args.regime ? regimeById(args.regime) : undefined;
  if (args.regime && (!regime || regime.country !== country)) throw new Error(`Unknown regime "${args.regime}" for ${country}. Regimes there: ${regimesFor(country).map((x) => x.id).join(", ") || "none modelled"}.`);
  if (regime && regime.currency !== model.currency) throw new Error(`The regime "${regime.id}" is set in ${regime.currency}, the tax model in ${model.currency}.`);
  for (const [v, what] of [[args.pension, "pension"], [args.partner?.pension, "partner.pension"]] as const) if (v !== undefined && !(v >= 0 && v <= 0.5)) throw new Error(`${what}: a share of gross from 0 to 0.5, got ${v}.`);
  const partnerGross = args.partner ? convert(data, args.partner.gross, currency, model.currency) : null;
  // A chosen regime is checked against the facts given: one they rule out is refused; one with conditions left to confirm is a scenario.
  const picked = regime ? chosenRegime(country, { gross, age: args.age, minorChildren: args.children?.filter((a) => a < 18).length }, regime.id) : null;
  if (picked?.status === "ruled out") throw new Error(`${picked.regime.name} does not apply, a condition is not met: ${picked.unmet.join("; ")}`);
  const h = householdTax(
    model,
    { region, city: city?.id },
    [
      { label: "You", gross, tweak: withRegime(args.tweak, regime, gross), age: args.age, children: args.children, pension: args.pension },
      ...(args.partner ? [{ label: "Partner", gross: partnerGross!, age: args.partner.age, pension: args.partner.pension, children: args.children, claimsChildren: false }] : []),
    ],
    !!args.partner?.spouse,
  );
  const r = h.combined;
  const shownCur = (args.displayCurrency ?? (currency !== model.currency ? currency : "")).toUpperCase();
  const toShown = (v: number) => roundOrNull(convert(data, v, model.currency, shownCur), 0);
  const extra = currency !== model.currency ? [`${args.gross.toLocaleString("en-GB")} ${currency} converted at the ECB rate of ${data.fx.date}.`] : [];
  return {
    reportVersion: REPORT_VERSION,
    dataset: dsInfo(data),
    country,
    countryName: data.countries[country]?.name ?? country,
    region: region ?? null,
    city: city?.id ?? null,
    cityName: city?.name ?? null,
    year: r.year,
    scope: model.scope,
    currency: model.currency,
    gross: r.gross,
    net: r.net,
    monthlyNet: round(r.net / 12, 2),
    effectiveRate: round(r.effectiveRate, 4),
    lines: r.lines,
    pension: round(h.people.reduce((a, p) => a + p.pension, 0), 2),
    people: args.partner ? h.people.map((p) => ({ label: p.label, gross: p.gross, pension: round(p.pension, 2), net: p.result.net })) : null,
    filing: args.partner ? h.filing : null,
    regime: picked ? { id: picked.regime.id, name: picked.regime.name, status: picked.status === "established" ? "established" : "scenario", unconfirmed: picked.unconfirmed } : null,
    completeness: r.completeness,
    pensionRelief: args.pension || args.partner?.pension ? pensionStatus(country) : null,
    shown: shownCur ? { currency: shownCur, gross: toShown(r.gross), net: toShown(r.net), monthlyNet: toShown(r.net / 12) } : null,
    caveats: [...r.caveats, ...extra],
    sources: r.sources,
  };
}

// ---------- what the dataset holds ----------

export interface Catalogue {
  dataset: DatasetInfo & { cities: number; observations: number };
  metrics: (Metric & { cities: number })[];
  sources: (Source & { observations: number })[];
  criteria: { id: string; label: string; question: string; category: string; metric: string | null; defaultWeight: number; worst: number; best: number; unit: string }[];
  presets: { id: string; label: string; weights: Record<string, number> }[];
  taxModels: { country: string; year: number; currency: string; scope: string }[];
  /** Newcomer tax regimes: pass an id in `regimes` (compare) or `regime` (net pay); answer a condition by its id in `household[].regimeConfirmations`. */
  regimes: { id: string; country: string; name: string; summary: string; years: number; conditions: { id: string; text: string; youConfirm: boolean }[] }[];
  linkOnly: string[];
  /** How a pension share is treated in each country: relief modelled (its base and cap), no relief by law, or not modelled (counted as saving). */
  pensions: { country: string; plan: string; status: PensionStatus; text: string; rule: string; source: string | null }[];
}

export const CATALOGUE_KINDS = ["criteria", "metrics", "sources", "taxModels", "regimes", "presets", "linkOnly", "pensions"] as const;
export type CatalogueKind = (typeof CATALOGUE_KINDS)[number];

const CRITERION_UNITS: Record<string, string> = {
  money_left: "EUR a month",
  living_cost: "EUR a month",
  right_to_live: "share of the household",
  nice_days: "days a year",
  winter_light: "hours",
};

/** One part of the catalogue, optionally for one country (tax models, regimes): a small discovery call. */
export function cataloguePart(data: Dataset, kind: CatalogueKind, country?: string): Partial<Catalogue> & { reportVersion: string; kind: CatalogueKind } {
  const c = catalogue(data);
  const cc = country?.toUpperCase();
  const part =
    kind === "pensions" ? c.pensions.filter((t) => !cc || t.country === cc)
    : kind === "taxModels" ? c.taxModels.filter((t) => !cc || t.country === cc)
    : kind === "regimes" ? c.regimes.filter((r) => !cc || r.country === cc)
    : kind === "sources" ? c.sources
    : c[kind];
  return { reportVersion: REPORT_VERSION, kind, dataset: c.dataset, [kind]: part };
}

export function catalogue(data: Dataset): Catalogue {
  const all = Object.values(data.observations).flat();
  const cityCount = (metric: string) => Object.values(data.observations).filter((l) => l.some((o) => o.metric === metric)).length;
  const reference: Profile = buildProfile(data, { cities: [data.cities[0]!.id], displayCurrency: "EUR" }).profile;
  return {
    dataset: { ...dsInfo(data), cities: data.cities.length, observations: all.length },
    metrics: Object.values(data.metrics).map((m) => ({ ...m, cities: cityCount(m.id) })),
    sources: Object.values(data.sources).map((s) => ({ ...s, observations: all.filter((o) => o.source === s.id).length })),
    criteria: CRITERIA.map((c) => {
      const [worst, best] = c.scale(reference, data);
      const unit = c.metric ? (data.metrics[c.metric]?.unit ?? "") : (CRITERION_UNITS[c.id] ?? "");
      // A position line's worst and best are distances from the person's stance, in the metric's unit.
      const position = c.position ? { stance: { min: c.position.min, max: c.position.max, step: c.position.step, ends: c.position.ends ?? null, levels: c.position.levels ?? null }, scoredBy: "distance from your stance" } : {};
      return { id: c.id, label: c.label, question: c.question, category: c.category, metric: c.metric ?? null, defaultWeight: c.defaultWeight, worst, best, unit, ...position };
    }),
    presets: PRESETS,
    taxModels: Object.values(TAX_MODELS).map((m) => ({ country: m.country, year: m.year, currency: m.currency, scope: m.scope })),
    regimes: REGIMES.map((r) => ({ id: r.id, country: r.country, name: r.name, summary: r.summary, years: r.years, conditions: r.conditions.map((c) => ({ id: c.id, text: c.text, youConfirm: c.kind === "confirm" })) })),
    linkOnly: LINK_ONLY,
    pensions: pensionPlans().map((x) => ({ ...x, rule: PENSION_RELIEF[x.country]!.note, source: PENSION_RELIEF[x.country]!.source?.url ?? null })),
  };
}
