// The money contract: one unit for the health premium, spending as it is where you spend it, no number in a field
// whose currency it is not, tax settings that stay with their person, and a completeness status on every money result so
// an omitted tax or compulsory cost never reads as a saving.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { breakEven, money } from "../src/core/money.ts";
import { moneyGap } from "../src/core/criteria.ts";
import { METRICS } from "../src/core/metrics.ts";
import type { Dataset } from "../src/core/types.ts";
import { cityFacts, figureText } from "../src/site/facts.ts";
import { fixture, profile } from "./fixture.ts";

const city = (d: Dataset, id: string) => d.cities.find((c) => c.id === id)!;

test("health_premium is the household's premium a month: 300 adds 300 to the month, and fills the premium gap", () => {
  const d = fixture();
  const sf = city(d, "san-francisco-us");
  const without = money(d, profile(), sf);
  const withPremium = money(d, profile({ overrides: { "san-francisco-us": { health_premium: 300 } } }), sf);
  assert.ok(Math.abs(withPremium.monthlyCost! - without.monthlyCost! - 300) < 1e-9);
  assert.equal(METRICS.health_premium!.unit, "/month");
  // Without it the premium is named as left out and money left is partial: not scored as a whole figure.
  assert.equal(without.completeness.status, "partial");
  assert.ok(without.completeness.missing.some((o) => o.includes("health insurance premium")));
  assert.ok(moneyGap(without));
  assert.equal(withPremium.completeness.status, "complete");
  assert.equal(moneyGap(withPremium), null);
});

test("your spending where you spend it needs no price index; another city needs both", () => {
  const d = fixture();
  d.observations["turin-it"] = d.observations["turin-it"]!.filter((o) => o.metric !== "price_level");
  const home = money(d, profile(), city(d, "turin-it"));
  assert.equal(home.everyday?.monthly, 900);
  // Dublin cannot be scaled from Turin without Turin's price level: no invented figure.
  assert.equal(money(d, profile(), city(d, "dublin-ie")).everyday, null);
});

test("break-even is null rather than a home-currency number in the display currency", () => {
  const d = fixture();
  const p = profile({ displayCurrency: "JPY", income: { ...profile().income, everyday: { amount: 900, currency: "EUR", homeCity: "turin-it" } } });
  const home = money(d, p, city(d, "turin-it"));
  assert.notEqual(home.monthlyLeft, null);
  assert.equal(breakEven(d, p, city(d, "dublin-ie"), home, "turin-it"), null);
  // And between whole figures it is there.
  const eur = profile();
  assert.notEqual(breakEven(d, eur, city(d, "dublin-ie"), money(d, eur, city(d, "turin-it")), "turin-it"), null);
  // Against a partial city (a US premium left out) there is none.
  assert.equal(breakEven(d, eur, city(d, "san-francisco-us"), money(d, eur, city(d, "turin-it")), "turin-it"), null);
});

test("your tax settings stay yours: a partner's pay does not take your Singapore CPF exemption", () => {
  const d = fixture();
  d.cities.push({ id: "singapore-sg", name: "Singapore", country: "SG", lat: 1.29, lon: 103.85 });
  d.countries.SG = { code: "SG", name: "Singapore", currency: "SGD", areas: [] };
  d.fx.rates.SGD = 1.5;
  const p = profile({
    household: [
      { label: "Me", citizenships: ["IT"] },
      { label: "Cofounder", citizenships: ["SG"], relation: "cofounder", pay: { gross: 60_000, currency: "EUR" } },
    ],
    income: { ...profile().income, taxTweaks: { SG: { noSocialContributions: true } } },
  });
  const m = money(d, p, city(d, "singapore-sg"));
  const cpf = (label: string) => m.earners.find((e) => e.label === label)!.tax!.lines.filter((l) => /CPF/.test(l.label)).reduce((s, l) => s + l.amount, 0);
  assert.equal(cpf("Me"), 0);
  assert.ok(cpf("Cofounder") > 0);
  assert.ok(m.tax!.caveats.some((c) => c.includes("apply to you only")));
});

test("no tax model: money is unsupported, with no take-home figure", () => {
  const d = fixture();
  d.cities.push({ id: "tel-aviv-il", name: "Tel Aviv", country: "IL", lat: 32.08, lon: 34.78 });
  d.countries.IL = { code: "IL", name: "Israel", currency: "ILS", areas: [] };
  d.fx.rates.ILS = 4;
  const m = money(d, profile(), city(d, "tel-aviv-il"));
  assert.equal(m.net, null);
  assert.equal(m.completeness.status, "unsupported");
  assert.ok(moneyGap(m));
});

test("a city under its own tax system (Bilbao) gets no take-home figure from the common regime", () => {
  const d = fixture();
  d.cities.push({ id: "bilbao-es", name: "Bilbao", country: "ES", region: "ES-PV", lat: 43.26, lon: -2.93 });
  d.countries.ES = { code: "ES", name: "Spain", currency: "EUR", areas: ["EU"] };
  const m = money(d, profile(), city(d, "bilbao-es"));
  assert.equal(m.net, null);
  assert.equal(m.completeness.status, "unsupported");
  assert.ok(m.missing.some((x) => x.startsWith("a tax model for Bilbao")));
});

test("children count for both parents (Germany's care insurance), and one parent claims each child's credits", () => {
  const d = fixture();
  d.cities.push({ id: "berlin-de", name: "Berlin", country: "DE", lat: 52.52, lon: 13.4 });
  d.countries.DE = { code: "DE", name: "Germany", currency: "EUR", areas: ["EU"] };
  const p = profile({
    household: [
      { label: "Me", citizenships: ["IT"], newcomer: { age: 35 } },
      { label: "Partner", citizenships: ["IT"], relation: "partner", newcomer: { age: 35 }, pay: { gross: 40_000, currency: "EUR" } },
    ],
    children: [3],
  });
  const m = money(d, p, city(d, "berlin-de"));
  const care = (label: string) => m.earners.find((e) => e.label === label)!.tax!.lines.find((l) => l.label === "Care insurance")!.amount;
  // § 55 SGB XI: a parent pays 1.8%, no childless surcharge.
  assert.ok(Math.abs(care("Partner") - 40_000 * 0.018) < 0.01);
  // US: unmarried parents, one child: the Child Tax Credit is claimed once, by one parent. Both earn below the $200,000
  // phase-out with tax above $2,200, so either gets the full $2,200 (Rev. Proc. 2025-32); the first parent is kept on a tie.
  const us = money(d, { ...p, household: [{ ...p.household[0]!, }, { ...p.household[1]!, pay: { gross: 90_000, currency: "EUR" } }] }, city(d, "san-francisco-us"));
  const ctc = us.earners.map((e) => e.tax!.lines.find((l) => l.label.startsWith("Child Tax Credit"))?.amount ?? 0);
  assert.equal(ctc.filter((x) => x !== 0).length, 1);
  assert.ok(Math.abs(ctc.reduce((a, b) => a + b, 0) + 2_200) < 0.01);
});

test("static pages: annual childcare reads as a year, and money not in local currency carries its currency", () => {
  const year = figureText(28_850, METRICS.childcare_net_couple_2!, "GBP");
  assert.match(year, /a year$/);
  assert.match(year, /£/);
  assert.doesNotMatch(year, /a month/);
  assert.match(figureText(807, METRICS.health_oop!, "GBP"), /\$|USD/);
  assert.match(figureText(807, METRICS.health_oop!, "GBP"), /a year per person$/);
});

test("static pages: one take-home for one salary on the Amsterdam page (no regime by default)", () => {
  const data = JSON.parse(readFileSync(join(import.meta.dirname, "..", "public/data/dataset.json"), "utf8")) as Dataset;
  if (!data.cities.some((c) => c.id === "amsterdam-nl")) return;
  const f = cityFacts(data, "amsterdam-nl", []);
  const row = f.takeHome!.rows.find((r) => r.gross === f.budget.gross);
  assert.ok(row, "the default salary is one of the reference rows");
  assert.equal(f.budget.net, row!.net);
});

// The scoring contract, one test per status: "complete" and "approximate" money is scored; "partial" and "unsupported"
// money is unknown, never a figure that looks better than it is.
const scoredLeft = async (d: Dataset, p: ReturnType<typeof profile>, id: string) => {
  const { evaluate } = await import("../src/core/engine.ts");
  const zero = Object.fromEntries(Object.keys(p.weights).map((k) => [k, 0]));
  const r = evaluate(d, { ...p, weights: { ...zero, money_left: 20 } }).results.find((x) => x.city.id === id)!;
  return r.lines.find((l) => l.id === "money_left")!;
};

test("completeness complete: money left is scored", async () => {
  const d = fixture();
  const m = money(d, profile(), city(d, "turin-it"));
  assert.equal(m.completeness.status, "complete");
  assert.equal(moneyGap(m), null);
  assert.equal((await scoredLeft(d, profile({ cities: ["turin-it"] }), "turin-it")).raw.value, m.display.monthlyLeft);
});

test("completeness approximate (a regime chosen as a scenario): money left is scored, the stand-in named", async () => {
  const d = fixture();
  const p = profile({ income: { ...profile().income, regimes: { IT: "it-impatriati" } } });
  const m = money(d, p, city(d, "turin-it"));
  assert.equal(m.completeness.status, "approximate");
  assert.ok(m.completeness.approximations.some((a) => a.includes("scenario")));
  assert.equal(moneyGap(m), null);
  assert.equal((await scoredLeft(d, { ...p, cities: ["turin-it"] }, "turin-it")).raw.value, m.display.monthlyLeft);
});

test("completeness partial (a compulsory premium left out): money left is unknown, and says what is missing", async () => {
  const d = fixture();
  const m = money(d, profile(), city(d, "san-francisco-us"));
  assert.equal(m.completeness.status, "partial");
  assert.ok(m.monthlyLeft !== null, "the model has a figure, too high to use");
  assert.match(moneyGap(m)!, /partial: it leaves out health insurance premium/);
  // Its tax is whole, but take-home pay there still holds the premium that elsewhere comes out of pay, so it is no
  // fairer a basis: money counts for no city until the premium is given, and the partial money left is never scored.
  assert.equal(moneyGap(m, "net"), null);
  assert.ok(moneyGap(m, "cost"));
  const l = await scoredLeft(d, profile(), "san-francisco-us");
  assert.equal(l.basis, null);
  assert.equal(l.score, null);
  // With the premium given (and a rent missing elsewhere), take-home pay is compared less the premium: $300 at 1.1 USD.
  const d2 = fixture();
  d2.observations["dublin-ie"] = d2.observations["dublin-ie"]!.filter((o) => o.metric !== "rent_1bed");
  const given = profile({ overrides: { "san-francisco-us": { health_premium: 300 } } });
  const l2 = await scoredLeft(d2, given, "san-francisco-us");
  const m2 = money(d2, given, city(d2, "san-francisco-us"));
  assert.equal(l2.basis, "take-home pay less any compulsory health premium (rent and spending not counted)");
  assert.ok(Math.abs(l2.raw.value! - (m2.display.net! / 12 - 300 / 1.1)) < 1e-9);
});

test("completeness unsupported (no tax model): money left is unknown", async () => {
  const d = fixture();
  d.cities.push({ id: "bilbao-es", name: "Bilbao", country: "ES", region: "ES-PV", lat: 43.26, lon: -2.93 });
  d.countries.ES = { code: "ES", name: "Spain", currency: "EUR", areas: ["EU"] };
  const m = money(d, profile(), city(d, "bilbao-es"));
  assert.equal(m.completeness.status, "unsupported");
  assert.match(moneyGap(m)!, /^money here is unsupported/);
  assert.ok(moneyGap(m, "net"));
  // No take-home pay here, so money left and take-home are unknown: every city is compared on cost instead.
  d.observations["bilbao-es"] = d.observations["turin-it"]!.map((o) => ({ ...o }));
  const priced = money(d, profile(), city(d, "bilbao-es"));
  const p = profile({ cities: ["turin-it", "bilbao-es"] });
  const l = await scoredLeft(d, p, "bilbao-es");
  assert.equal(l.basis, "cost a month (pay not counted)");
  assert.equal(l.raw.value, priced.display.monthlyCost);
  assert.ok(priced.display.monthlyCost !== null && priced.display.net === null);
});

test("childcare with no figure scores as unknown on the childcare line, never as free", async () => {
  const { evaluate } = await import("../src/core/engine.ts");
  const d = fixture();
  const p = profile({ children: [2], weights: { childcare: 50 } });
  const dublin = evaluate(d, p).results.find((r) => r.city.id === "dublin-ie")!;
  const line = dublin.lines.find((l) => l.id === "childcare")!;
  assert.equal(line.raw.value, null);
});
