// Money figures that must hold against the law and plain arithmetic: every fixture below is a calculation done by
// hand, or a worked example from the primary source named beside it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CRITERIA } from "../src/core/criteria.ts";
import { evaluate } from "../src/core/engine.ts";
import { money } from "../src/core/money.ts";
import type { Dataset, Profile } from "../src/core/types.ts";
import { cuneo, italy } from "../src/tax/it.ts";
import { householdTax } from "../src/tax/household.ts";
import { netherlands } from "../src/tax/nl.ts";
import { unitedStates } from "../src/tax/us.ts";
import { fixture, profile } from "./fixture.ts";

const near = (a: number, b: number, eps = 0.01, what = "") => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} is not ${b}`);
const city = (d: Dataset, id: string) => d.cities.find((c) => c.id === id)!;
/** Only these lines count; every other built-in line has weight 0. */
const only = (w: Record<string, number>) => ({ ...Object.fromEntries(CRITERIA.map((c) => [c.id, 0])), ...w });

function withNl(d: Dataset): Dataset {
  d.cities.push({ id: "amsterdam-nl", name: "Amsterdam", country: "NL", lat: 52.37, lon: 4.9 });
  d.countries.NL = { code: "NL", name: "Netherlands", currency: "EUR", areas: ["EU"] };
  d.observations["amsterdam-nl"] = [{ metric: "rent_1bed", value: 2_000, period: "2025", level: "city", source: "test", retrieved: "2026-10-27" }, { metric: "price_level", value: 110, period: "2025", level: "country", source: "test", retrieved: "2026-10-27" }];
  return d;
}

// ---------- N1: partial money cannot rescue a proven failure ----------

test("N1: a must-pass on money left fails when even the partial, too-high figure is below zero", () => {
  const d = fixture();
  // San Francisco leaves out the health premium (partial): its money left is at most what is shown, and a big rent makes
  // that negative. Torino is whole and slightly negative with its own rent.
  const p = profile({
    cities: ["turin-it", "san-francisco-us"],
    weights: only({ money_left: 20 }),
    dealBreakers: ["money_left"],
    overrides: { "san-francisco-us": { rent_1bed: 20_000 } },
  });
  const sf = money(d, p, city(d, "san-francisco-us"));
  assert.equal(sf.completeness.status, "partial");
  assert.ok(sf.display.monthlyLeft! < 0);
  const e = evaluate(d, p);
  const r = e.results.find((x) => x.city.id === "san-francisco-us")!;
  const line = r.lines.find((l) => l.id === "money_left")!;
  assert.equal(line.check, "fail", "at most a negative figure: failed for certain");
  assert.deepEqual(r.ruledOut, ["Money left each month"]);
  // Its own figure says so, though the line is scored on take-home pay for both cities.
  const own = CRITERIA.find((c) => c.id === "money_left")!.raw({ data: d, profile: p, city: city(d, "san-francisco-us"), money: sf, rights: [] });
  assert.equal(own.value, null);
  assert.match(own.text, /^at most -?€/);
  // Take-home pay is no basis either while San Francisco's premium is missing: money counts for no city, and says so.
  assert.equal(e.moneyBasis?.used, "none");
  // Falsifier: a partial figure above zero proves nothing either way: unknown, never a pass.
  const ok = evaluate(d, { ...p, overrides: { "san-francisco-us": { rent_1bed: 500 } } }).results.find((x) => x.city.id === "san-francisco-us")!;
  assert.equal(ok.lines.find((l) => l.id === "money_left")!.check, "unknown");
});

// ---------- N2 and N4: Italy's benefit bases ----------

test("N2: the trattamento integrativo reads the whole of employment income, exempt share included (D.L. 3/2020 art. 3 c. 2)", () => {
  // Researcher with a 90% exemption at €100,000: INPS = 100,000 × 9.19% + 43,776 × 1% = 9,627.76; work income 90,372.24,
  // taxed 10% = 9,037.22, gross IRPEF 2,078.56 > 1,955 − 75: the post-exemption test would pay €1,200, but 90,372.24 is
  // far above the income limit, so nothing is due.
  const r = italy.compute({ gross: 100_000, region: "IT-21", city: "turin-it", tweak: { taxableShare: 0.1 } });
  near(r.lines.find((l) => l.label.startsWith("INPS"))!.amount, 9_627.76);
  assert.equal(r.lines.find((l) => l.label.startsWith("Trattamento")), undefined);
  // Control: an ordinary employee on €14,000 still gets it.
  assert.ok(italy.compute({ gross: 14_000, region: "IT-21", city: "turin-it" }).lines.some((l) => l.label.startsWith("Trattamento")));
});

test("N4: the cuneo percentage is picked on the whole income and paid on the taxed part (Circolare 4/E 2025, section 1.2)", () => {
  // The circular's example 3: 4,500 taxed + 10,500 exempt = 15,000 picks 5.3%, paid on 4,500 = €238.50.
  near(cuneo(15_000, 4_500).exemptSum, 238.5);
  // The reviewer's €20,000: INPS 1,838, work income 18,162 picks 4.8%. Ordinary: 871.776; 50% exempt: 9,081 × 4.8% = 435.888.
  const sum = (share?: number) => -italy.compute({ gross: 20_000, region: "IT-21", city: "turin-it", tweak: share ? { taxableShare: share } : undefined }).lines.find((l) => l.label.startsWith("Cuneo"))!.amount;
  near(sum(), 871.78);
  near(sum(0.5), 435.89);
});

// ---------- N3: who claims the US Child Tax Credit ----------

test("N3: unmarried parents: the parent the household gains most from claims the child (IRS Publication 501)", () => {
  const d = fixture();
  // $30,000 and $250,000, one child. The high earner's credit is 2,200 − 50 × 50 = 0; the $30,000 parent's is the full
  // $2,200: taxable 30,000 − 16,100 = 13,900, tax 1,240 + 1,500 × 12% = 1,420 used, 780 refunded (under $1,700 and
  // 15% of earnings above $2,500).
  const p = profile({
    displayCurrency: "USD",
    cities: ["san-francisco-us"],
    // The first person is the high earner, so "the first parent claims" would lose the credit too.
    household: [{ label: "Me", citizenships: ["US"] }, { label: "Partner", citizenships: ["US"], relation: "partner", pay: { gross: 30_000, currency: "USD" } }],
    income: { ...profile().income, gross: 250_000, currency: "USD" },
    children: [8],
  });
  const m = money(d, p, city(d, "san-francisco-us"));
  const ctc = m.earners.map((e) => -(e.tax!.lines.find((l) => l.label.startsWith("Child Tax Credit"))?.amount ?? 0));
  near(ctc[0]!, 0);
  near(ctc[1]!, 2_200, 0.01, "the $30,000 parent claims");
  assert.ok(m.tax!.caveats.some((c) => /Partner claims the child/.test(c)));
  // Falsifier: had the high earner claimed, the household would keep $2,200 less.
  const forced = householdTax(unitedStates, { region: "US-CA", city: "san-francisco-us" }, [
    { label: "Me", gross: 250_000, children: [8], claimedChildren: [8] },
    { label: "Partner", gross: 30_000, children: [8], claimedChildren: [] },
  ], false);
  near(m.tax!.net - forced.combined.net, 2_200);
});

test("N3: on a joint return every child either spouse claims counts, once", () => {
  // Two spouses' own lists [4] and [7], on $150,000 together: 2 × 2,200 = 4,400 off the joint federal tax. Federal before
  // credits: 117,800 taxable → 24,800 × 10% + 76,000 × 12% + 17,000 × 22% = 15,340; after: 10,940 (Rev. Proc. 2025-32).
  const h = householdTax(unitedStates, { region: "US-TX" }, [{ label: "A", gross: 150_000, children: [4] }, { label: "B", gross: 0, children: [7] }], true);
  assert.equal(h.filing.mode, "joint");
  const joint = h.combined.lines.filter((l) => l.label.includes("joint return")).reduce((s, l) => s + l.amount, 0);
  near(joint, 10_940);
  // The money path gives both spouses the household's list: each child is still claimed once.
  const d = fixture();
  const p = profile({
    displayCurrency: "USD",
    cities: ["san-francisco-us"],
    household: [{ label: "Me", citizenships: ["US"] }, { label: "Spouse", citizenships: ["US"], spouse: true, relation: "partner" }],
    income: { ...profile().income, gross: 150_000, currency: "USD" },
    children: [4, 7],
  });
  const m = money(d, p, city(d, "san-francisco-us"));
  near(m.tax!.lines.filter((l) => l.label.includes("joint return")).reduce((s, l) => s + l.amount, 0), 10_940);
});

// ---------- N5: tax and cost completeness apart ----------

test("N5: a city with no tax model keeps its known costs: a cost-only comparison scores both", () => {
  const d = fixture();
  d.cities.push({ id: "pristina-xk", name: "Pristina", country: "XK", lat: 42.66, lon: 21.17 });
  d.countries.XK = { code: "XK", name: "Kosovo", currency: "EUR", areas: [] };
  d.observations["pristina-xk"] = [{ metric: "price_level", value: 100, period: "2025", level: "country", source: "test", retrieved: "2026-10-27" }];
  // Torino: 100 rent + 900 spending = 1,000; Pristina: 3,100 + 900 = 4,000. No tax model for Kosovo.
  const p = profile({ cities: ["turin-it", "pristina-xk"], weights: only({ living_cost: 100 }), overrides: { "turin-it": { rent_1bed: 100 }, "pristina-xk": { rent_1bed: 3_100 } } });
  const m = money(d, p, city(d, "pristina-xk"));
  assert.equal(m.taxCompleteness.status, "unsupported");
  assert.equal(m.costCompleteness.status, "complete");
  const e = evaluate(d, p);
  const score = (id: string) => e.results.find((r) => r.city.id === id)!.total;
  // Cost scale [4,500 worst, 1,000 best]: 1,000 → 100; 4,000 → 500 / 3,500 = 14.29.
  near(score("turin-it"), 100);
  near(score("pristina-xk"), 14.29);
});

// ---------- right to live wording ----------

test("[yes, no, unknown]: 1 to 2 of 3 people can move, a lower bound, and the must-pass still fails", () => {
  const d = fixture();
  const p = profile({ cities: ["dublin-ie"], household: [{ label: "Me", citizenships: ["IE"] }, { label: "B", citizenships: ["US"] }, { label: "C", citizenships: [] }], dealBreakers: ["right_to_live"] });
  const line = evaluate(d, p).results[0]!.lines.find((l) => l.id === "right_to_live")!;
  assert.match(line.raw.text, /^1 to 2 of 3 people; C not checked/);
  assert.equal(line.check, "fail");
});

// ---------- S3 and the Dutch salary floor ----------

test("S3: two eligible Dutch employees who both choose the 30% ruling both get it (2 × €79,046.73)", () => {
  // €100,000 each: 30% exempt, taxable 70,000. Box 1: 38,883 × 35.75% + 31,117 × 37.56% = 25,588.22; credits:
  // general 3,115 − 40,264 × 6.398% = 538.91, labour 5,685 − 24,408 × 6.51% = 4,096.04; tax 20,953.27, net 79,046.73.
  const d = withNl(fixture());
  const yes = { "nl-recruited-abroad": true, "nl-150km": true };
  const p = profile({
    cities: ["amsterdam-nl"],
    household: [
      { label: "Me", citizenships: ["IT"], newcomer: { confirmed: yes } },
      { label: "Partner", citizenships: ["IT"], relation: "partner", newcomer: { confirmed: yes }, pay: { gross: 100_000, currency: "EUR" }, regimes: { NL: "nl-expat" } },
    ],
    income: { ...profile().income, gross: 100_000, regimes: { NL: "nl-expat" } },
  });
  const m = money(d, p, city(d, "amsterdam-nl"));
  near(m.earners[0]!.net!, 79_046.73);
  near(m.earners[1]!.net!, 79_046.73);
  near(m.net!, 158_093.46);
  assert.deepEqual(m.regimes.map((r) => [r.person, r.status]), [["Me", "established"], ["Partner", "established"]]);
  // Falsifier: without the partner's own choice, they are taxed on ordinary rules (net 62,710.89 at €100,000).
  const ordinary = money(d, { ...p, household: [p.household[0]!, { ...p.household[1]!, regimes: undefined }] }, city(d, "amsterdam-nl"));
  near(ordinary.earners[1]!.net!, 62_710.89);
});

test("NL 30% ruling at €60,000: the exemption stops at the €48,013 floor and the scenario stays conditional", () => {
  // Staatscourant 2025, 40487 (Uitvoeringsbesluit art. 10eb: €48,013 from 2026). A full 30% would leave 42,000 taxable,
  // under the floor; the exemption is cut to 60,000 − 48,013 = 11,987. Tax on 48,013: 38,883 × 35.75% + 9,130 × 37.56%
  // = 17,329.90; credits 3,115 − 18,277 × 6.398% = 1,945.64 and 5,685 − 2,421 × 6.51% = 5,527.39; tax 9,856.87;
  // net 50,143.13 (the reviewer's cent-precision figure at 48,013.01 is 50,143.12), not the invalid 52,873.95.
  const d = withNl(fixture());
  const p = profile({ cities: ["amsterdam-nl"], household: [{ label: "Me", citizenships: ["IT"] }], income: { ...profile().income, gross: 60_000, regimes: { NL: "nl-expat" } } });
  const m = money(d, p, city(d, "amsterdam-nl"));
  near(m.net!, 50_143.13);
  assert.equal(m.regime?.status, "scenario");
  assert.ok(m.taxCompleteness.approximations.some((a) => /scenario/.test(a)));
  near(netherlands.compute({ gross: 60_000 }).net, 44_093.53, 0.01, "ordinary rules");
});
