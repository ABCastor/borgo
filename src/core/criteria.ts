import { clockGap, flightHours } from "./geo.ts";
import { cityById, resolve, scalar, series, type Resolved } from "./lookup.ts";
import { CHILDCARE_AGES, convert, describeMissing, paidChildcare, type MoneyResult } from "./money.ts";
import { householdRights, type RightResult } from "./rights.ts";
import { shortestDay } from "./sun.ts";
import type { City, ComfortBasis, Dataset, MetricCategory, Profile } from "./types.ts";
import { BIN_COUNT, niceDaysByMonth } from "./weather-days.ts";
import { highInRange } from "./world-map.ts";

/** Everything a criterion may look at for one city. */
export interface Context {
  data: Dataset;
  profile: Profile;
  city: City;
  money: MoneyResult;
  rights: RightResult[];
}

export interface Raw {
  value: number | null;
  /** Short human text for the value, e.g. "€1,240 a month" or "2 of 2 people". */
  text: string;
  sources: Resolved[];
  /** True when the value is a country-wide figure standing in for the city. */
  approximate?: boolean;
  /** True when the value covers only part of what the line asks (not everyone's passports given): it can fail a must-pass, never pass one. */
  partial?: boolean;
  /**
   * With no usable value, the most the value can be (money left with a cost that is due left out): it never scores,
   * but a must-pass it fails at that is failed for certain.
   */
  upperBound?: number;
}

/** Another figure a line can be scored on, for every compared city at once, when one of them lacks the line's own. */
export interface Fallback {
  /** A short id for the basis: "net_pay", "cost". */
  id: string;
  /** What the line is then scored on, in words: "take-home pay a month". */
  label: string;
  scale: (profile: Profile, data: Dataset) => [number, number];
  raw: (ctx: Context) => Raw;
}

/**
 * A scoring line. It turns data into one number per city, says which direction is better,
 * and where "worst" and "best" sit on an absolute scale.
 */
export interface Criterion {
  id: string;
  label: string;
  question: string; // what it answers, in plain words
  category: MetricCategory | "personal";
  /** [worst, best] in the raw value's unit, for absolute scoring. */
  scale: (profile: Profile, data: Dataset) => [number, number];
  raw: (ctx: Context) => Raw;
  /** The metric a person can override with their own number, when the line reads one metric. */
  metric?: string;
  /** Fails as a deal-breaker. Default: at or beyond the worst end of the scale. */
  fails?: (value: number) => boolean;
  defaultWeight: number;
  /** Counts only for a profile this holds for (childcare, only with children); otherwise its weight is 0. */
  applies?: (profile: Profile) => boolean;
  /**
   * Never filled in for a city that lacks it: when any compared city has no figure, every city is scored on the first
   * fallback they all have, or the line counts for none of them (money: an invented rent must not move a ranking).
   */
  sameBasis?: { fallbacks: Fallback[] };
  /**
   * A position, not a more-is-better line: the person says where they stand (`Profile.stances`) and a place scores by
   * how far it sits from them. The raw value is that distance; the text says what the place is.
   */
  position?: PositionSpec;
}

/** The scale a position line is stated on: a range with words at its ends, or named steps. */
export interface PositionSpec {
  min: number;
  max: number;
  step: number;
  /** Words for the two ends, for a continuous scale. */
  ends?: [string, string];
  /** Named steps, for a fact the law states in categories. */
  levels?: { value: number; label: string }[];
  /** How far apart counts as nothing in common: scores 0 and fails as a must-pass. */
  tolerance: number;
}

const fmt = (n: number, d = 0) => n.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d });

function money(n: number, cur: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${fmt(n)} ${cur}`;
  }
}

/**
 * Why a money figure cannot be used for scoring, else null. "complete" and "approximate" (every main component
 * modelled, with stated simplifications) are usable; "partial" (something due is left out, so the figure is too high)
 * and "unsupported" (no tax model here) are unknown, and money falls back to the same-basis line. `part` asks about
 * one figure: "net" (take-home pay) reads the tax's completeness, "cost" the costs left out of the month, "left" both.
 */
export function moneyGap(m: MoneyResult, part: "left" | "net" | "cost" = "left"): string | null {
  const { status, missing } = part === "left" ? m.completeness : part === "net" ? m.taxCompleteness : m.costCompleteness;
  if (status === "complete" || status === "approximate") return null;
  return `money here is ${status}${missing.length ? `: it leaves out ${missing.join("; ")}` : ""}`;
}

function eurScale(data: Dataset, profile: Profile, worst: number, best: number): [number, number] {
  return [convert(data, worst, "EUR", profile.displayCurrency) ?? worst, convert(data, best, "EUR", profile.displayCurrency) ?? best];
}

function metricLine(metric: string, unit: string, decimals = 0) {
  return (ctx: Context): Raw => {
    const r = resolve(ctx.data, ctx.profile, ctx.city, metric);
    const v = scalar(r);
    return {
      value: v,
      text: v === null ? "no data" : `${fmt(v, decimals)} ${unit}`.trim(),
      sources: r ? [r] : [],
      approximate: r ? r.level === "country" : undefined,
    };
  };
}

/** The city time zones and flights are measured from: the person's chosen home, else where they live now. */
export function homeCity(data: Dataset, profile: Profile): City | undefined {
  const e = profile.income.everyday;
  const id = profile.home ?? (e && !e.assumed ? e.homeCity : undefined);
  return id ? cityById(data, id) : undefined;
}

function hours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 60 ? `${hh + 1} h 00 min` : `${hh} h ${String(mm).padStart(2, "0")} min`;
}

/** A relaxed city cycling speed, for turning a distance into minutes. */
export const BIKE_KMH = 15;

/** A line that reads one metric where a niche signal is opt-in: weight 0 until the person turns it up. */
function optIn(id: string, metric: string, label: string, question: string, category: Criterion["category"], scale: [number, number], unit: string, decimals = 0): Criterion {
  return { id, metric, label, question, category, scale: () => scale, raw: metricLine(metric, unit, decimals), defaultWeight: 0 };
}

/** A line counting days a year that pass one weather test, from its monthly averages; opt-in at weight 0. */
function dayCount(id: string, metric: string, label: string, question: string, scale: [number, number]): Criterion {
  return {
    id,
    metric,
    label,
    question,
    category: "climate",
    scale: () => scale,
    raw: ({ data, profile, city }) => {
      const r = resolve(data, profile, city, metric);
      const v = series(r);
      if (!v) {
        // A person's own number for the metric is a yearly total.
        const own = scalar(r);
        return own === null ? { value: null, text: "no data", sources: [] } : { value: own, text: `${fmt(own)} days a year`, sources: [r!] };
      }
      const total = v.reduce((a, b) => a + b, 0);
      return { value: total, text: `${fmt(total)} days a year`, sources: [r!] };
    },
    defaultWeight: 0,
  };
}

/** The nice-day range a new profile starts with, on the feels-like temperature. Everyone sets their own. */
export const DEFAULT_COMFORT = { min: 18, max: 30, basis: "feels" } as const;

/** Nice days by month for this person's range and temperature, from the bins of dry, mostly clear days. */
export function niceDays(data: Dataset, profile: Profile, city: City): { months: number[]; resolved: Resolved } | null {
  const c = profile.prefs.comfort;
  const r = resolve(data, profile, city, (c.basis ?? "feels") === "air" ? "nice_bins_air" : "nice_bins_feels");
  const bins = series(r);
  if (!bins || bins.length !== 12 * BIN_COUNT) return null;
  return { months: niceDaysByMonth(bins, c.min, c.max), resolved: r! };
}

/**
 * The months whose average afternoon high is in the person's nice-day range, on the temperature their range is set on
 * (feels like by default; air when the city has no feels-like highs, and then `basis` says so). The test is the one the
 * map's land uses (`highInRange`), so a city reads the same way as the ground around it. Null without monthly highs.
 */
export function monthsInRangeOf(data: Dataset, profile: Profile, city: City): { months: boolean[]; count: number; basis: ComfortBasis } | null {
  const c = profile.prefs.comfort;
  const want: ComfortBasis = c.basis === "air" ? "air" : "feels";
  const feels = want === "feels" ? series(resolve(data, profile, city, "feels_high")) : null;
  const highs = feels?.length === 12 ? feels : series(resolve(data, profile, city, "temp_high"));
  if (!highs || highs.length !== 12) return null;
  const months = highs.map((h) => highInRange(h, c.min, c.max));
  return { months, count: months.filter(Boolean).length, basis: highs === feels ? "feels" : "air" };
}

/**
 * Brings a saved or shared profile up to date. A comfortable range without a basis is from before nice days, when it
 * meant a month's average temperature (12 to 24 by default): it becomes the nice-day default, and the weight of the old
 * "Comfortable months" line moves to "Nice days".
 */
export function upgradeProfile(p: Profile): Profile {
  // A saved profile that weighted same-sex couples as a more-is-better line, with no stance, reads it as a stance for
  // marriage, the end that line scored best. Nothing is assumed for a profile that did not weight it.
  if ((p.weights.couples_law ?? 0) > 0 && stanceOf(p, "couples_law") === undefined) p.stances = { ...p.stances, couples_law: 3 };
  if (!p.prefs.comfort.basis) {
    p.prefs = { ...p.prefs, comfort: { ...DEFAULT_COMFORT } };
    const old = p.weights.climate_comfort;
    if (old !== undefined) {
      const { climate_comfort: _, ...rest } = p.weights;
      p.weights = { ...rest, nice_days: rest.nice_days ?? old };
    }
    p.dealBreakers = p.dealBreakers.map((d) => (d === "climate_comfort" ? "nice_days" : d));
  }
  return p;
}

/** Where the person stands on a position line, if they said; never guessed. */
export function stanceOf(profile: Profile, id: string): number | undefined {
  const v = profile.stances?.[id];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * A position line over one metric: the place's figure, its distance from where the person stands, and a plain text.
 * Off (weight 0) by default; without a stance it has no score at all.
 */
function positionLine(o: { id: string; metric: string; label: string; question: string; spec: PositionSpec }): Criterion {
  return {
    id: o.id,
    metric: o.metric,
    label: o.label,
    question: o.question,
    category: "society",
    position: o.spec,
    // Without a stance there is nothing to measure distance from: the line takes no weight, whatever its dial says.
    applies: (p) => stanceOf(p, o.id) !== undefined,
    scale: () => [o.spec.tolerance, 0],
    raw: ({ data, profile, city }) => {
      const r = resolve(data, profile, city, o.metric);
      const v = scalar(r);
      const stance = stanceOf(profile, o.id);
      if (v === null) return { value: null, text: "no data", sources: r ? [r] : [] };
      const what = factText(o.metric, v) ?? fmt(v, 1);
      if (stance === undefined) return { value: null, text: `${what}; say where you stand`, sources: [r!], approximate: r!.level === "country" };
      return { value: Math.abs(v - stance), text: what, sources: [r!], approximate: r!.level === "country" };
    },
    defaultWeight: 0,
  };
}

const levelLabel = (levels: { value: number; label: string }[], v: number) => levels.find((l) => l.value === Math.round(v))?.label ?? `${v}`;

/**
 * Politics 0-10: a word for the nearest reference point, then the figure. The points are fixed: the mean ParlGov 2024
 * position of the parties Wikidata files under each political alignment, computed once (docs/positions.md). The word
 * names a point on the scale; it does not classify the place or its voters.
 */
export const POLITICS_WORDS: [number, string][] = [[1.4, "far left"], [2.1, "left"], [3.7, "centre-left"], [5.6, "centre"], [6.5, "centre-right"], [7.7, "right"], [8.5, "far right"]];
export function politicsWord(v: number): string {
  return POLITICS_WORDS.reduce((best, w) => (Math.abs(w[0] - v) < Math.abs(best[0] - v) ? w : best))[1];
}

export const ABORTION_LEVELS = [
  { value: 0, label: "Not allowed, or only to save her life" },
  { value: 1, label: "Also for her health, or after rape" },
  { value: 2, label: "Also on social or economic grounds" },
  { value: 3, label: "On request, first weeks only" },
  { value: 4, label: "On request, 10 weeks or later" },
];
export const COUPLES_LEVELS = [
  { value: 0, label: "Criminalised" },
  { value: 1, label: "Legal, no union in law" },
  { value: 2, label: "Civil union or partnership" },
  { value: 3, label: "Marriage" },
];

/** A position metric's figure in plain words ("centre-left, 4.6 of 10", "marriage"); null for any other metric. */
export function factText(metric: string, v: number): string | null {
  if (metric === "politics_lr") return `${politicsWord(v)}, ${fmt(v, 1)} of 10`;
  if (metric === "abortion_law") return levelLabel(ABORTION_LEVELS, v).toLowerCase();
  if (metric === "same_sex_couples") return levelLabel(COUPLES_LEVELS, v).toLowerCase();
  return null;
}

/**
 * A figure said in words where its number alone reads wrong: a position or a law ("on request, 10 weeks or later"),
 * a yes-or-no figure ("yes", "no chapter" for a unit "1 = a chapter"), and one of a countable thing ("1 organisation").
 * Null when the number and its unit read well as they are.
 */
export function figureWords(metric: { id: string; unit: string }, v: number): string | null {
  const words = factText(metric.id, v);
  if (words) return words;
  const flag = /^1 = (.+)$/.exec(metric.unit);
  if (flag) return v >= 1 ? flag[1]! : flag[1] === "yes" ? "no" : `no ${flag[1]!.replace(/^an? /, "")}`;
  if (v === 1 && /^[a-z]+s$/.test(metric.unit)) return `1 ${metric.unit.replace(/ies$/, "y").replace(/s$/, "")}`;
  return null;
}

export const CRITERIA: Criterion[] = [
  {
    id: "money_left",
    label: "Money left each month",
    question: "After tax, rent and everyday spending, what do you keep?",
    category: "money",
    scale: (p, d) => eurScale(d, p, -1_000, 4_000),
    raw: ({ money: m }) => {
      const gap = moneyGap(m);
      const v = gap ? null : m.display.monthlyLeft;
      // A partial figure leaves out something due, so the real one is lower: it cannot score, but below zero it is a
      // failed must-pass whatever the missing part turns out to be.
      const bound = gap && m.completeness.status === "partial" && m.display.monthlyLeft !== null ? m.display.monthlyLeft : undefined;
      return {
        value: v,
        text: v === null ? (bound !== undefined ? `at most ${money(bound, m.display.currency)} a month; ${gap}` : (gap ?? (describeMissing(m.missing) || "no figure"))) : `${money(v, m.display.currency)} a month`,
        sources: [...(m.rent ? [m.rent.resolved] : []), ...(m.everyday?.resolved ?? [])],
        ...(bound !== undefined ? { upperBound: bound } : {}),
      };
    },
    fails: (v) => v < 0,
    defaultWeight: 20,
    sameBasis: {
      fallbacks: [
        {
          id: "net_pay",
          // Where basic health cover is bought outside pay (US, CH, NL) take-home pay still holds its premium, which
          // elsewhere came out of pay: so the premium comes off here too, and without it the figure is not comparable.
          label: "take-home pay less any compulsory health premium (rent and spending not counted)",
          scale: (p, d) => eurScale(d, p, 1_000, 8_000),
          raw: ({ data, money: m }) => {
            const prem = m.premium.due ? (m.premium.monthly === null ? null : convert(data, m.premium.monthly, m.localCurrency, m.display.currency)) : 0;
            const v = moneyGap(m, "net") || m.display.net === null || prem === null ? null : m.display.net / 12 - prem;
            const text = v !== null ? `${money(v, m.display.currency)} take-home a month${m.premium.due ? ", after your health premium" : ""}` : m.premium.due && m.premium.monthly === null && m.display.net !== null ? "Add the health premium you pay outside pay" : "no take-home pay";
            return { value: v, text, sources: [] };
          },
        },
        {
          id: "cost",
          label: "cost a month (pay not counted)",
          scale: (p, d) => eurScale(d, p, 4_500, 1_000),
          raw: ({ money: m }) => {
            const v = moneyGap(m, "cost") ? null : m.display.monthlyCost;
            return { value: v, text: v === null ? "no cost figure" : `${money(v, m.display.currency)} a month in costs`, sources: [...(m.rent ? [m.rent.resolved] : []), ...(m.everyday?.resolved ?? [])] };
          },
        },
      ],
    },
  },
  {
    id: "living_cost",
    label: "Cost of living",
    question: "What does a month cost you there, rent included?",
    category: "money",
    scale: (p, d) => eurScale(d, p, 4_500, 1_000),
    raw: ({ money: m }) => {
      const gap = moneyGap(m, "cost");
      const v = gap ? null : m.display.monthlyCost;
      return {
        value: v,
        text: v === null ? (gap ?? (describeMissing(m.missing.filter((x) => x === "rent" || x === "everyday costs" || x === "childcare")) || "no figure")) : `${money(v, m.display.currency)} a month`,
        sources: [...(m.rent ? [m.rent.resolved] : []), ...(m.everyday?.resolved ?? [])],
      };
    },
    // Money left already counts every cost, so by default this line explains it rather than scoring it a second time.
    defaultWeight: 0,
    sameBasis: { fallbacks: [] },
  },
  {
    id: "right_to_live",
    label: "Everyone can move there",
    question: "Can every person in your household live and work there without a visa?",
    category: "access",
    scale: () => [0, 1],
    raw: ({ rights }) => {
      if (rights.length === 0) return { value: null, text: "add your passport", sources: [] };
      const n = rights.length;
      const unknown = rights.filter((r) => r.status === "unknown");
      const ok = rights.filter((r) => r.status === "yes").length;
      const noun = n === 1 ? "person" : "people";
      if (!unknown.length) return { value: ok / n, text: `${ok} of ${n} ${noun}`, sources: [] };
      const notChecked = `${unknown.map((r) => r.person).join(", ")} not checked: add passports`;
      // Someone known cannot move there: the line fails whoever else is unknown, scored as if they could not either.
      // Between `ok` (nobody unchecked can) and `ok` plus the unchecked (all of them can), and below everyone either way.
      if (ok < n - unknown.length) return { value: ok / n, text: `${ok} to ${ok + unknown.length} of ${n} ${noun}; ${notChecked}`, sources: [], partial: true };
      return { value: null, text: unknown.length === n ? "not checked: add passports" : `${ok} of ${n - unknown.length} checked; ${notChecked}`, sources: [] };
    },
    fails: (v) => v < 1,
    defaultWeight: 15,
  },
  {
    id: "nice_days",
    label: "Nice days",
    question: "How many days a year are dry, mostly clear and feel the way you like?",
    category: "climate",
    scale: () => [20, 220],
    raw: ({ data, profile, city }) => {
      const n = niceDays(data, profile, city);
      if (!n) return { value: null, text: "no data", sources: [] };
      const total = n.months.reduce((a, b) => a + b, 0);
      return { value: total, text: `${fmt(total)} nice days a year`, sources: [n.resolved] };
    },
    defaultWeight: 8,
  },
  {
    id: "winter_light",
    label: "Winter daylight",
    question: "How long is the shortest day of the year?",
    category: "climate",
    scale: () => [6, 11],
    raw: ({ city }) => {
      const h = shortestDay(city.lat);
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      return { value: h, text: `${hh} h ${String(mm).padStart(2, "0")} min`, sources: [] };
    },
    defaultWeight: 4,
  },
  {
    id: "sunshine",
    metric: "sunshine_hours",
    label: "Sunshine",
    question: "How many hours of sunshine in a year?",
    category: "climate",
    scale: () => [1_300, 3_000],
    raw: metricLine("sunshine_hours", "h a year"),
    defaultWeight: 4, // measured at stations (WMO normals, Meteostat); ERA5 sunshine overstates by 30-90% and is never used
  },
  {
    id: "dry_days",
    metric: "wet_days",
    label: "Dry days",
    question: "How many days a year does it rain?",
    category: "climate",
    scale: () => [180, 40],
    raw: metricLine("wet_days", "wet days a year"),
    defaultWeight: 3,
  },
  {
    id: "clean_air",
    metric: "pm25",
    label: "Clean air",
    question: "How much fine dust (PM2.5) is in the air over a year?",
    category: "environment",
    scale: () => [35, 5], // 5 µg/m³ is the WHO 2021 annual guideline
    raw: metricLine("pm25", "µg/m³", 1),
    defaultWeight: 8,
  },
  {
    id: "safety",
    metric: "homicide_rate",
    label: "Safety",
    question: "How rare is violent death (homicides per 100,000 people a year)?",
    category: "safety",
    scale: () => [10, 0.5],
    raw: metricLine("homicide_rate", "homicides per 100k", 1),
    defaultWeight: 6,
  },
  {
    id: "long_life",
    metric: "life_expectancy",
    label: "Long, healthy lives",
    question: "How long do people live there?",
    category: "health",
    scale: () => [72, 85],
    raw: metricLine("life_expectancy", "years", 1),
    defaultWeight: 5,
  },
  {
    id: "health_costs",
    label: "Health costs",
    question: "What does your household pay for health care itself each month?",
    category: "health",
    scale: (p, d) => eurScale(d, p, 400, 0),
    raw: ({ data, money: m }) => {
      if (!m.health) return { value: null, text: "no data", sources: [] };
      const v = convert(data, m.health.monthly, m.localCurrency, m.display.currency);
      return { value: v, text: v === null ? "no exchange rate" : `${money(v, m.display.currency)} a month`, sources: m.health.resolved, approximate: true };
    },
    defaultWeight: 0,
  },
  {
    id: "childcare",
    label: "Childcare costs",
    question: "What does full-time childcare cost you each month, after public support?",
    category: "money",
    applies: (p) => paidChildcare(p) && (p.children ?? []).some((a) => a >= CHILDCARE_AGES.from && a < CHILDCARE_AGES.below),
    scale: (p, d) => eurScale(d, p, 1_500, 0),
    raw: ({ data, money: m }) => {
      if (!m.childcare) return m.completeness.missing.some((o) => o.startsWith("childcare")) ? { value: null, text: "no data", sources: [] } : { value: 0, text: "no child of childcare age", sources: [] };
      const v = convert(data, m.childcare.monthly, m.localCurrency, m.display.currency);
      return { value: v, text: v === null ? "no exchange rate" : `${money(v, m.display.currency)} a month`, sources: m.childcare.resolved, approximate: true };
    },
    defaultWeight: 6,
  },
  {
    id: "family_leave",
    label: "Paid leave for parents",
    question: "How many weeks of fully paid leave do a mother and a father get between them?",
    category: "society",
    applies: (p) => (p.children ?? []).length > 0,
    scale: () => [10, 80],
    raw: ({ data, profile, city }) => {
      const a = resolve(data, profile, city, "leave_mothers");
      const b = resolve(data, profile, city, "leave_fathers");
      const va = scalar(a);
      const vb = scalar(b);
      if (va === null || vb === null) return { value: null, text: "no data", sources: [a, b].filter((x): x is Resolved => !!x) };
      return { value: va + vb, text: `${fmt(va + vb)} weeks (mother ${fmt(va)}, father ${fmt(vb)})`, sources: [a!, b!], approximate: true };
    },
    defaultWeight: 4,
  },
  {
    id: "happiness",
    metric: "life_evaluation",
    label: "Happiness",
    question: "How do people there rate their own lives, 0 to 10?",
    category: "society",
    scale: () => [4.5, 7.8],
    raw: metricLine("life_evaluation", "of 10", 2),
    defaultWeight: 5,
  },
  {
    id: "builders",
    metric: "builder_density",
    label: "Research output",
    question: "How much research and invention happens around you, per resident?",
    category: "opportunity",
    scale: () => [0, 100],
    raw: metricLine("builder_density", "of 100"),
    defaultWeight: 12,
  },
  // Opt-in lines: they start at weight 0 and only count once the person cares about them.
  {
    id: "time_zone",
    label: "Time difference from home",
    question: "How many hours apart are the clocks there and at home?",
    category: "mobility",
    scale: () => [9, 0],
    raw: ({ data, profile, city }) => {
      const home = homeCity(data, profile);
      if (!home?.tz || !city.tz) return { value: null, text: home ? "no time zone" : "set your home city", sources: [] };
      const g = clockGap(home.tz, city.tz);
      const text = g.january === g.july ? `${g.january} h from ${home.name}` : `${g.january} h in January, ${g.july} h in July from ${home.name}`;
      return { value: g.typical, text, sources: [] };
    },
    defaultWeight: 0,
  },
  {
    id: "flight_home",
    label: "Flight home",
    question: "How long is a nonstop flight home?",
    category: "mobility",
    scale: () => [13, 1],
    raw: ({ data, profile, city }) => {
      const home = homeCity(data, profile);
      if (!home) return { value: null, text: "set your home city", sources: [] };
      const h = flightHours(home, city);
      return { value: h, text: h === 0 ? `you are home` : `about ${hours(h)} to ${home.name}, nonstop`, sources: [] };
    },
    defaultWeight: 0,
  },
  optIn("airport", "airport_km", "Airport nearby", "How far is the nearest major airport?", "mobility", [60, 10], "km"),
  optIn("public_transport", "transit_commute_share", "Public transport", "What share of commuters take the bus, tram, metro or train?", "mobility", [5, 55], "% of commuters"),
  optIn("rail", "rail_stations", "Rail and metro stations", "How many train and metro stations are within 10 km of the centre?", "mobility", [10, 250], "stations"),
  optIn("short_commute", "commute_minutes", "Short commutes", "How long does the average journey to work take?", "mobility", [45, 20], "minutes"),
  optIn("cycling", "bike_network", "Cycle network", "How many km of cycle paths and separated cycle tracks are there per km² of land around the centre?", "mobility", [0.2, 3.5], "km per km²", 2),
  optIn("walkable", "walkable_share", "Everyday needs on foot", "From what share of streets are a food shop, a pharmacy, a school, a park and a stop all within about 15 minutes' walk?", "mobility", [50, 100], "% of streets"),
  optIn("active_commute", "active_commute_share", "Walking and cycling to work", "What share of commuters walk or cycle to work?", "mobility", [3, 40], "% of commuters", 1),
  {
    ...optIn("way_out", "city_edge_km", "Quick way out by bike", "How far does a cyclist ride from the centre before the dense city ends?", "mobility", [20, 1], "km", 1),
    raw: (ctx) => {
      const r = metricLine("city_edge_km", "km", 1)(ctx);
      if (r.value === null) return r;
      const minutes = Math.round((r.value / BIKE_KMH) * 60);
      return { ...r, text: r.value === 0 ? "the centre is outside the dense city" : `${fmt(r.value, 1)} km, about ${minutes} min by bike` };
    },
  },
  optIn("sea", "sea_km", "Near the sea", "How far is the sea?", "environment", [200, 3], "km"),
  optIn("mountains", "mountain_km", "Near the mountains", "How far are the mountains (ground 1,000 m above the city)?", "environment", [300, 20], "km"),
  optIn("green", "green_space_10km", "Green space", "How much of the land around the centre is park, wood or other green space?", "environment", [5, 40], "% of land", 1),
  optIn("internet", "download_mbps", "Fast internet", "How fast are typical internet connections?", "opportunity", [20, 90], "Mbit/s"),
  optIn("english", "english_share", "English spoken", "What share of people speak English?", "society", [20, 98], "% speak English"),
  optIn("international", "foreign_born_share", "International crowd", "What share of residents were born abroad?", "society", [5, 45], "% born abroad", 1),
  optIn("doctors", "doctors", "Doctors", "How many doctors are there per 1,000 people?", "health", [1.5, 5], "per 1,000", 1),
  optIn("jobs", "unemployment", "Jobs", "What share of people who want work cannot find it?", "opportunity", [12, 3], "% unemployed", 1),
  optIn("degrees", "degree_share", "Graduates around", "What share of adults hold a degree or another qualification above school level?", "opportunity", [20, 65], "% of adults", 1),
  optIn("developers", "github_developers", "Developers around", "How many people per 1,000 residents name the city as their location on GitHub?", "opportunity", [3, 60], "per 1,000", 1),
  optIn("clean_government", "clean_government", "Clean government", "How well is corruption kept out of public life?", "society", [-0.5, 2], "of 2.5", 2),
  // Position lines: the person says where they stand; a place scores by how close it sits. Off until they do.
  positionLine({
    id: "politics",
    metric: "politics_lr",
    label: "Politics, left to right",
    question: "How close is the way the place votes to where you stand, from left to right?",
    spec: { min: 0, max: 10, step: 0.5, ends: ["Left", "Right"], tolerance: 3 },
  }),
  positionLine({
    id: "abortion",
    metric: "abortion_law",
    label: "Abortion law",
    question: "How close is the law on ending a pregnancy to the one you want?",
    spec: { min: 0, max: 4, step: 1, levels: ABORTION_LEVELS, tolerance: 2 },
  }),
  positionLine({
    id: "couples_law",
    metric: "same_sex_couples",
    label: "Same-sex couples in law",
    question: "How close is the law on same-sex couples to the one you want?",
    spec: { min: 0, max: 3, step: 1, levels: COUPLES_LEVELS, tolerance: 2 },
  }),
  {
    ...optIn("founders_run", "founders_running_club", "Founders Running Club", "Is there a Founders Running Club chapter?", "lifestyle", [0, 1], ""),
    raw: (ctx) => {
      const r = metricLine("founders_running_club", "")(ctx);
      return { ...r, text: r.value === null ? "no data" : r.value >= 1 ? "a chapter" : "no chapter" };
    },
  },
  optIn("coworking", "coworking", "Coworking spaces", "How many coworking spaces are within 10 km of the centre?", "lifestyle", [0, 100], "spaces"),
  optIn("climbing", "climbing_gyms", "Climbing gyms", "How many climbing gyms are within 10 km of the centre?", "lifestyle", [0, 15], "gyms"),
  optIn("swimming", "swimming_pools", "Swimming pools", "How many public pools are within 10 km of the centre?", "lifestyle", [0, 40], "pools"),
  // Weather-day scores (src/core/weather-days.ts): days a year, summed from the monthly counts.
  dayCount("beach", "beach_days", "Beach days", "How many days a year are hot, sunny and dry enough for the beach or a pool?", [0, 120]),
  dayCount("run_ride", "active_days", "Run or ride days", "On how many days is there a dry, calm, cool-to-mild window for a run or a ride?", [150, 340]),
  dayCount("muggy", "muggy_days", "Few muggy days", "How many days a year is the air sticky with humidity?", [150, 0]),
  dayCount("grey", "grey_days", "Few grey days", "How many days a year is the sky overcast through the day?", [150, 10]),
  dayCount("hot_nights", "hot_nights", "Cool nights for sleeping", "How many nights a year stay above 20 °C?", [150, 0]),
  dayCount("heat", "hot_days", "Few heat-stress days", "How many days a year feel 32 °C or hotter?", [120, 0]),
  dayCount("snow", "snow_days", "Few snow days", "How many days a year bring fresh snow?", [30, 0]),
  dayCount("wind", "windy_days", "Few windy days", "How many days a year are windy through the day?", [80, 0]),
];

export function criterionById(id: string): Criterion | undefined {
  return CRITERIA.find((c) => c.id === id);
}

export function rightsFor(data: Dataset, profile: Profile, city: City): RightResult[] {
  return householdRights(data, profile.household, city.country);
}
