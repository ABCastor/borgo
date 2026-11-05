import { CRITERIA, rightsFor, type Criterion, type Raw } from "./criteria.ts";
import { cityById } from "./lookup.ts";
import { breakEven, homeCityOf, money, type BreakEven, type MoneyResult } from "./money.ts";
import type { RightResult } from "./rights.ts";
import type { City, Dataset, PersonalLine, Profile } from "./types.ts";

export interface LineResult {
  id: string;
  label: string;
  question: string;
  personal: boolean;
  raw: Raw;
  /** 0 (worst) to 1 (best); null when there is no data. */
  score: number | null;
  weight: number;
  /** Points this line adds to the city's total, out of 100. */
  points: number;
  /** Observed to fail as a must-pass (check === "fail"). */
  failed: boolean;
  /** As a must-pass: observed to pass, observed to fail, or unknown (no figure, or not everyone checked). */
  check: Check;
  /** No figure for this city: scored at the lowest score a compared city has on the line, or 0 (Preferences.missing). */
  imputed: boolean;
  /** Scored on an observed figure. Coverage counts only these, whatever the missing-data policy. */
  observed: boolean;
  /** Set when the line is scored on another basis for every city (money left on take-home pay). */
  basis: string | null;
}

export interface CityResult {
  city: City;
  total: number; // 0..100
  /** Share of the total weight scored on an observed figure for this city, on whatever basis each line was scored. */
  coverage: number;
  /**
   * Share of the total weight observed on each line's own basis: a line scored on a fallback (money left on take-home
   * pay) does not count, since its own figure is not known. Lower than `coverage` when the money basis changed.
   */
  requestedCoverage: number;
  /**
   * The lowest and highest total this city could have on the lines as asked, with every line it lacks at the lowest
   * and the highest score a compared city has on it (a partial money figure: no higher than its own bound).
   */
  bounds: { low: number; high: number };
  rank: number;
  lines: LineResult[];
  money: MoneyResult;
  /** The gross you would need here to keep what you keep where you live now; null at home or when a side lacks a figure. */
  breakEven: BreakEven | null;
  rights: RightResult[];
  /** Labels of the deal-breakers this city fails; empty when it passes. */
  ruledOut: string[];
  /** Labels of the deal-breakers nobody can say it passes yet (no figure, a passport not given). */
  unresolved: string[];
}

export interface Evaluation {
  /** Ranked: cities passing every must-pass, then those with one unknown, then those ruled out. */
  results: CityResult[];
  weightTotal: number;
  /** Plain sentences about how this set was scored: a line compared on another basis, or left out for every city. */
  notes: string[];
  /**
   * The money line asked for and the basis it was scored on for every city: "money_left" as asked, a fallback
   * ("net_pay", "cost"), or "none" when it counted for no city. Null when money left has no weight.
   */
  moneyBasis: { requested: "money_left"; used: "money_left" | "net_pay" | "cost" | "none" } | null;
  /**
   * True when the leader is not settled: a city ranked with it could still overtake it once its missing figures, its
   * partial money or money on the basis asked are known (CityResult.bounds overlap). `reasons` say what is missing.
   */
  provisional: boolean;
  /** What is missing that keeps the lead open, one sentence per line, naming the cities concerned. */
  provisionalReasons: string[];
  /** The cities that could still overtake the leader. */
  rivals: string[];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function personalCriterion(line: PersonalLine): Criterion {
  return {
    id: line.id,
    label: line.label,
    question: "Your own score, 1 to 5.",
    category: "personal",
    scale: () => [1, 5],
    raw: ({ city }) => {
      const v = line.scores[city.id];
      return { value: v ?? null, text: v === undefined ? "not scored yet" : `${v} of 5`, sources: [] };
    },
    defaultWeight: 10,
  };
}

/** The criteria in play for a profile: built-in ones plus the person's own lines. */
export function criteriaFor(profile: Profile): Criterion[] {
  return [...CRITERIA, ...profile.personal.map(personalCriterion)];
}

export function weightOf(profile: Profile, c: Criterion): number {
  if (c.applies && !c.applies(profile)) return 0;
  const w = profile.weights[c.id];
  return w === undefined ? c.defaultWeight : Number.isFinite(w) ? Math.min(100, Math.max(0, w)) : 0;
}

/**
 * The engine's version: scoring, money and the tax models together, the same as package.json's. Reports carry it, so
 * two answers can be told apart when the code that made them differs (test/engine.test.ts keeps the two in step).
 */
export const ENGINE_VERSION = "0.1.0";

/** The largest amounts the engine takes: beyond these an input is a typo, not a salary. */
export const LIMITS = { yearly: 100_000_000, monthly: 10_000_000, comfort: [-30, 50] as [number, number] };

/**
 * What is wrong with a profile, one plain sentence each, named by the field an agent or a terminal passes (salary,
 * spending, weights...). Every face checks here before it ranks: the agents' profile builder refuses a profile with
 * any problem; the app can show them beside the field. Empty when the profile is sound.
 */
export function profileProblems(p: Profile): string[] {
  const out: string[] = [];
  const amount = (v: unknown, what: string, max: number) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) out.push(`${what} must be a number of 0 or more; got ${JSON.stringify(v)}.`);
    else if (v > max) out.push(`${what} looks like a typo: ${v.toLocaleString("en-GB")} is more than ${max.toLocaleString("en-GB")}.`);
  };
  const share = (v: number | undefined, what: string) => {
    if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 0.5)) out.push(`${what} is a share of gross from 0 to 0.5 (0.05 = 5%); got ${v}.`);
  };
  amount(p.income.gross, "salary.amount", LIMITS.yearly);
  for (const [id, m] of Object.entries(p.income.perCity ?? {})) amount(m.gross, `salaryByCity.${id}.amount`, LIMITS.yearly);
  share(p.income.pension, "pension");
  p.household.forEach((h, i) => {
    if (!h.pay) return;
    amount(h.pay.gross, `household[${i}].salary.amount`, LIMITS.yearly);
    for (const [id, m] of Object.entries(h.pay.perCity ?? {})) amount(m.gross, `household[${i}].salaryByCity.${id}.amount`, LIMITS.yearly);
    share(h.pay.pension, `household[${i}].pension`);
  });
  if (p.income.everyday) amount(p.income.everyday.amount, "spending.amount (a month)", LIMITS.monthly);
  amount(p.income.savings ?? 0, "savings", LIMITS.yearly * 10);
  const ids = new Set(criteriaFor(p).map((c) => c.id));
  for (const [id, w] of Object.entries(p.weights)) {
    if (!ids.has(id)) out.push(`Unknown criterion "${id}" in weights. Criteria: ${[...ids].join(", ")}.`);
    else if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 100) out.push(`weights.${id} must be from 0 to 100; got ${JSON.stringify(w)}.`);
  }
  for (const id of p.dealBreakers) if (!ids.has(id)) out.push(`Unknown criterion "${id}" in dealBreakers. Criteria: ${[...ids].join(", ")}.`);
  const c = p.prefs.comfort;
  const [lo, hi] = LIMITS.comfort;
  if (!(Number.isFinite(c.min) && Number.isFinite(c.max)) || c.min < lo || c.max > hi) out.push(`comfort is a range in °C between ${lo} and ${hi}; got ${c.min} to ${c.max}.`);
  else if (c.min >= c.max) out.push(`comfort: min must be below max; got ${c.min} to ${c.max}.`);
  for (const a of p.children ?? []) if (!(Number.isFinite(a) && a >= 0 && a < 30)) out.push(`children are ages in years from 0 to 29; got ${a}.`);
  for (const l of p.personal) for (const [city, v] of Object.entries(l.scores)) if (!(Number.isFinite(v) && v >= 1 && v <= 5)) out.push(`Your line "${l.label}" scores 1 to 5; got ${v} for ${city}.`);
  // A cost (rent, a premium, childcare) is never below zero: a negative one would read as income.
  const cost = (m: string) => /^rent_|^health_premium$|^childcare_/.test(m);
  for (const [city, ms] of Object.entries(p.overrides))
    for (const [m, v] of Object.entries(ms)) {
      if (!Number.isFinite(v)) out.push(`overrides.${city}.${m} must be a number; got ${JSON.stringify(v)}.`);
      else if (cost(m) && v < 0) out.push(`overrides.${city}.${m} is a cost of 0 or more; got ${v}.`);
    }
  return out;
}

/** The per-city work that does not depend on which other cities are in the set: money, rights, raw values. */
interface Prepared {
  city: City;
  money: MoneyResult;
  rights: RightResult[];
  raws: Raw[];
  /** Each line's same-basis fallback figures, in order (money left: take-home pay, then cost); empty for other lines. */
  fallbacks: Raw[][];
  breakEven: BreakEven | null;
}

interface Setup {
  data: Dataset;
  profile: Profile;
  criteria: Criterion[];
  homeId: string | null;
  homeMoney: MoneyResult | null;
}

function setup(data: Dataset, profile: Profile): Setup {
  const homeId = homeCityOf(profile);
  const homeCity = homeId ? cityById(data, homeId) : undefined;
  return { data, profile, criteria: criteriaFor(profile), homeId, homeMoney: homeCity ? money(data, profile, homeCity) : null };
}

function prepare(s: Setup, city: City): Prepared {
  const { data, profile, homeId, homeMoney } = s;
  const m = city.id === homeId && homeMoney ? homeMoney : money(data, profile, city);
  const rights = rightsFor(data, profile, city);
  const ctx = { data, profile, city, money: m, rights };
  const raws = s.criteria.map((c) => c.raw(ctx));
  const fallbacks = s.criteria.map((c) => (c.sameBasis?.fallbacks ?? []).map((f) => f.raw(ctx)));
  const be = homeMoney && homeId ? breakEven(data, profile, city, homeMoney, homeId) : null;
  return { city, money: m, rights, raws, fallbacks, breakEven: be };
}

export function evaluate(data: Dataset, profile: Profile): Evaluation {
  const s = setup(data, profile);
  const cities = profile.cities.map((id) => cityById(data, id)).filter((c): c is City => !!c);
  return scoreSet(s, cities.map((c) => prepare(s, c)));
}

/**
 * Each candidate scored as if the person added it to their cities, with the numbers evaluate() would then give it
 * (missing data and relative scoring both depend on the set). Cities already chosen keep their own result.
 */
export function scoreCandidates(data: Dataset, profile: Profile, candidates: string[]): Map<string, CityResult> {
  const s = setup(data, profile);
  const chosen = profile.cities.map((id) => cityById(data, id)).filter((c): c is City => !!c).map((c) => prepare(s, c));
  const out = new Map<string, CityResult>();
  for (const r of scoreSet(s, chosen).results) out.set(r.city.id, r);
  for (const id of candidates) {
    if (out.has(id)) continue;
    const city = cityById(data, id);
    if (!city) continue;
    const r = scoreSet(s, [...chosen, prepare(s, city)]).results.find((x) => x.city.id === id);
    if (r) out.set(id, r);
  }
  return out;
}

/** How a line stands as a must-pass: observed to pass, observed to fail, or not known. */
export type Check = "pass" | "fail" | "unknown";

/** The policy for a city lacking a figure others have; "average" is read as "lowest" (a gap never scores above a city with data). */
export function missingPolicy(profile: Profile): "lowest" | "skip" | "worst" {
  const m = profile.prefs.missing;
  return m === "skip" || m === "worst" ? m : "lowest";
}

function checkOf(c: Criterion, raw: Raw, worst: number, best: number): Check {
  // No usable value, but the most it can be already fails: a missing part can only lower it further.
  if (raw.value === null && raw.upperBound !== undefined && best > worst && (c.fails ? c.fails(raw.upperBound) : raw.upperBound <= worst)) return "fail";
  if (raw.value === null) return "unknown";
  const fails = c.fails ? c.fails(raw.value) : best > worst ? raw.value <= worst : raw.value >= worst;
  if (fails) return "fail";
  return raw.partial ? "unknown" : "pass";
}

/** "Add your rent" for Zurich, said as the next thing the person can do. */
function nextFor(cityName: string, text: string): string {
  const lower = (t: string) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  if (!/^add /i.test(text)) return `${cityName}: ${lower(text)}`;
  // Each step said for this city, except spending: it is one figure, where you spend it now, scaled to every city.
  return text.split("; ").map((part) => (/^add your spending/i.test(part) ? lower(part) : `${lower(part)} for ${cityName}`)).join("; ");
}

/** "Zurich and Geneva", or "Tokyo, New York, Sydney and 48 more" for a long list. */
const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : names.length <= 4 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;

function scoreSet(s: Setup, prepared: Prepared[]): Evaluation {
  const { data, profile, criteria } = s;
  const policy = missingPolicy(profile);
  const notes: string[] = [];
  const weights = criteria.map((c) => weightOf(profile, c));
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  // Each line's basis for this set of cities: the raw values and scale it is scored on, and whether it counts at all.
  const plans = criteria.map((c, i) => {
    const [worst, best] = c.scale(profile, data);
    let raws = prepared.map((p) => p.raws[i]!);
    let scale: [number, number] = [worst, best];
    let basis: string | null = null;
    let basisId: string | null = null;
    let counts = true;
    const lacking = prepared.filter((p) => p.raws[i]!.value === null);
    const say = weights[i]! > 0 && prepared.length > 0;
    if (c.sameBasis && lacking.length) {
      // Money is never filled in: every city is compared on the same basis, or the line counts for none.
      const j = c.sameBasis.fallbacks.findIndex((_, j) => prepared.every((p) => p.fallbacks[i]![j]!.value !== null));
      const fb = j >= 0 ? c.sameBasis.fallbacks[j]! : null;
      const why = lacking.length === prepared.length ? "no city has a figure" : `${listNames(lacking.map((p) => p.city.name))} ${lacking.length === 1 ? "has" : "have"} no figure`;
      const texts = new Set(lacking.map((p) => p.raws[i]!.text));
      const first = lacking[0]!.raws[i]!.text;
      const next = lacking.length === prepared.length && texts.size === 1 ? first.charAt(0).toLowerCase() + first.slice(1) : nextFor(lacking[0]!.city.name, first);
      if (fb) {
        raws = prepared.map((p) => p.fallbacks[i]![j]!);
        scale = fb.scale(profile, data);
        basis = fb.label;
        basisId = fb.id;
        if (say) notes.push(`${c.label} is scored on ${fb.label} for every city, because ${why}: ${next}.`);
      } else {
        counts = false;
        // Say why its first stand-in could not stand in either (take-home pay where a health premium is still in it).
        const fb0 = c.sameBasis.fallbacks[0];
        const blocked = prepared.find((p) => p.fallbacks[i]![0]?.value === null);
        const short = fb0?.label.replace(/ (less|\().*$/, "") ?? "";
        const nor = fb0 && blocked && prepared.some((p) => p.fallbacks[i]![0]?.value !== null) ? ` ${short.charAt(0).toUpperCase()}${short.slice(1)} cannot stand in either: ${nextFor(blocked.city.name, blocked.fallbacks[i]![0]!.text)}.` : "";
        if (say) notes.push(`${c.label} is left out of the score for every city, because ${why}: ${next}.${nor}`);
      }
    } else if (policy === "skip" && lacking.length && lacking.length < prepared.length) {
      counts = false;
      if (say) notes.push(`${c.label} is left out for every city (missing: skip), because ${listNames(lacking.map((p) => p.city.name))} ${lacking.length === 1 ? "has" : "have"} no figure.`);
    }
    const values = raws.map((r) => r.value).filter((v): v is number => v !== null);
    if (!values.length && counts) {
      counts = false;
      const texts = [...new Set(raws.map((r) => r.text))];
      if (say) notes.push(`${c.label} counts for no city: none has a figure${texts.length === 1 ? ` (${texts[0]})` : ""}.`);
    }
    const scorer = scorerFor(profile, c, values, scale);
    const observed = values.map(scorer);
    // A gap is scored at the lowest score any compared city has on the line ("lowest"), or at 0 ("worst").
    const gapScore = policy === "worst" ? 0 : observed.length ? Math.min(...observed) : null;
    // The line as asked, on its own figures, for the bounds: each city's own score, or the range a gap could take.
    const own = prepared.map((p) => p.raws[i]!);
    const ownValues = own.map((r) => r.value).filter((v): v is number => v !== null);
    const ownScorer = scorerFor(profile, c, ownValues, [worst, best]);
    const ownObserved = ownValues.map(ownScorer);
    const range = (r: Raw): [number, number] | null => {
      if (r.value !== null) return [ownScorer(r.value), ownScorer(r.value)];
      if (!ownObserved.length) return c.sameBasis ? [0, r.upperBound !== undefined ? ownScorer(r.upperBound) : 1] : null;
      let lo = Math.min(...ownObserved, ...(policy === "worst" ? [0] : []));
      let hi = Math.max(...ownObserved);
      if (r.upperBound !== undefined) {
        const cap = ownScorer(r.upperBound);
        lo = Math.min(lo, cap);
        hi = Math.min(hi, cap);
      }
      return [lo, hi];
    };
    return { raws, scale, basis, basisId, counts, scorer, gapScore, worst, best, ranges: own.map(range) };
  });

  const results: CityResult[] = prepared.map((p, k) => {
    const lines: LineResult[] = criteria.map((c, i) => {
      const plan = plans[i]!;
      const raw = p.raws[i]!;
      const scored = plan.raws[k]!;
      let score: number | null = null;
      let imputed = false;
      if (plan.counts) {
        if (scored.value !== null) score = plan.scorer(scored.value);
        else if (plan.gapScore !== null) {
          score = plan.gapScore;
          imputed = true;
        }
      }
      const check = checkOf(c, raw, plan.worst, plan.best);
      return {
        id: c.id,
        label: c.label,
        question: c.question,
        personal: c.category === "personal",
        raw: plan.basis ? scored : raw,
        score,
        weight: weights[i]!,
        points: 0,
        failed: check === "fail",
        check,
        imputed,
        observed: plan.counts && scored.value !== null,
        basis: plan.basis,
      };
    });
    const scoredWeight = lines.reduce((s, l) => s + (l.score === null ? 0 : l.weight), 0);
    const observedWeight = lines.reduce((s, l) => s + (l.observed ? l.weight : 0), 0);
    const ownWeight = lines.reduce((s, l, i) => s + (p.raws[i]!.value !== null ? l.weight : 0), 0);
    for (const l of lines) l.points = l.score === null || scoredWeight === 0 ? 0 : (100 * l.weight * l.score) / scoredWeight;
    const total = lines.reduce((s, l) => s + l.points, 0);
    // The total on the lines as asked, with each gap at the ends of its range: what this city could score.
    let wSum = 0;
    let lo = 0;
    let hi = 0;
    lines.forEach((l, i) => {
      const r = plans[i]!.ranges[k];
      if (!l.weight || !r) return;
      wSum += l.weight;
      lo += l.weight * r[0];
      hi += l.weight * r[1];
    });
    const bounds = wSum > 0 ? { low: (100 * lo) / wSum, high: (100 * hi) / wSum } : { low: total, high: total };
    const must = lines.filter((l) => profile.dealBreakers.includes(l.id));
    return {
      city: p.city,
      total,
      coverage: weightTotal === 0 ? 0 : observedWeight / weightTotal,
      requestedCoverage: weightTotal === 0 ? 0 : ownWeight / weightTotal,
      bounds,
      rank: 0,
      lines,
      money: p.money,
      breakEven: p.breakEven,
      rights: p.rights,
      ruledOut: must.filter((l) => l.check === "fail").map((l) => l.label),
      unresolved: must.filter((l) => l.check === "unknown").map((l) => l.label),
    };
  });

  // Cities that pass every must-pass first, then those with one not known, then those ruled out.
  const tier = (r: CityResult) => (r.ruledOut.length ? 2 : r.unresolved.length ? 1 : 0);
  results.sort((a, b) => tier(a) - tier(b) || b.total - a.total);
  results.forEach((r, i) => (r.rank = i + 1));

  const mi = criteria.findIndex((c) => c.id === "money_left");
  const moneyBasis: Evaluation["moneyBasis"] =
    mi >= 0 && weights[mi]! > 0 && prepared.length ? { requested: "money_left", used: plans[mi]!.basisId ? (plans[mi]!.basisId as "net_pay" | "cost") : plans[mi]!.counts ? "money_left" : "none" } : null;
  const { provisional, reasons, rivals } = leaderSettled(criteria, weights, plans, prepared, results, tier);
  return { results, weightTotal, notes, moneyBasis, provisional, provisionalReasons: reasons, rivals };
}

/** How a line's values become 0..1 scores: on its absolute scale, or relative to the compared cities. */
function scorerFor(profile: Profile, c: Criterion, values: number[], scale: [number, number]): (v: number) => number {
  if (profile.prefs.normalise === "relative" && c.category !== "access" && c.category !== "personal" && values.length) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const higherBetter = scale[1] > scale[0];
    return (v) => (hi === lo ? 1 : clamp01(higherBetter ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)));
  }
  return (v) => (scale[1] === scale[0] ? 1 : clamp01((v - scale[0]) / (scale[1] - scale[0])));
}

/**
 * Whether a city ranked with the leader (the same must-pass standing) could overtake it once what is missing is known:
 * its highest possible total above the leader's lowest. The reasons name what is missing, for the cities concerned.
 */
function leaderSettled(
  criteria: Criterion[],
  weights: number[],
  plans: { basis: string | null; basisId: string | null; counts: boolean; ranges: ([number, number] | null)[] }[],
  prepared: Prepared[],
  results: CityResult[],
  tier: (r: CityResult) => number,
): { provisional: boolean; reasons: string[]; rivals: string[] } {
  const lead = results[0];
  const none = { provisional: false, reasons: [], rivals: [] };
  if (!lead || results.length < 2) return none;
  const rivals = results.filter((r) => r !== lead && tier(r) === tier(lead) && r.bounds.high > lead.bounds.low + 1e-9);
  if (!rivals.length) return none;
  const concerned = [lead, ...rivals];
  const at = (r: CityResult) => prepared.findIndex((p) => p.city.id === r.city.id);
  const reasons: string[] = [];
  criteria.forEach((c, i) => {
    if (!weights[i]) return;
    const plan = plans[i]!;
    const lacking = concerned.filter((r) => {
      const k = at(r);
      const range = plan.ranges[k];
      return !!range && range[1] - range[0] > 1e-9;
    });
    if (!lacking.length) return;
    const who = lacking.map((r) => r.city.name);
    const list = who.length <= 1 ? who.join("") : `${who.slice(0, -1).join(", ")} and ${who.at(-1)}`;
    if (c.sameBasis) {
      const partial = lacking.filter((r) => prepared[at(r)]!.raws[i]!.upperBound !== undefined).map((r) => r.city.name);
      reasons.push(`${c.label}: no whole figure for ${list}${partial.length ? ` (${partial.join(", ")}: something due is left out)` : ""}.`);
    } else reasons.push(`${c.label}: no figure for ${list}.`);
  });
  return { provisional: true, reasons, rivals: rivals.map((r) => r.city.name) };
}
