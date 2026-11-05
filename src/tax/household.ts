// A household's tax in one place: each earner's own result with their pension contribution, then joint filing for a
// married couple where the country does that and its module covers it. Every face (the app, the CLI, the MCP server)
// goes through here, so a couple is taxed the same way wherever they ask.

import type { Iso2, TaxTweak } from "../core/types.ts";
import { claimedBy, mergeCompleteness, round2, taxedBase, type Completeness, type TaxLine, type TaxModel, type TaxResult } from "./common.ts";
import { pensionRelief, type PensionRelief } from "./pension.ts";

export interface EarnerInput {
  label: string;
  /** Annual gross, local currency. */
  gross: number;
  tweak?: TaxTweak;
  age?: number;
  /** This earner's own children: payroll rules for parents read them (both parents count). */
  children?: number[];
  /** Whether this earner claims the child credits (default true); in a household one person claims a child. */
  claimsChildren?: boolean;
  /** The children whose credits this earner claims, when parents split them; wins over `claimsChildren`. */
  claimedChildren?: number[];
  /** Share of gross paid into a pension, 0 to 0.5. */
  pension?: number;
}

/** A tax line, marked when it is the person's own pension saving rather than a tax. */
export type HouseholdLine = TaxLine & { saving?: boolean };

export interface EarnerTax {
  label: string;
  gross: number;
  /** Paid into the pension a year, with any tax relief the state pays into it: leaves take-home pay but stays the person's. */
  pension: number;
  result: TaxResult & { lines: HouseholdLine[] };
}

export interface Filing {
  mode: "individual" | "joint";
  /** Why, in a sentence: the rule, and what joint filing saves or costs here. Null for a single earner with nothing to say. */
  note: string | null;
  /** "approximate" when the country's rule for this couple is not what was computed (a flat-rate regime with joint filing). */
  status?: "complete" | "approximate";
}

export interface HouseholdTax {
  people: EarnerTax[];
  /** Everyone together: lines carry the person's label when more than one person earns. Its completeness is everyone's, and the filing's. */
  combined: TaxResult & { lines: HouseholdLine[] };
  filing: Filing;
}

/** What a household's pension saving holds: contributions plus any tax relief paid into the pension account. */
const savedIn = (lines: HouseholdLine[]) => lines.reduce((s, l) => s + (l.saving ? l.amount : 0), 0);

/** How each country treats a married couple where joint filing is not modelled: said plainly, so nobody assumes it is. */
export const COUPLES: Record<Iso2, string> = {
  CH: "Switzerland taxes married couples together at the married rates; here each is taxed as single, which understates a two-earner couple's tax.",
  BE: "Belgium taxes married and legally cohabiting couples together, with a marital quotient when one earns little; here each is taxed separately.",
  IE: "Married couples may choose joint assessment, which widens the standard rate band when one earns less; here each is taxed separately.",
  ES: "Spouses may file jointly, which rarely helps two earners; here each is taxed separately.",
  EE: "Spouses may file jointly and share the basic exemption; here each is taxed separately.",
  DK: "Spouses can use each other's unused personal allowance; not modelled, each is taxed separately.",
  GR: "Married couples file one return, but each spouse's tax is worked out separately, as here.",
};

const sumPaid = (lines: HouseholdLine[]) => lines.reduce((s, l) => s + (l.saving ? 0 : l.amount), 0);

function rebuild(r: TaxResult, gross: number, lines: HouseholdLine[], caveats: string[]): TaxResult & { lines: HouseholdLine[] } {
  const paid = sumPaid(lines);
  const saved = lines.reduce((s, l) => s + (l.saving ? l.amount : 0), 0);
  return { ...r, gross, lines: lines.map((l) => ({ ...l, amount: round2(l.amount) })), net: round2(gross - paid - saved), effectiveRate: gross > 0 ? paid / gross : 0, caveats };
}

/** Non-refundable pension relief offsets income tax only; a fund transfer stays in pension saving. */
function withPensionCredit(lines: HouseholdLine[], credit: number, rule: PensionRelief | undefined): HouseholdLine[] {
  if (credit <= 0 || !rule) return lines;
  const due = lines.reduce((sum, l) => sum + (rule.creditTaxes?.some((prefix) => l.label.startsWith(prefix)) ? l.amount : 0), 0);
  const used = Math.min(credit, Math.max(0, due));
  if (used <= 0) return lines;
  return [...lines,
    { label: `${rule.plan} tax credit (received)`, amount: -used },
    ...(rule.creditToPension ? [{ label: `${rule.plan} tax transfer into pension`, amount: used, saving: true }] : []),
  ];
}

/** One earner: their tax with the pension relief their country gives, and the contribution as its own line. */
export function earnerTax(model: TaxModel, where: { region?: string; city?: string }, e: EarnerInput): EarnerTax {
  const contribution = contributionOf(e);
  const { deducted, credit, rule } = pensionRelief(model.country, contribution, e.gross, e.age, { foreigner: !!e.tweak?.noSocialContributions });
  const tweak = deducted > 0 ? { ...(e.tweak ?? {}), pretaxDeduction: deducted } : e.tweak;
  const r = model.compute({ gross: e.gross, region: where.region, city: where.city, tweak, age: e.age, children: e.children, claimsChildren: e.claimsChildren, claimedChildren: e.claimedChildren });
  const lines = withPensionCredit([...r.lines], credit, rule);
  const caveats = [...r.caveats];
  if (contribution > 0 && rule?.source && !r.sources.some((s) => s.url === rule.source!.url)) r.sources = [...r.sources, rule.source];
  if (contribution > 0) {
    lines.push({ label: `Into your pension (${rule?.plan ?? "pension"})`, amount: contribution, saving: true });
    caveats.push(rule ? rule.note : "No pension relief rule for this country yet: the contribution is counted without tax relief.");
  }
  const result = rebuild(r, e.gross, lines, caveats);
  return { label: e.label, gross: e.gross, pension: savedIn(result.lines), result };
}

/**
 * Everyone who earns in a city. `spouse` says the second earner is married to the first: where the module models
 * joint filing it is used when required, or when it is cheaper; elsewhere the country's rule is named.
 */
export function householdTax(model: TaxModel, where: { region?: string; city?: string }, earners: EarnerInput[], spouse: boolean): HouseholdTax {
  const people = earners.map((e) => earnerTax(model, where, e));
  let filing: Filing = { mode: "individual", note: null };
  const couple = spouse && earners.length >= 2;
  const flatRated = earners.slice(0, 2).some((e) => e.tweak?.flatRate !== undefined);
  if (couple && model.joint && !flatRated) {
    const j = model.joint;
    const pair = earners.slice(0, 2);
    const household = { gross: pair[0]!.gross + pair[1]!.gross, filers: 2 };
    const bases = pair.map((e) =>
      taxedBase(j.base({ gross: e.gross, region: where.region, city: where.city, age: e.age, children: e.children, household }), { taxableShare: e.tweak?.taxableShare, pretaxDeduction: deductedOf(model, e) }),
    );
    const total = bases[0]! + bases[1]!;
    // A joint return claims every child either spouse claims, once: each spouse's own claimed children together.
    const tax = j.tax(total, { children: [...claimedBy(pair[0]!), ...claimedBy(pair[1]!)] });
    const jointPeople = people.map((p, i) => {
      if (i > 1) return p;
      const share = total > 0 ? bases[i]! / total : 0.5;
      const e = earners[i]!;
      const { credit, rule } = pensionRelief(model.country, contributionOf(e), e.gross, e.age, { foreigner: !!e.tweak?.noSocialContributions });
      const kept = p.result.lines.filter((l) => !j.replaces.includes(l.label) && l.label !== `${rule?.plan} tax credit (received)` && l.label !== `${rule?.plan} tax transfer into pension`);
      const at = p.result.lines.findIndex((l) => j.replaces.includes(l.label));
      const lines = [...kept];
      lines.splice(Math.max(0, at), 0, { label: `${j.label}, ${i === 0 ? "your" : "their"} share`, amount: tax * share });
      const result = rebuild(p.result, p.gross, withPensionCredit(lines, credit, rule), p.result.caveats);
      return { ...p, pension: savedIn(result.lines), result };
    });
    const before = people.slice(0, 2).reduce((s, p) => s + p.result.net, 0);
    const after = jointPeople.slice(0, 2).reduce((s, p) => s + p.result.net, 0);
    const gain = Math.round(after - before);
    if (j.kind === "required" || gain > 0) {
      filing = { mode: "joint", note: `${j.note} ${j.kind === "required" ? "" : `Filing together saves ${gain.toLocaleString("en-GB")} ${model.currency} a year here.`}`.trim() };
      people.splice(0, people.length, ...jointPeople);
    } else {
      filing = { mode: "individual", note: `${j.note} Here filing separately costs no more, so each is taxed on their own.` };
    }
  } else if (couple && model.joint) {
    // A flat-rate regime and joint filing together are not modelled: say what the law does and that this is a stand-in.
    filing = {
      mode: "individual",
      status: "approximate",
      note:
        model.joint.kind === "required"
          ? `${model.joint.note} With a flat-rate setting for one spouse that is not modelled here, so each is taxed on their own: an approximation, not the rule.`
          : `${model.joint.note} With a flat-rate setting for one spouse, filing together is not compared here, so each is taxed on their own.`,
    };
  } else if (couple) {
    filing = { mode: "individual", note: COUPLES[model.country] ?? "This country taxes each spouse on their own income, as here." };
  }
  const combined = combine(model, people);
  const filingCompleteness: Completeness | null = filing.status === "approximate" && filing.note ? { status: "approximate", missing: [], approximations: [filing.note] } : null;
  combined.completeness = mergeCompleteness(...people.map((p) => p.result.completeness), filingCompleteness);
  return { people, combined, filing };
}

/** What this earner pays into a pension a year: their share of gross, at most half. */
function contributionOf(e: EarnerInput): number {
  return Math.max(0, Math.min(0.5, e.pension ?? 0)) * e.gross;
}

/** The pension deduction the relief rules give this earner (the joint base needs it too). */
function deductedOf(model: TaxModel, e: EarnerInput): number {
  return pensionRelief(model.country, contributionOf(e), e.gross, e.age, { foreigner: !!e.tweak?.noSocialContributions }).deducted;
}

function combine(model: TaxModel, people: EarnerTax[]): TaxResult & { lines: HouseholdLine[] } {
  if (people.length === 1) return people[0]!.result;
  const gross = people.reduce((s, p) => s + p.gross, 0);
  // A spouse with no pay brings no lines of their own, only a share of a joint tax that is not zero.
  const lines = people.flatMap((p) => p.result.lines.filter((l) => p.gross > 0 || Math.abs(l.amount) >= 0.005).map((l) => ({ ...l, label: `${p.label}: ${l.label}` })));
  const caveats = [...new Set(people.flatMap((p) => p.result.caveats))];
  const sources = people.flatMap((p) => p.result.sources).filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i);
  const first = people[0]!.result;
  return { ...rebuild({ ...first, sources }, gross, lines, caveats), country: model.country };
}
