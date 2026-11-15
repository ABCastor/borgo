// A first visit starts near the visitor: the region their request comes from (src/core/visit-region.ts), five of its
// cities whose money figure is whole (take-home pay, rent for one bedroom and everyday costs all known), and what an
// example salary leaves each month in each, so the first screen answers "what would I have left?" before anything is
// typed. The example is labelled as one and never becomes the person's own salary.
import { money, type MoneyResult } from "../core/money.ts";
import type { Dataset, Profile } from "../core/types.ts";
import { fromText, REGIONS, regionById, spreadOf, type RegionId } from "../core/visit-region.ts";
import { html, type Raw } from "./dom.ts";
import { money as fmtMoney } from "./format.ts";

/** The example salary a first visit's money is shown at: euros a year before tax, the reference pages use too. */
export const EXAMPLE_GROSS = 60_000;
export const SHORTLIST_SIZE = 5;

/** The profile with the example salary in place of the person's, for the example only. */
export function exampleProfile(p: Profile): Profile {
  return { ...p, income: { ...p.income, mode: "same", gross: EXAMPLE_GROSS, currency: "EUR", perCity: {} } };
}

/** Whether a city's money figure is whole at the example salary: tax usable, an official rent and everyday costs known. */
export function wholeMoney(m: MoneyResult): boolean {
  const usable = m.completeness.status === "complete" || m.completeness.status === "approximate";
  return usable && m.monthlyLeft !== null && !!m.rent && m.rent.resolved.origin.kind !== "you";
}

/**
 * The cities a first visit from `region` starts with: its candidates in order, keeping each whose money is whole when
 * everyday costs are scaled from the first one kept, up to five. Fewer when fewer qualify; never a city with a gap.
 */
export function shortlist(data: Dataset, region: RegionId, base: Profile, size = SHORTLIST_SIZE): string[] {
  const out: string[] = [];
  for (const id of regionById(region).candidates) {
    if (out.length >= size) break;
    const city = data.cities.find((c) => c.id === id);
    if (!city) continue;
    const home = out[0] ?? id;
    const p = exampleProfile({ ...base, cities: [...out, id], income: { ...base.income, everyday: base.income.everyday ? { ...base.income.everyday, homeCity: home } : base.income.everyday } });
    if (wholeMoney(money(data, p, city))) out.push(id);
  }
  return out;
}

/** The shortlists the site build computed with every city's figures (dataset `shortlists`), else computed here. */
export function shortlistOf(data: Dataset, region: RegionId, base: Profile): string[] {
  return (data as Dataset & { shortlists?: Partial<Record<RegionId, string[]>> }).shortlists?.[region] ?? shortlist(data, region, base);
}

/** The region's candidates before its last chosen city that were passed over: their money is not whole yet. */
export function passedOver(region: RegionId, chosen: string[]): string[] {
  const c = regionById(region).candidates;
  const last = Math.max(...chosen.map((id) => c.indexOf(id)));
  return c.slice(0, last + 1).filter((id) => !chosen.includes(id));
}

export interface ExampleRow { id: string; name: string; left: number; rent: number; currency: string }

/** What the example salary leaves each month in each chosen city with a whole figure, most first, in the display currency. */
export function exampleRows(data: Dataset, p: Profile): ExampleRow[] {
  const ex = exampleProfile(p);
  const rows: ExampleRow[] = [];
  for (const id of p.cities) {
    const city = data.cities.find((c) => c.id === id);
    if (!city) continue;
    const m = money(data, ex, city);
    if (!wholeMoney(m) || m.display.monthlyLeft === null) continue;
    const rate = m.monthlyLeft && m.display.monthlyLeft ? m.display.monthlyLeft / m.monthlyLeft : null;
    rows.push({ id, name: city.name, left: m.display.monthlyLeft, rent: rate ? m.rent!.monthly * rate : m.rent!.monthly, currency: m.display.currency });
  }
  return rows.sort((a, b) => b.left - a.left);
}

const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Where the first visit's cities come from, for the sentence that says why they are shown. */
export interface VisitFrom {
  region: RegionId;
  /** The request's country code, when the edge read one. */
  country?: string;
}

/**
 * The first screen's money: what the example salary leaves after tax, rent and everyday costs in each city, and why
 * these cities are shown, with the regions to start from instead. Shown only before the person gives a salary.
 */
export function exampleMoney(data: Dataset, p: Profile, from: VisitFrom | undefined): Raw {
  const rows = exampleRows(data, p);
  if (!rows.length) return html``;
  const region = regionById(from?.region);
  const everyday = p.income.everyday;
  const base = everyday ? data.cities.find((c) => c.id === everyday.homeCity)?.name : null;
  // The reason is given only while the cities are still the ones the region started with.
  const fresh = !!from && shortlistOf(data, from.region, p).join() === p.cities.join();
  const where = spreadOf(region.id, p.cities.map((id) => data.cities.find((c) => c.id === id)?.country ?? ""));
  const skipped = fresh ? passedOver(region.id, p.cities).map((id) => data.cities.find((c) => c.id === id)?.name).filter((n): n is string => !!n) : [];
  return html`<div class="v-example" data-region="${region.id}">
    <p class="v-ex-h">What <b class="num">${fmtMoney(EXAMPLE_GROSS, "EUR")}</b> a year before tax leaves you each month, after tax, rent for one bedroom${everyday ? html` and ${fmtMoney(everyday.amount, everyday.currency)} of everyday spending${base ? html` in ${base}, scaled to each city's prices` : ""}` : ""}:</p>
    <ol class="v-ex-list">${rows.map((r) => html`<li><a href="#/city/${r.id}">${r.name}</a> <b class="num">${fmtMoney(r.left, r.currency)}</b> <span class="quiet">rent ${fmtMoney(r.rent, r.currency)}</span></li>`)}</ol>
    <p class="v-ex-why quiet">An example until you type your salary above.${fresh ? html` <span class="v-from" data-where="${where}">${fromText(region.id, from?.country, where)}</span> Each has every money figure: pay after tax, an official rent and everyday costs.${skipped.length ? html` ${listOf(skipped)} ${skipped.length > 1 ? "wait" : "waits"} for a figure that is still missing.` : ""} Start from <span class="v-regions">${REGIONS.filter((r) => r.id !== region.id).map((r, i, all) => html`${i ? (i === all.length - 1 ? " or " : ", ") : ""}<button class="link" data-act="region" data-region="${r.id}">${r.name}</button>`)}</span> instead.` : ""}</p>
  </div>`;
}
