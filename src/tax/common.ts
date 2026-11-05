import type { Iso2, TaxTweak } from "../core/types.ts";

export interface TaxInput {
  gross: number; // annual, local currency
  region?: string; // ISO 3166-2 subdivision of the city, e.g. "IT-21", "US-CA", "GB-SCT"
  city?: string; // city id, for municipal taxes
  tweak?: TaxTweak;
  /** The earner's age, for the rules that depend on it; a model states what it assumes without it. */
  age?: number;
  /** Ages of this earner's own children, for payroll rules that depend on being a parent (both parents count). */
  children?: number[];
  /**
   * Whether this earner claims the child credits for `children` (default true). In a household only one person
   * claims a child's credit; a parent who does not still counts as a parent for payroll rules.
   */
  claimsChildren?: boolean;
  /**
   * The children whose credits this earner claims, when the household splits them between parents. Wins over
   * `claimsChildren`; unset means all of `children` when `claimsChildren` is not false.
   */
  claimedChildren?: number[];
  /** The household this earner files with, for rules that read the household rather than the person (Portugal's minimum-subsistence ceiling). */
  household?: { gross: number; filers: number };
}

/**
 * How much of what is due a figure holds, in order: "complete" (every tax and contribution in the model's scope is
 * worked out for this place), "approximate" (all are there, but a stand-in replaces an exact figure: a typical rate,
 * an earlier year's scale, a combination not modelled), "partial" (something due is left out, so the figure is too
 * high and must not be compared as if whole), "unsupported" (no model for this place: no figure).
 */
export type CompletenessStatus = "complete" | "approximate" | "partial" | "unsupported";

export interface Completeness {
  status: CompletenessStatus;
  /** Taxes, contributions or compulsory costs that are due but are not in the figure. Non-empty means at least "partial". */
  missing: string[];
  /** The stand-ins that make the figure approximate, one sentence each. */
  approximations: string[];
}

const RANK: Record<CompletenessStatus, number> = { complete: 0, approximate: 1, partial: 2, unsupported: 3 };

/** The completeness of several figures together: the worst status, everything omitted and approximated. */
export function mergeCompleteness(...cs: (Completeness | null | undefined)[]): Completeness {
  const all = cs.filter((c): c is Completeness => !!c);
  const status = all.reduce<CompletenessStatus>((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), "complete");
  return { status, missing: [...new Set(all.flatMap((c) => c.missing))], approximations: [...new Set(all.flatMap((c) => c.approximations))] };
}

/** A completeness from what is left out and what is approximated: omissions make it partial, stand-ins approximate. */
export function completenessOf(omitted: string[] = [], approximations: string[] = []): Completeness {
  return { status: omitted.length ? "partial" : approximations.length ? "approximate" : "complete", missing: omitted, approximations };
}

export interface TaxLine {
  label: string;
  amount: number; // positive = paid
}

export interface TaxResult {
  country: Iso2;
  year: number;
  currency: string;
  gross: number;
  net: number;
  lines: TaxLine[];
  effectiveRate: number;
  sources: { label: string; url: string }[];
  caveats: string[];
  /** How much of what is due here the figure holds; read it before comparing take-home pay across places. */
  completeness: Completeness;
}

export interface TaxModel {
  country: Iso2;
  year: number;
  /** When to compare the model with the law again: the day the next tax year's rules take effect. Default: 1 January after `year`. */
  reviewBy?: string;
  currency: string;
  /** One line a person can read: what this model covers. */
  scope: string;
  sources: { label: string; url: string }[];
  caveats: string[];
  /** Personal settings this model understands beyond the generic tweaks, shown as switches. */
  options?: { field: "noSocialContributions"; label: string }[];
  /** How a married couple's income tax is worked out together, where the country does that and this model covers it. */
  joint?: JointFiling;
  /** Child credits depend on which parent claims them (the US Child Tax Credit): a household compares who claims. */
  childClaims?: boolean;
  compute(input: TaxInput): TaxResult;
}

/**
 * Joint filing for a married couple: each person's own result is computed as usual, then the lines named in
 * `replaces` give way to their share of the couple's tax, split in proportion to each person's base.
 */
export interface JointFiling {
  /** "optional": the couple may file together and the cheaper way is used; "required": married couples are taxed together. */
  kind: "optional" | "required";
  /** One person's income-tax base before their own tweaks (the pension deduction and taxable share are applied after). */
  base(input: TaxInput): number;
  /** The couple's income tax on the sum of their bases; `children` are the couple's children, for credits a joint return claims. */
  tax(total: number, ctx?: { children?: number[] }): number;
  /** Labels of the lines in each person's own result that the joint tax replaces. */
  replaces: string[];
  /** The line the joint tax appears as. */
  label: string;
  /** What the joint computation covers, in one sentence. */
  note: string;
}

/** A band is [upper bound, rate]; the last band uses Infinity. Bounds are cumulative, in the taxed amount. */
export type Bands = readonly (readonly [number, number])[];

export function progressive(amount: number, bands: Bands): number {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of bands) {
    if (amount <= lower) break;
    tax += (Math.min(amount, upper) - lower) * rate;
    lower = upper;
  }
  return tax;
}

/** The children whose credits an earner claims: `claimedChildren`, else all of `children` unless `claimsChildren` is false. */
export function claimedBy(input: Pick<TaxInput, "children" | "claimsChildren" | "claimedChildren">): number[] {
  return input.claimedChildren ?? (input.claimsChildren === false ? [] : (input.children ?? []));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Builds the result and applies the generic tweaks every model shares. */
export function finish(
  model: Pick<TaxModel, "country" | "year" | "currency" | "sources" | "caveats">,
  gross: number,
  lines: TaxLine[],
  extraCaveats: string[] = [],
  completeness: Completeness = completenessOf(),
): TaxResult {
  const paid = lines.reduce((s, l) => s + l.amount, 0);
  const net = gross - paid;
  return {
    country: model.country,
    year: model.year,
    currency: model.currency,
    gross,
    net: round2(net),
    lines: lines.map((l) => ({ label: l.label, amount: round2(l.amount) })),
    effectiveRate: gross > 0 ? paid / gross : 0,
    sources: model.sources,
    caveats: [...model.caveats, ...extraCaveats],
    completeness,
  };
}

/**
 * The taxed part of an income-tax base under the person's tweaks: the taxable share of the base (a newcomer
 * exemption leaves part of pay out of income), less the whole pension deduction, which comes off income as it is.
 */
export function taxedBase(base: number, tweak: TaxTweak | undefined): number {
  return Math.max(0, base * (tweak?.taxableShare ?? 1) - (tweak?.pretaxDeduction ?? 0));
}

/**
 * Income tax with the person's own tweaks applied: only `taxableShare` of the base is taxed, less the pension
 * deduction, and a flat rate replaces the progressive schedule when given.
 */
export function incomeTax(base: number, tweak: TaxTweak | undefined, schedule: (taxable: number) => number): number {
  const taxable = taxedBase(base, tweak);
  if (tweak?.flatRate !== undefined) return Math.max(0, taxable * tweak.flatRate);
  return Math.max(0, schedule(taxable));
}

/**
 * The base of a second layer of income tax (state, province, region, municipality, church) under the person's tweaks:
 * the taxable share applies; a flat rate replaces only the national schedule, unless its scope is "all",
 * when it replaces these layers too and their base is zero. Every such layer must go through this function.
 */
export function taxedShare(base: number, tweak: TaxTweak | undefined): number {
  if (tweak?.flatRate !== undefined && tweak.flatRateScope === "all") return 0;
  return taxedBase(base, tweak);
}

/** An income-tax base less the pension contribution the relief rules let you put in before tax. */
export function afterPension(base: number, tweak: TaxTweak | undefined): number {
  return Math.max(0, base - (tweak?.pretaxDeduction ?? 0));
}

export function tweakCaveats(tweak: TaxTweak | undefined): string[] {
  const out: string[] = [];
  if (tweak?.taxableShare !== undefined && tweak.taxableShare !== 1)
    out.push(`Your setting: only ${Math.round(tweak.taxableShare * 100)}% of gross is treated as taxable income.`);
  if (tweak?.flatRate !== undefined)
    out.push(
      `Your setting: a flat ${Math.round(tweak.flatRate * 1000) / 10}% replaces ${tweak.flatRateScope === "all" ? "every layer of income tax" : "the income tax schedule"}.`,
    );
  if (tweak?.note) out.push(tweak.note);
  return out;
}
