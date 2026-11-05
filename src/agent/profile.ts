// Builds a full engine Profile from the few arguments an agent or a terminal passes, and says which
// defaults it filled in, so nothing is assumed silently.
import { CRITERIA, DEFAULT_COMFORT } from "../core/criteria.ts";
import { profileProblems } from "../core/engine.ts";
import { METRICS } from "../core/metrics.ts";
import { PRESETS } from "../core/presets.ts";
import type { ComfortBasis, Dataset, HousingSize, Profile, TaxTweak } from "../core/types.ts";
import { REGIMES, regimeById, regimesFor } from "../tax/regimes.ts";
import { findCity, matchCity } from "./cities.ts";
import { monthlyFrom } from "../core/money.ts";

export interface Money {
  amount: number;
  /** ISO 4217; defaults to the display currency. */
  currency?: string;
}

/** Everything a comparison can be told. City keys may be ids or names, as for `cities`. */
export interface QueryArgs {
  cities: string[];
  preset?: string;
  /** Criterion id -> 0..100, applied on top of the preset. */
  weights?: Record<string, number>;
  /** Score only these criteria (ids): every other line gets weight 0. Each keeps its weight from `weights`, else 100. */
  only?: string[];
  /** One entry per person moving, you first: passports (ISO 3166 alpha-2) and, for anyone after you, their own pay. */
  household?: HouseholdArg[];
  /** Your gross yearly salary, used in every city. */
  salary?: Money;
  /** Share of your gross paid into a pension, 0 to 0.5 (0.05 = 5%). Pre-tax where the country gives relief. */
  pension?: number;
  /** Ages of the children moving with you: childcare for under-6s, child credits and allowances where the tax uses them. */
  children?: number[];
  /** Whether the household pays for childcare for children under 6 (default true). False: no childcare cost anywhere. */
  paidChildcare?: boolean;
  /** What your household actually pays for childcare in a city, after support, with its period: replaces the OECD reference figure. */
  childcareCost?: Record<string, PeriodAmount>;
  /** Your household's health insurance premium bought outside pay (US, CH, NL), by city, with its period. */
  healthPremium?: Record<string, PeriodAmount>;
  /** Newcomer tax regimes by country (ISO alpha-2): a regime id from the catalogue, or "none" to switch the default off. */
  regimes?: Record<string, string>;
  /** Gross yearly salary per city (offers or estimates); wins over `salary` for those cities. */
  salaryByCity?: Record<string, Money>;
  displayCurrency?: string;
  housing?: HousingSize;
  /** Monthly spending on everything except housing, childcare and health, where you live now. Scaled to each city by price levels. */
  spending?: Money & { homeCity?: string };
  savings?: number;
  /** Comfortable daytime temperature for a nice day, °C, on the feels-like temperature unless basis is "air". */
  comfort?: { min: number; max: number; basis?: ComfortBasis };
  normalise?: "absolute" | "relative";
  /** A city lacking a figure: "lowest" (default) scores it at the lowest compared city, "worst" at 0, "skip" drops the line for all. */
  missing?: "lowest" | "skip" | "worst" | "average";
  /** Your own numbers where you know better: city -> metric id -> value (money in the city's currency). */
  overrides?: Record<string, Record<string, number>>;
  /** Criterion ids that rule a city out when they fail. */
  dealBreakers?: string[];
  /** Your own 1-5 lines for what no dataset knows. */
  personal?: { label: string; scores: Record<string, number> }[];
  /** Tax tweaks by country (ISO alpha-2): special regimes, flat rates. */
  taxTweaks?: Record<string, TaxTweak>;
  /**
   * Where the person stands on the position lines (criterion id -> a number on the line's scale, or one of its named
   * steps): politics 0 left to 10 right; abortion and couples_law by step. Only what the person said: never infer it.
   */
  stances?: Record<string, number | string>;
}

/** A cost in the city's own currency with the period it was given for: a year's figure is counted as a twelfth a month. */
export interface PeriodAmount {
  amount: number;
  per: "month" | "year";
}

export interface HouseholdArg {
  label?: string;
  /** Passports if known (ISO alpha-2). Leave out to skip this person's right-to-live check: never guess them. */
  passports?: string[];
  /** Answers to newcomer-regime conditions no dataset can check, by condition id (list_metrics_and_sources, kind "regimes"): true or false. */
  regimeConfirmations?: Record<string, boolean>;
  /** Age in years: for age-dependent tax, pension caps, paid leave and newcomer regimes. */
  age?: number;
  /** Their gross yearly salary (not for the first person: use `salary`). */
  salary?: Money;
  /** Their gross per city, wins over `salary` for those cities. */
  salaryByCity?: Record<string, Money>;
  /** Their pension share, 0 to 0.5. */
  pension?: number;
  /** Married to the first person or in a registered partnership: joint filing where the country has it. */
  spouse?: boolean;
  relation?: "partner" | "cofounder" | "family";
  /** Whole years since they were last tax resident in a country (ISO alpha-2), or "never": for newcomer regimes. */
  yearsSinceResident?: Record<string, number | "never">;
  /** Newcomer regimes this person chose, by country (ISO alpha-2): a regime id, checked against this person's own facts. Not for the first person: use `regimes`. */
  regimes?: Record<string, string>;
}

export interface BuiltProfile {
  profile: Profile;
  /** Defaults that were filled in, in plain words. */
  assumptions: string[];
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function byCity<T>(data: Dataset, rec: Record<string, T> | undefined): Record<string, T> {
  return Object.fromEntries(Object.entries(rec ?? {}).map(([k, v]) => [findCity(data, k).id, v]));
}

export function presetWeights(id: string): Record<string, number> {
  const p = PRESETS.find((x) => x.id === id || slug(x.label) === slug(id));
  if (!p) throw new Error(`Unknown preset "${id}". Presets: ${PRESETS.map((x) => x.id).join(", ")}.`);
  return { ...p.weights };
}

const conditionIds = new Set(REGIMES.flatMap((r) => r.conditions.map((c) => c.id)));

export function buildProfile(data: Dataset, args: QueryArgs): BuiltProfile {
  const assumptions: string[] = [];
  if (!args.cities?.length) throw new Error("Give at least one city.");
  const matched = args.cities.map((q) => matchCity(data, q));
  for (const m of matched) if (m.note) assumptions.push(m.note);
  const cities = [...new Set(matched.map((m) => m.city.id))];
  const display = (args.displayCurrency ?? args.salary?.currency ?? "EUR").toUpperCase();
  if (!args.displayCurrency) assumptions.push(`Amounts are shown in ${display}.`);
  // Every currency a person gives must be one the exchange rates know: "EURO" is a typo, not a missing figure.
  const given = [args.salary, args.spending, ...Object.values(args.salaryByCity ?? {}), ...(args.household ?? []).flatMap((p) => [p.salary, ...Object.values(p.salaryByCity ?? {})])];
  for (const m of given) {
    const cur = m?.currency?.toUpperCase();
    if (cur && cur !== "EUR" && !data.fx.rates[cur]) throw new Error(`Unknown currency "${m!.currency}": use an ISO 4217 code the ECB publishes, such as EUR, GBP, USD, CHF.`);
  }
  if (display !== "EUR" && !data.fx.rates[display]) throw new Error(`No exchange rate for ${display} in the dataset: use an ISO 4217 code the ECB publishes, such as EUR, GBP, USD, CHF.`);

  // "Comfortable months" became "Nice days" (27 Oct 2026); an agent still sending the old id means the new line.
  if (args.weights && "climate_comfort" in args.weights) {
    const { climate_comfort, ...rest } = args.weights;
    args = { ...args, weights: { nice_days: climate_comfort!, ...rest } };
  }
  if (args.dealBreakers?.includes("climate_comfort")) args = { ...args, dealBreakers: args.dealBreakers.map((d) => (d === "climate_comfort" ? "nice_days" : d)) };
  const known = new Set([...CRITERIA.map((c) => c.id), ...(args.personal ?? []).map((l) => `you_${slug(l.label)}`)]);
  for (const id of [...Object.keys(args.weights ?? {}), ...(args.dealBreakers ?? [])])
    if (!known.has(id)) throw new Error(`Unknown criterion "${id}". Criteria: ${[...known].join(", ")}.`);
  for (const metrics of Object.values(args.overrides ?? {}))
    for (const m of Object.keys(metrics)) if (!METRICS[m]) throw new Error(`Unknown metric "${m}" in overrides. Metrics: ${Object.keys(METRICS).join(", ")}.`);
  let weights = { ...presetWeights(args.preset ?? "balanced"), ...(args.weights ?? {}) };
  if (args.only?.length) {
    for (const id of args.only) if (!known.has(id)) throw new Error(`Unknown criterion "${id}" in only. Criteria: ${[...known].join(", ")}.`);
    weights = Object.fromEntries([...known].map((id) => [id, args.only!.includes(id) ? (args.weights?.[id] ?? 100) : 0]));
    assumptions.push(`Only ${args.only.join(", ")} ${args.only.length === 1 ? "counts" : "count"}: every other line has weight 0.`);
  }
  const stances = parseStances(args.stances);
  for (const id of Object.keys(stances))
    if (!(weights[id] ?? 0)) assumptions.push(`You said where you stand on "${id}", but its weight is 0, so it does not count yet: give it a weight to use it.`);
  if (!args.preset && !args.weights && !args.only) assumptions.push("Weights are the balanced preset; set your own to make the ranking yours.");

  const share = (v: number | undefined, what: string) => {
    if (v === undefined) return undefined;
    if (!(v >= 0 && v <= 0.5)) throw new Error(`${what}: a share of gross from 0 to 0.5 (0.05 = 5%), got ${v}.`);
    return v || undefined;
  };
  const household: Profile["household"] = (args.household ?? []).map((p, i) => {
    if (i === 0 && (p.salary || p.salaryByCity)) throw new Error("The first person's pay is `salary` and `salaryByCity`, not a household field.");
    const perCity = Object.fromEntries(Object.entries(byCity(data, p.salaryByCity)).map(([id, m]) => [id, { gross: m.amount, currency: (m.currency ?? display).toUpperCase() }]));
    const hasPay = !!p.salary || Object.keys(perCity).length > 0;
    for (const id of Object.keys(p.regimeConfirmations ?? {}))
      if (!conditionIds.has(id)) throw new Error(`household[${i}].regimeConfirmations: unknown condition "${id}". Conditions are listed with each regime (list_metrics_and_sources, kind "regimes").`);
    const newcomer = {
      ...(p.age !== undefined ? { age: p.age } : {}),
      ...(p.yearsSinceResident ? { yearsSinceResident: Object.fromEntries(Object.entries(p.yearsSinceResident).map(([k, v]) => [k.toUpperCase(), v])) } : {}),
      ...(p.regimeConfirmations && Object.keys(p.regimeConfirmations).length ? { confirmed: { ...p.regimeConfirmations } } : {}),
    };
    if (i === 0 && p.regimes) throw new Error("The first person's regimes are `regimes`, not a household field.");
    const ownRegimes = Object.fromEntries(Object.entries(p.regimes ?? {}).map(([k, v]) => [k.toUpperCase(), v]));
    for (const [cc, id] of Object.entries(ownRegimes)) {
      if (id === "none") continue;
      const r = regimeById(id);
      if (!r || r.country !== cc) throw new Error(`household[${i}].regimes: unknown regime "${id}" for ${cc}. Regimes there: ${regimesFor(cc).map((x) => x.id).join(", ") || "none modelled"}.`);
    }
    const label = p.label ?? (i === 0 ? "You" : `Person ${i + 1}`);
    if (!p.passports?.length) assumptions.push(`No passports given for ${label === "You" ? "you" : label}, so ${label === "You" ? "your" : "their"} right to live and work there is not checked.`);
    return {
      label,
      citizenships: (p.passports ?? []).map((c) => c.toUpperCase()),
      ...(Object.keys(newcomer).length ? { newcomer } : {}),
      ...(i > 0 && p.spouse ? { spouse: true } : {}),
      ...(i > 0 ? { relation: p.relation ?? (p.spouse ? "partner" : "family") } : {}),
      ...(i > 0 && Object.keys(ownRegimes).length ? { regimes: ownRegimes } : {}),
      ...(i > 0 && hasPay
        ? { pay: { gross: p.salary?.amount ?? 0, currency: (p.salary?.currency ?? display).toUpperCase(), mode: Object.keys(perCity).length ? ("per-city" as const) : ("same" as const), perCity, pension: share(p.pension, `household[${i}].pension`) } }
        : {}),
    };
  });
  if (household.filter((p) => p.spouse).length > 1) throw new Error("Only one person can be the first person's spouse.");
  if (args.children?.length) {
    if (!args.children.every((a) => Number.isFinite(a) && a >= 0 && a < 30)) throw new Error("children: ages in years, e.g. [2, 7].");
    if (household[0]) household[0].newcomer = { ...household[0].newcomer, minorChildren: args.children.filter((a) => a < 18).length };
  }
  for (const [cc, id] of Object.entries(args.regimes ?? {})) {
    if (id === "none") continue;
    const r = regimeById(id);
    if (!r || r.country !== cc.toUpperCase()) throw new Error(`Unknown regime "${id}" for ${cc.toUpperCase()}. Regimes there: ${regimesFor(cc.toUpperCase()).map((x) => x.id).join(", ") || "none modelled"}.`);
  }
  if (!household.length) assumptions.push("No household given, so the right to live and work there is not checked.");
  if (household.some((p) => !p.citizenships.length) && (args.dealBreakers ?? []).includes("right_to_live"))
    assumptions.push("Who can move there is a must-pass, but not every passport is given: no city can pass it until they are.");

  const salaryByCity = Object.fromEntries(
    Object.entries(byCity(data, args.salaryByCity)).map(([id, m]) => [id, { gross: m.amount, currency: (m.currency ?? display).toUpperCase() }]),
  );
  const perCity = Object.keys(salaryByCity).length > 0;
  if (!args.salary && !perCity) assumptions.push("No salary given, so take-home pay and money left are not computed.");
  else if (perCity && args.salary) assumptions.push("Cities without their own salary use the single salary.");

  let everyday: Profile["income"]["everyday"] = null;
  if (args.spending) {
    const home = args.spending.homeCity ? findCity(data, args.spending.homeCity).id : cities[0]!;
    if (!args.spending.homeCity) assumptions.push(`Your spending is taken as what you spend in ${data.cities.find((c) => c.id === home)!.name} today.`);
    everyday = { amount: args.spending.amount, currency: (args.spending.currency ?? display).toUpperCase(), homeCity: home };
  } else {
    assumptions.push("No monthly spending given, so living costs and money left are not computed.");
  }
  if (!args.housing) assumptions.push("Rent is for a one-bedroom home.");

  // Costs given with their period become the monthly overrides money reads; a year's figure is said as a month.
  const overrides = byCity(data, args.overrides);
  const periodic = (rec: Record<string, PeriodAmount> | undefined, metric: string, what: string) => {
    for (const [id, v] of Object.entries(byCity(data, rec))) {
      if (!v || typeof v.amount !== "number" || !Number.isFinite(v.amount) || v.amount < 0) throw new Error(`${what}.${id}.amount must be a number of 0 or more; got ${JSON.stringify(v?.amount)}.`);
      if (v.per !== "month" && v.per !== "year") throw new Error(`${what}.${id}.per must be "month" or "year": say which the amount is for; got ${JSON.stringify(v.per)}.`);
      if (overrides[id]?.[metric] !== undefined) throw new Error(`${what}.${id} and overrides.${id}.${metric} both set it: give one.`);
      const monthly = monthlyFrom(v.amount, v.per);
      overrides[id] = { ...overrides[id], [metric]: monthly };
      const name = data.cities.find((c) => c.id === id)!.name;
      if (v.per === "year") assumptions.push(`${what} for ${name}: ${v.amount.toLocaleString("en-GB")} a year is counted as ${(Math.round(monthly * 100) / 100).toLocaleString("en-GB")} a month.`);
    }
  };
  periodic(args.healthPremium, "health_premium", "healthPremium");
  periodic(args.childcareCost, "childcare_cost", "childcareCost");
  if (args.paidChildcare === false && args.children?.some((a) => a < 6)) assumptions.push("No paid childcare: no childcare cost is counted for the children under 6.");

  const profile: Profile = {
    name: "",
    displayCurrency: display,
    cities,
    household,
    housing: { size: args.housing ?? "1bed" },
    income: {
      mode: perCity ? "per-city" : "same",
      gross: args.salary?.amount ?? 0,
      currency: (args.salary?.currency ?? display).toUpperCase(),
      perCity: salaryByCity,
      taxTweaks: Object.fromEntries(Object.entries(args.taxTweaks ?? {}).map(([k, v]) => [k.toUpperCase(), v])),
      everyday,
      savings: args.savings ?? 0,
      ...(share(args.pension, "pension") ? { pension: args.pension } : {}),
      ...(args.regimes ? { regimes: Object.fromEntries(Object.entries(args.regimes).map(([k, v]) => [k.toUpperCase(), v])) } : {}),
    },
    ...(args.children?.length ? { children: args.children.map(Math.floor) } : {}),
    ...(args.paidChildcare === false ? { paidChildcare: false } : {}),
    weights,
    personal: (args.personal ?? []).map((l) => ({ id: `you_${slug(l.label)}`, label: l.label, scores: byCity(data, l.scores) })),
    prefs: { comfort: args.comfort ? { basis: "feels", ...args.comfort } : { ...DEFAULT_COMFORT }, normalise: args.normalise ?? "absolute", missing: args.missing === "average" || !args.missing ? "lowest" : args.missing },
    overrides,
    dealBreakers: args.dealBreakers ?? [],
    ...(Object.keys(stances).length ? { stances } : {}),
  };
  const problems = profileProblems(profile);
  if (problems.length) throw new Error(problems.join(" "));
  if (args.missing === "average") assumptions.push('missing: "average" is read as "lowest": a city without a figure scores as the lowest compared city on that line, never above one that has it.');
  if (!args.comfort) assumptions.push(`Nice days are dry, mostly clear and feel ${DEFAULT_COMFORT.min} to ${DEFAULT_COMFORT.max} °C on average from 8 am to 8 pm.`);
  return { profile, assumptions };
}

/** Stances as numbers on each line's scale; a named step may be given by its label ("marriage", "on request, 10 weeks or later"). */
export function parseStances(raw: Record<string, number | string> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw ?? {})) {
    const c = CRITERIA.find((x) => x.id === id);
    if (!c?.position) throw new Error(`"${id}" is not a position line. Position lines: ${CRITERIA.filter((x) => x.position).map((x) => x.id).join(", ")}.`);
    const spec = c.position;
    let n = typeof v === "number" ? v : Number.isFinite(Number(v)) && String(v).trim() !== "" ? Number(v) : undefined;
    if (n === undefined && spec.levels) n = spec.levels.find((l) => slug(l.label) === slug(String(v)) || slug(l.label).startsWith(slug(String(v))))?.value;
    const steps = spec.levels ? spec.levels.map((l) => `${l.value} ${l.label}`).join("; ") : `${spec.min} ${spec.ends?.[0]} to ${spec.max} ${spec.ends?.[1]}`;
    if (n === undefined || !(n >= spec.min && n <= spec.max)) throw new Error(`stances.${id}: ${steps}; got ${JSON.stringify(v)}.`);
    out[id] = n;
  }
  return out;
}
