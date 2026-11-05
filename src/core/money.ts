import { completenessOf, mergeCompleteness, type Completeness } from "../tax/common.ts";
import { householdTax, type EarnerTax, type Filing, type HouseholdLine } from "../tax/household.ts";
import { taxModelFor, type TaxResult } from "../tax/index.ts";
import { chosenRegime, withRegime } from "../tax/regimes.ts";
import { resolve, scalar, type Resolved } from "./lookup.ts";
import type { City, Dataset, Pay, Profile } from "./types.ts";

export function convert(data: Dataset, amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  const r = data.fx.rates;
  const f = from === "EUR" ? 1 : r[from];
  const t = to === "EUR" ? 1 : r[to];
  if (!f || !t) return null;
  return (amount / f) * t;
}

/** One person's pay in a city. */
export interface EarnerMoney {
  label: string;
  /** Annual gross in local currency; null when it cannot be converted. */
  gross: number | null;
  grossFrom: "same" | "per-city" | "none";
  /** Paid into a pension a year, local currency. */
  pension: number;
  /** Take-home pay a year, local currency. */
  net: number | null;
  tax: (TaxResult & { lines: HouseholdLine[] }) | null;
  /** The newcomer regime counted for this person: only one they chose (MoneyResult.regime says how). */
  regime: RegimeUse | null;
}

/**
 * A newcomer regime counted for one person: only ever one they chose. "established" when their facts and answers meet
 * every condition; "scenario" while some are theirs to confirm (listed in `unconfirmed`): a conditional what-if, never
 * established eligibility. `byDefault` is always false: no regime counts without being chosen.
 */
export interface RegimeUse { id: string; name: string; years: number; byDefault: false; status: "established" | "scenario"; unconfirmed: string[]; person: string }

/** A monthly family cost: the figure, how it was worked out, and what it rests on. */
export interface FamilyCost {
  monthly: number;
  how: string;
  resolved: Resolved[];
}

/** Paid time off by law in the city's country, and what it is worth at the first earner's pay. */
export interface Leave {
  /** Paid holiday by law, working days a year (age-adjusted where the law does that). */
  holiday: number | null;
  holidayNote: string | null;
  publicHolidays: number | null;
  /** Weeks at full pay. */
  mothers: number | null;
  fathers: number | null;
  /** Holiday plus public holidays at the first earner's daily gross (260 working days); UK statutory leave already includes any bank holidays taken. */
  value: number | null;
  resolved: Resolved[];
}

export interface MoneyResult {
  localCurrency: string;
  /** Annual gross in local currency of everyone who earns, and how the first person's was set. */
  gross: number | null;
  grossFrom: "same" | "per-city" | "none";
  /** Everyone's tax together (one person: their own result). Lines carry the person's label when more than one earns. */
  tax: (TaxResult & { lines: HouseholdLine[] }) | null;
  /** Each earner: the first is you. */
  earners: EarnerMoney[];
  /** How a married couple is taxed here, when there is one. */
  filing: Filing | null;
  /** The first person's newcomer regime counted in this city (RegimeUse); every earner's is on `earners[].regime`. */
  regime: RegimeUse | null;
  /** Every earner's counted regime, first person first. */
  regimes: RegimeUse[];
  /** Annual take-home pay of the household in local currency (after tax and pension contributions). */
  net: number | null;
  /** Paid into pensions a year, local currency: the household's own savings, not a cost. */
  pension: number;
  rent: { monthly: number; resolved: Resolved } | null;
  everyday: { monthly: number; how: string; resolved: Resolved[] } | null;
  /** Childcare after public support, when children under 6 are moving. */
  childcare: FamilyCost | null;
  /** What the household pays for health care itself. */
  health: FamilyCost | null;
  /**
   * The compulsory health premium bought outside pay (US, CH, NL): `due` there, and the household's own figure a month
   * (local) when given. Where cover comes out of pay instead, take-home pay already holds it.
   */
  premium: { due: boolean; monthly: number | null };
  leave: Leave;
  monthlyCost: number | null; // local
  monthlyLeft: number | null; // local
  /** The same figures in the display currency. */
  display: { currency: string; net: number | null; monthlyCost: number | null; monthlyLeft: number | null };
  runwayMonths: number | null;
  /** What blocks a figure: without it there is no total. */
  missing: string[];
  /** Named gaps that do not block the total but leave something out of it. */
  gaps: string[];
  /**
   * How much of what is due the money figures hold: `taxCompleteness` and `costCompleteness` together. "partial" or
   * "unsupported" means a figure is too high to compare as whole, so scoring treats it as unknown (moneyGap in
   * criteria.ts); "complete" and "approximate" are usable. A regime counted as a scenario is listed in `approximations`.
   */
  completeness: Completeness;
  /** What take-home pay `net` holds: the tax's completeness, or "unsupported" with no tax model here. */
  taxCompleteness: Completeness;
  /** What `monthlyCost` holds: the compulsory costs left out of it (a health premium bought outside pay, childcare with no figure). */
  costCompleteness: Completeness;
}

/** What is missing from the money picture, said as what the person can do about it. */
export function describeMissing(missing: string[]): string {
  const parts = missing.map((x) =>
    x.startsWith("a tax model for ") ? `tax in ${x.slice("a tax model for ".length)} is not modelled yet` : x.startsWith("an exchange rate for ") ? `no exchange rate for ${x.slice("an exchange rate for ".length)} yet` : x === "rent" ? "add your rent" : x === "everyday costs" ? "add your spending" : x === "salary" ? "add a salary" : x === "childcare" ? "add your childcare cost" : x,
  );
  const s = parts.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function rentMetric(profile: Profile): string {
  return `rent_${profile.housing.size}`;
}

/** Countries where basic health cover is bought as a premium outside payroll, so a premium belongs in the budget. */
export const PREMIUM_HEALTH: Record<string, string> = {
  US: "Health insurance premiums (your share of an employer plan, or a Marketplace plan) are not included",
  CH: "Mandatory basic health insurance (KVG) is bought per person and is not included",
  NL: "Mandatory basic health insurance (Zvw nominal premium) is bought per adult and is not included",
};

/** Children of an age for full-time childcare. */
export const CHILDCARE_AGES = { from: 0, below: 6 };

/** A cost entered with its period, as a month: a year's figure is divided by 12. Every face converts through here. */
export function monthlyFrom(amount: number, per: "month" | "year"): number {
  if (per !== "month" && per !== "year") throw new Error(`A cost is "a month" or "a year"; got ${JSON.stringify(per)}.`);
  return per === "year" ? amount / 12 : amount;
}

/** Whether the household pays for childcare for its young children: yes unless it said no. */
export const paidChildcare = (profile: Profile) => profile.paidChildcare !== false;

/** A partner or spouse of the first person: a parent of the household's children. */
const isPartner = (p: Profile["household"][number] | undefined) => !!p && (p.relation === "partner" || !!p.spouse);

/** Children under 18 moving with the household, for regimes that ask. */
const minors = (profile: Profile): number | undefined => (profile.children ? profile.children.filter((a) => a < 18).length : undefined);

/** The first person's pay plan, in the shape every earner shares. */
function ownPay(profile: Profile): Pay {
  const inc = profile.income;
  return { gross: inc.gross, currency: inc.currency, mode: inc.mode, perCity: inc.perCity, pension: inc.pension };
}

/** Who earns: you, then anyone else in the household with a pay set. */
export function earnersOf(profile: Profile): { label: string; pay: Pay; age?: number; index: number }[] {
  const out = [{ label: profile.household[0]?.label || "You", pay: ownPay(profile), age: profile.household[0]?.newcomer?.age, index: 0 }];
  profile.household.slice(1).forEach((p, i) => {
    // A spouse counts even with no pay: a married couple on one income can still file jointly.
    if ((p.pay && (p.pay.gross > 0 || Object.keys(p.pay.perCity ?? {}).length)) || p.spouse)
      out.push({ label: p.label || `Person ${i + 2}`, pay: p.pay ?? { gross: 0, currency: profile.income.currency }, age: p.newcomer?.age, index: i + 1 });
  });
  return out;
}

/** One person's gross in this city: their own figure for it when they set one, else their single salary. */
function grossFor(data: Dataset, pay: Pay, city: City, local: string): { gross: number | null; from: EarnerMoney["grossFrom"]; given: boolean } {
  const own = pay.perCity?.[city.id];
  if (pay.mode === "per-city" && own) return { gross: convert(data, own.gross, own.currency, local), from: "per-city", given: true };
  if (pay.gross > 0) return { gross: convert(data, pay.gross, pay.currency, local), from: "same", given: true };
  return { gross: null, from: "none", given: false };
}

/** The household's pay in a city, everything that depends on what people earn. `override` replaces the first person's gross (local). */
function income(data: Dataset, profile: Profile, city: City, local: string, override?: number) {
  const countryName = data.countries[city.country]?.name ?? city.country;
  const people = earnersOf(profile);
  const gs = people.map((p, i) => (i === 0 && override !== undefined ? { gross: override, from: "per-city" as const, given: true } : grossFor(data, p.pay, city, local)));
  const missing: string[] = [];
  if (!gs.some((g) => g.given)) missing.push("salary");
  else if (gs.some((g) => g.given && g.gross === null)) missing.push(`an exchange rate for ${local}`);
  const model = taxModelFor(city.country);
  if (!model && gs.some((g) => g.gross !== null && g.gross > 0)) missing.push(`a tax model for ${countryName}`);
  const earning = people.map((p, i) => ({ ...p, pos: i, gross: gs[i]!.gross ?? 0, from: gs[i]!.from })).filter((p, i) => i === 0 || p.gross > 0 || profile.household[p.index]?.spouse);
  const regimes = new Map<number, RegimeUse>();
  let tax: MoneyResult["tax"] = null;
  let taxed = new Map<number, EarnerTax>();
  let filing: Filing | null = null;
  if (model && !missing.length) {
    // A newcomer regime counts for a person only when that person chose it ("none" or nothing: none): the first
    // person's are `income.regimes`, everyone else's `household[].regimes`. Each is checked on that person's own facts
    // and answers: established, a scenario while some are theirs to confirm, or off when a fact fails a condition.
    const notes: string[] = [];
    const approximations: string[] = [];
    const tweaks = earning.map((p, i) => {
      const person = profile.household[p.index];
      const regimeId = i === 0 ? profile.income.regimes?.[city.country] : person?.regimes?.[city.country];
      const facts = { ...(person?.newcomer ?? {}), citizenships: person?.citizenships, gross: p.gross, minorChildren: person?.newcomer?.minorChildren ?? (i === 0 || isPartner(person) ? minors(profile) : undefined) };
      const picked = p.gross > 0 ? chosenRegime(city.country, facts, regimeId) : null;
      const usable = picked && picked.status !== "ruled out" && picked.regime.currency === local ? picked : null;
      const who = i === 0 ? "" : ` for ${p.label}`;
      if (regimeId && regimeId !== "none" && !picked && p.gross > 0) notes.push(`The regime "${regimeId}"${who} is not known for ${countryName}, so it was not applied.`);
      if (picked?.status === "ruled out") notes.push(`${picked.regime.name}${who} was not counted, a condition is not met: ${picked.unmet.join("; ")}`);
      if (usable?.status === "scenario") {
        notes.push(`${usable.regime.name}${who} is counted as a scenario you chose, not established eligibility: still to confirm: ${usable.unconfirmed.join(" ")}`);
        approximations.push(`${usable.regime.name}${who} is counted as a scenario: its conditions are not all confirmed.`);
      }
      if (usable) regimes.set(p.pos, { id: usable.regime.id, name: usable.regime.name, years: usable.regime.years, byDefault: false, status: usable.status === "established" ? "established" : "scenario", unconfirmed: usable.unconfirmed, person: p.label });
      // Tax settings (taxTweaks) are the first person's own; a regime is whoever chose it.
      return i === 0 ? withRegime(profile.income.taxTweaks[city.country], usable?.regime, p.gross) : withRegime(undefined, usable?.regime, p.gross);
    });
    const spouse = profile.household.slice(1).find((p) => p.spouse);
    const ordered = spouse ? [earning[0]!, ...earning.slice(1).sort((a, b) => Number(profile.household[b.index] === spouse) - Number(profile.household[a.index] === spouse))] : earning;
    // Children count for both parents (payroll rules for parents); each child's credits are claimed by one parent.
    const parent = (p: (typeof ordered)[number]) => p.pos === 0 || isPartner(profile.household[p.index]);
    const parents = ordered.filter(parent);
    const kids = profile.children ?? [];
    const run = (claims: Map<number, number[]>) =>
      householdTax(
        model,
        { region: city.region, city: city.id },
        ordered.map((p) => ({
          label: p.label,
          gross: p.gross,
          tweak: tweaks[p.pos],
          age: p.age,
          children: parent(p) ? profile.children : undefined,
          claimedChildren: parent(p) ? (claims.get(p.pos) ?? []) : undefined,
          pension: p.pay.pension,
        })),
        !!spouse && ordered.length >= 2 && profile.household[ordered[1]!.index] === spouse,
      );
    // Where credits depend on who claims (the US Child Tax Credit), every way two parents can share the children is
    // compared and the one that leaves the household the most is used: unmarried parents may agree who claims a child
    // living with both (IRS Publication 501). Elsewhere the first parent claims them, which changes nothing.
    const allocations: Map<number, number[]>[] = [];
    const pair = parents.slice(0, 2);
    if (model.childClaims && pair.length === 2 && kids.length && kids.length <= 6) {
      for (let mask = 0; mask < 1 << kids.length; mask++)
        allocations.push(new Map([[pair[0]!.pos, kids.filter((_, k) => !(mask & (1 << k)))], [pair[1]!.pos, kids.filter((_, k) => !!(mask & (1 << k)))]]));
    } else allocations.push(new Map(parents.length ? [[parents[0]!.pos, kids]] : []));
    let best = { h: run(allocations[0]!), claims: allocations[0]! };
    for (const a of allocations.slice(1)) {
      const h = run(a);
      if (h.combined.net > best.h.combined.net + 0.005) best = { h, claims: a };
    }
    const h = best.h;
    if (allocations.length > 1) {
      const said = pair.map((p) => ({ p, n: (best.claims.get(p.pos) ?? []).length })).filter((x) => x.n > 0);
      if (said.length) notes.push(`Child credits: ${said.map((x) => `${x.p.label} claims ${x.n === kids.length ? (kids.length === 1 ? "the child" : "every child") : `${x.n} of ${kids.length} children`}`).join(", ")}, the share between the parents that leaves the household the most; unmarried parents agree who claims a child who lives with both.`);
    }
    if (ordered.length > 1 && profile.income.taxTweaks[city.country]) notes.push(`Your tax settings for ${countryName} apply to you only; ${ordered.slice(1).map((p) => p.label).join(" and ")} ${ordered.length > 2 ? "are" : "is"} taxed without them.`);
    tax = h.combined;
    if (notes.length) tax.caveats = [...tax.caveats, ...notes];
    if (approximations.length) tax.completeness = mergeCompleteness(tax.completeness, completenessOf([], approximations));
    taxed = new Map(ordered.map((p, i) => [p.pos, h.people[i]!]));
    filing = spouse ? h.filing : null;
  }
  const earners: EarnerMoney[] = earning.map((p) => {
    const t = taxed.get(p.pos);
    return { label: p.label, gross: gs[p.pos]!.gross, grossFrom: p.from, pension: t?.pension ?? 0, net: t ? t.result.net : null, tax: t?.result ?? null, regime: regimes.get(p.pos) ?? null };
  });
  const total = earners.reduce((s, e) => s + (e.gross ?? 0), 0);
  // A model that does not apply here (Spain's Basque Country and Navarre levy their own tax) gives no take-home figure.
  const unsupported = tax?.completeness.status === "unsupported";
  if (unsupported) missing.push(`a tax model for ${city.name} (${tax!.completeness.missing.join(", ")})`);
  const completeness: Completeness = tax ? tax.completeness : model || missing.includes("salary") ? completenessOf() : { status: "unsupported", missing: [`income tax and contributions in ${countryName}`], approximations: [] };
  return {
    earners,
    gross: missing.includes("salary") || missing.some((m) => m.startsWith("an exchange rate")) ? null : total,
    grossFrom: earners[0]!.grossFrom,
    tax,
    filing,
    regime: earners[0]?.regime ?? null,
    regimes: earners.flatMap((e) => (e.regime ? [e.regime] : [])),
    net: tax && !unsupported ? tax.net : null,
    pension: earners.reduce((s, e) => s + e.pension, 0),
    missing,
    completeness,
  };
}

/** Costs that do not depend on pay: rent, everyday spending, childcare, health. */
function costs(data: Dataset, profile: Profile, city: City, local: string) {
  const missing: string[] = [];
  const gaps: string[] = [];
  const inc = profile.income;
  const rentR = resolve(data, profile, city, rentMetric(profile));
  const rentV = scalar(rentR);
  const rent = rentR && rentV !== null ? { monthly: rentV, resolved: rentR } : null;
  if (!rent) missing.push("rent");

  // Everyday spending: your own spending, as it is where you spend it, or scaled to another city by relative price
  // levels; otherwise a sourced estimate.
  let everyday: MoneyResult["everyday"] = null;
  const pl = resolve(data, profile, city, "price_level");
  if (inc.everyday) {
    const home = data.cities.find((c) => c.id === inc.everyday!.homeCity);
    const plHome = home ? resolve(data, profile, home, "price_level") : null;
    const a = scalar(pl);
    const b = scalar(plHome);
    const inLocalAtHomePrices = convert(data, inc.everyday.amount, inc.everyday.currency, local);
    const how = (where: string) => (inc.everyday!.assumed ? `a starting guess, ${where}: set your own` : where);
    if (home && home.id === city.id && inLocalAtHomePrices !== null) {
      everyday = { monthly: inLocalAtHomePrices, how: how("your own spending"), resolved: [] };
    } else if (a !== null && b !== null && a > 0 && b > 0 && inLocalAtHomePrices !== null && home) {
      everyday = { monthly: (inLocalAtHomePrices * a) / b, how: how(`scaled from ${home.name}`), resolved: [pl!, plHome!] };
    }
  }
  if (!everyday) {
    const est = resolve(data, profile, city, "everyday_single");
    const v = scalar(est);
    if (est && v !== null) everyday = { monthly: v, how: "typical single-person spending", resolved: [est] };
  }
  if (!everyday) missing.push("everyday costs");

  // Childcare for children under 6, after public support: none when the household uses no paid care; the household's
  // own monthly figure when given; else the OECD figure for a reference couple or single parent with full-time care.
  // With no figure the cost is named as left out, not guessed, and money left is partial rather than blocked.
  let childcare: FamilyCost | null = null;
  const omitted: string[] = [];
  const young = paidChildcare(profile) ? (profile.children ?? []).filter((a) => a >= CHILDCARE_AGES.from && a < CHILDCARE_AGES.below).length : 0;
  const ownCareR = young > 0 ? resolve(data, profile, city, "childcare_cost") : null;
  const ownCare = scalar(ownCareR);
  if (young > 0 && ownCare !== null) {
    childcare = { monthly: ownCare, how: "your own childcare cost", resolved: [ownCareR!] };
  } else if (young > 0) {
    const couple = profile.household.slice(1).some((p) => p.relation === "partner" || p.spouse);
    const kind = couple ? "couple" : "single";
    const r1 = resolve(data, profile, city, `childcare_net_${kind}_1`);
    const r2 = resolve(data, profile, city, `childcare_net_${kind}_2`);
    const v1 = scalar(r1);
    const v2 = scalar(r2);
    const who = couple ? "a two-earner couple on the average wage" : "a single parent on the average wage";
    if (young === 1 && v1 !== null) childcare = { monthly: v1 / 12, how: `one child in full-time care, as the OECD prices it for ${who}, after public support`, resolved: [r1!] };
    else if (young === 2 && v2 !== null) childcare = { monthly: v2 / 12, how: `2 children in full-time care, as the OECD prices it for ${who}, after public support`, resolved: [r2!] };
    else if (young > 2 && v2 !== null && v1 !== null) {
      // Past two, each child is counted at the cost the second adds: only when both figures exist.
      const extra = (young - 2) * Math.max(0, v2 - v1);
      childcare = { monthly: (v2 + extra) / 12, how: `${young} children in full-time care, as the OECD prices it for ${who}, after public support; past two, each child is counted at the cost of the second`, resolved: [r2!, r1!] };
    } else {
      omitted.push(`childcare for ${young} ${young === 1 ? "child" : "children"} under 6 (no figure here: add your own)`);
      gaps.push("No childcare figure here: add your own");
    }
  }

  // Health care paid out of pocket by each person, plus a premium where cover is bought outside pay (monthly, per household).
  let health: FamilyCost | null = null;
  const people = Math.max(1, profile.household.length) + (profile.children?.length ?? 0);
  const oopR = resolve(data, profile, city, "health_oop");
  const oop = scalar(oopR);
  const oopLocal = oop === null ? null : convert(data, oop, "USD", local);
  const premR = resolve(data, profile, city, "health_premium");
  const prem = scalar(premR);
  if (oopLocal !== null) {
    health = { monthly: (oopLocal * people) / 12 + (prem ?? 0), how: `${people} ${people === 1 ? "person" : "people"} at the country's average out-of-pocket spending${prem !== null ? ", plus your premium" : ""}`, resolved: [oopR!, ...(premR ? [premR] : [])] };
  } else if (prem !== null) health = { monthly: prem, how: "your premium", resolved: [premR!] };
  if (PREMIUM_HEALTH[city.country] && prem === null) {
    gaps.push(`${PREMIUM_HEALTH[city.country]}: add yours`);
    omitted.push("health insurance premium bought outside pay (add yours, a month)");
  }
  if (oopLocal === null) gaps.push("No open figure for out-of-pocket health spending here");
  if (young === 0 && (profile.children?.length ?? 0) > 0) gaps.push("Child benefits are not counted");

  return { rent, everyday, childcare, health, premium: { due: !!PREMIUM_HEALTH[city.country], monthly: prem }, missing, gaps, completeness: completenessOf(omitted) };
}

/** Paid time off by law, from the statutes and the OECD, adjusted for age where the law does that. */
function leave(data: Dataset, profile: Profile, city: City, gross: number | null): Leave {
  const r = (m: string) => resolve(data, profile, city, m);
  const hol = r("annual_leave");
  const pub = r("public_holidays");
  const mo = r("leave_mothers");
  const fa = r("leave_fathers");
  const age = profile.household[0]?.newcomer?.age;
  let holiday = scalar(hol);
  let holidayNote: string | null = city.country === "GB" && hol?.origin.kind !== "you" ? "Bank holidays can be included in the 28-day entitlement; they are not added again to its value (GOV.UK: holiday entitlement)." : null;
  const extra = holiday !== null && hol!.origin.kind !== "you" ? ageExtraLeave(city.country, age) : null;
  if (holiday !== null && extra) {
    holiday += extra.days;
    holidayNote = extra.note;
  }
  // https://www.gov.uk/holiday-entitlement-rights: bank holidays need not be paid in addition to statutory leave.
  const includesPublicHolidays = city.country === "GB" && hol?.origin.kind !== "you";
  const days = (holiday ?? 0) + (includesPublicHolidays ? 0 : scalar(pub) ?? 0);
  return {
    holiday,
    holidayNote,
    publicHolidays: scalar(pub),
    mothers: scalar(mo),
    fathers: scalar(fa),
    value: gross !== null && holiday !== null ? (gross / 260) * days : null,
    resolved: [hol, pub, mo, fa].filter((x): x is Resolved => !!x),
  };
}

/** Extra statutory holiday by age: Hungary's bands, Norway from 60, Switzerland under 20. */
export function ageExtraLeave(country: string, age: number | undefined): { days: number; note: string } | null {
  if (age === undefined) return null;
  if (country === "HU") {
    const steps = [25, 28, 31, 33, 35, 37, 39, 41, 43, 45];
    const days = steps.filter((a) => age >= a).length;
    return days ? { days, note: `${days} more day${days > 1 ? "s" : ""} at your age (Labour Code § 117)` } : null;
  }
  if (country === "NO" && age >= 60) return { days: 5, note: "an extra week from 60 (Holidays Act § 5)" };
  // https://www.ch.ch/en/work/working-hours/vacation--public-holidays-and-absences-from-work/
  if (country === "CH" && age < 20) return { days: 5, note: "five weeks under 20 (Code of Obligations art. 329a)" };
  return null;
}

export function money(data: Dataset, profile: Profile, city: City): MoneyResult {
  const local = data.countries[city.country]?.currency ?? "EUR";
  const shown = profile.displayCurrency;
  const inc = income(data, profile, city, local);
  const c = costs(data, profile, city, local);
  const missing = [...inc.missing, ...c.missing];
  const monthlyCost = c.rent && c.everyday ? c.rent.monthly + c.everyday.monthly + (c.childcare?.monthly ?? 0) + (c.health?.monthly ?? 0) : null;
  const monthlyLeft = inc.net !== null && monthlyCost !== null ? inc.net / 12 - monthlyCost : null;
  const toShown = (v: number | null) => (v === null ? null : convert(data, v, local, shown));
  const costShown = toShown(monthlyCost);
  return {
    localCurrency: local,
    gross: inc.gross,
    grossFrom: inc.grossFrom,
    tax: inc.tax,
    earners: inc.earners,
    filing: inc.filing,
    regime: inc.regime,
    regimes: inc.regimes,
    net: inc.net,
    pension: inc.pension,
    rent: c.rent,
    everyday: c.everyday,
    childcare: c.childcare,
    health: c.health,
    premium: c.premium,
    leave: leave(data, profile, city, inc.earners[0]?.gross ?? null),
    monthlyCost,
    monthlyLeft,
    display: { currency: shown, net: toShown(inc.net), monthlyCost: costShown, monthlyLeft: toShown(monthlyLeft) },
    runwayMonths: costShown && costShown > 0 && profile.income.savings > 0 ? profile.income.savings / costShown : null,
    missing,
    gaps: c.gaps,
    completeness: mergeCompleteness(inc.completeness, c.completeness),
    taxCompleteness: inc.completeness,
    costCompleteness: c.completeness,
  };
}

// ---------- Break-even: the pay you would need here to keep what you keep at home ----------

export interface BreakEven {
  /** Your gross a year in this city that leaves you the same each month as at home, local currency. */
  gross: number;
  /** The same in the display currency. */
  shown: number | null;
  /** What you keep each month at home, in the display currency: the target. */
  target: number;
  /** Your gross here now, local currency, when set: for "x% more than you would earn". */
  current: number | null;
  /** Where you live now. */
  home: string;
}

/** Where the person lives now, when they said so (a starting guess never counts). */
export function homeCityOf(profile: Profile): string | null {
  const e = profile.income.everyday;
  return e && !e.assumed ? e.homeCity : null;
}

/**
 * The first person's gross in `city` that leaves the household the same money each month as at home, by bisection
 * over the full tax model (pension, regimes, a partner's pay and joint filing included). Null when either side has
 * no money-left figure, or when no salary up to a high ceiling gets there.
 */
export function breakEven(data: Dataset, profile: Profile, city: City, home: MoneyResult, homeId: string): BreakEven | null {
  // Only between figures that hold everything due: a partial side would make the target or the pay too low.
  const whole = (cv: Completeness) => cv.status === "complete" || cv.status === "approximate";
  if (home.monthlyLeft === null || city.id === homeId || !whole(home.completeness)) return null;
  const local = data.countries[city.country]?.currency ?? "EUR";
  const target = convert(data, home.monthlyLeft, home.localCurrency, local);
  // Never a number in a field whose currency it is not: without the display rate there is no break-even to show.
  const targetShown = convert(data, home.monthlyLeft, home.localCurrency, profile.displayCurrency);
  if (target === null || targetShown === null) return null;
  const c = costs(data, profile, city, local);
  if (c.missing.length || !whole(c.completeness)) return null;
  const now = income(data, profile, city, local);
  if (!whole(now.completeness)) return null;
  const cost = c.rent!.monthly + c.everyday!.monthly + (c.childcare?.monthly ?? 0) + (c.health?.monthly ?? 0);
  const leftAt = (g: number): number | null => {
    const i = income(data, profile, city, local, g);
    return i.net === null ? null : i.net / 12 - cost;
  };
  const scale = convert(data, 100_000, "EUR", local) ?? 100_000;
  let lo = 0;
  let hi = scale;
  const top = leftAt(0);
  if (top === null) return null;
  if (top >= target) return { gross: 0, shown: 0, target: targetShown, current: null, home: homeId };
  for (let i = 0; i < 12 && (leftAt(hi) ?? -Infinity) < target; i++) hi *= 2;
  if ((leftAt(hi) ?? -Infinity) < target) return null;
  for (let i = 0; i < 40 && hi - lo > Math.max(1, scale / 100_000); i++) {
    const mid = (lo + hi) / 2;
    if ((leftAt(mid) ?? -Infinity) >= target) hi = mid;
    else lo = mid;
  }
  return {
    gross: Math.round(hi),
    shown: convert(data, hi, local, profile.displayCurrency),
    target: targetShown,
    current: now.earners[0]?.gross ?? null,
    home: homeId,
  };
}
