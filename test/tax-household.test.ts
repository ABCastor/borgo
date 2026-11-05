// Pension relief, age and children in the country modules, and joint filing for married couples.
import assert from "node:assert/strict";
import { test } from "node:test";
import { careRate, germany, tarif2026 } from "../src/tax/de.ts";
import { earnerTax, householdTax } from "../src/tax/household.ts";
import { TAX_MODELS } from "../src/tax/index.ts";
import { PENSION_RELIEF, pensionRelief } from "../src/tax/pension.ts";
import { poland, taxBase } from "../src/tax/pl.ts";
import { childTaxCredit, unitedStates } from "../src/tax/us.ts";
import { line, near } from "./tax-helpers.ts";

const taxes = (lines: { amount: number; saving?: boolean }[]) => lines.reduce((s, l) => s + (l.saving ? 0 : l.amount), 0);

test("every modelled country has a pension rule, and every rule with relief names its source", () => {
  for (const cc of Object.keys(TAX_MODELS)) {
    const r = PENSION_RELIEF[cc];
    assert.ok(r, `${cc}: no pension rule`);
    if (r.kind === "deduction" || r.kind === "credit") assert.ok(r.source?.url.startsWith("https://"), `${cc}: relief without a source`);
    if (r.kind === "credit") assert.ok(r.rate && r.rate > 0 && r.rate < 1, `${cc}: credit without a rate`);
  }
});

test("a deductible pension contribution lowers income tax in every country that gives that relief, and never raises it", () => {
  const where: Record<string, { region?: string; city?: string }> = { US: { region: "US-CA" }, CH: { region: "CH-ZH", city: "zurich-ch" }, IT: { region: "IT-21", city: "turin-it" } };
  for (const [cc, rule] of Object.entries(PENSION_RELIEF)) {
    const model = TAX_MODELS[cc]!;
    const gross = { JP: 8_000_000, CZ: 1_200_000, HU: 12_000_000, NO: 900_000, SE: 700_000, DK: 700_000, CA: 90_000, US: 120_000, SG: 120_000, AU: 120_000, AE: 300_000 }[cc] ?? 80_000;
    const without = earnerTax(model, where[cc] ?? {}, { label: "You", gross });
    const withP = earnerTax(model, where[cc] ?? {}, { label: "You", gross, pension: 0.05 });
    const paidWithout = taxes(without.result.lines);
    const paidWith = taxes(withP.result.lines);
    if (rule.kind === "deduction" || rule.kind === "credit") assert.ok(paidWith < paidWithout - 1, `${cc}: tax ${paidWith} not below ${paidWithout}`);
    else near(paidWith, paidWithout, 0.01);
    // The pension total is every saving line: the contribution and any tax transfer the state pays into the fund
    // (Hungary's 20%), so the summary and the lines agree.
    const saved = withP.result.lines.reduce((sum, l: { amount: number; saving?: boolean }) => sum + (l.saving ? l.amount : 0), 0);
    near(withP.pension, saved, 0.01);
    assert.ok(withP.pension >= gross * 0.05 - 0.01, `${cc}: pension ${withP.pension} below the contribution`);
    near(withP.result.net, gross - paidWith - saved, 0.05);
    assert.ok(withP.result.lines.some((l: { saving?: boolean; label: string }) => l.saving && l.label.startsWith("Into your pension")), `${cc}: no pension line`);
  }
});

test("pension relief follows the caps, and the caps follow age where the law says so", () => {
  // US 401(k): $24,500, plus $8,000 from 50, $11,250 at 60 to 63.
  assert.equal(pensionRelief("US", 50_000, 300_000, 40).deducted, 24_500);
  assert.equal(pensionRelief("US", 50_000, 300_000, 52).deducted, 32_500);
  assert.equal(pensionRelief("US", 50_000, 300_000, 61).deducted, 35_750);
  // Ireland: 15% under 30 up to 40% from 60, of earnings capped at €115,000.
  assert.equal(pensionRelief("IE", 30_000, 100_000, 25).deducted, 15_000);
  assert.equal(pensionRelief("IE", 30_000, 100_000, 45).deducted, 25_000);
  assert.equal(pensionRelief("IE", 60_000, 200_000, 62).deducted, 46_000);
  // Portugal PPR: 20% credit, at most €400 under 35, €300 over 50.
  near(pensionRelief("PT", 5_000, 50_000, 30).credit, 400, 0.001);
  near(pensionRelief("PT", 5_000, 50_000, 55).credit, 300, 0.001);
  near(pensionRelief("PT", 1_000, 50_000, 30).credit, 200, 0.001);
  // D.Lgs. 252/2005 art. 8(4): €5,300 for tax period 2026, including employer contributions.
  near(pensionRelief("IT", 8_000, 80_000, 40).deducted, 5_300, 0.001);
});

test("Germany: the occupational pension deduction reaches the income tax, not the social insurance", () => {
  const plain = germany.compute({ gross: 60_000 });
  const r = earnerTax(germany, {}, { label: "You", gross: 60_000, pension: 0.05 });
  near(line(r.result, "Health"), line(plain, "Health"), 0.01);
  assert.ok(line(r.result, "Income tax") < line(plain, "Income tax") - 500);
});

test("Germany: care insurance follows the children", () => {
  near(careRate(undefined), 0.024, 1e-9);
  near(careRate([3]), 0.018, 1e-9);
  near(careRate([1, 4, 7]), 0.018 - 0.005, 1e-9);
  near(careRate([1, 2, 3, 4, 5, 6, 7]), 0.018 - 0.01, 1e-9);
  near(careRate([30]), 0.018, 1e-9); // a grown child still ends the childless surcharge
});

test("Poland: the youth relief applies under 26 only", () => {
  assert.ok(taxBase(80_000, 25) === 0, "under 26 and under the limit: nothing taxed");
  assert.ok(taxBase(80_000, 26) > 60_000);
  const young = poland.compute({ gross: 120_000, age: 24 });
  const older = poland.compute({ gross: 120_000, age: 30 });
  assert.ok(line(young, "Income tax") < line(older, "Income tax") / 2);
  near(line(young, "Social insurance"), line(older, "Social insurance"), 0.01);
});

test("United States: the Child Tax Credit for children under 17, phased out above $200,000", () => {
  assert.equal(childTaxCredit(100_000, 20_000, [3, 10]), 4_400);
  assert.equal(childTaxCredit(100_000, 20_000, [17]), 0);
  assert.equal(childTaxCredit(210_000, 40_000, [5]), 1_700); // 2,200 − 50 × 10
  // Low tax: the part the tax does not absorb is refundable up to $1,700 a child.
  assert.equal(childTaxCredit(30_000, 500, [2]), 500 + 1_700);
  const r = unitedStates.compute({ gross: 100_000, region: "US-TX", children: [4] });
  near(line(r, "Child Tax Credit"), -2_200, 0.01);
});

test("joint filing: Germany's splitting helps a couple with unequal pay and changes nothing for equal pay", () => {
  const unequal = householdTax(germany, {}, [{ label: "You", gross: 90_000 }, { label: "Partner", gross: 20_000 }], true);
  assert.equal(unequal.filing.mode, "joint");
  const single = householdTax(germany, {}, [{ label: "You", gross: 90_000 }, { label: "Partner", gross: 20_000 }], false);
  assert.ok(unequal.combined.net > single.combined.net + 1_000, `${unequal.combined.net} vs ${single.combined.net}`);
  // The joint income tax is exactly the splitting tariff on the combined taxable income, shared by base.
  const shares = unequal.people.map((p) => p.result.lines.find((l) => l.label.startsWith("Income tax and solidarity surcharge, joint"))!.amount);
  assert.ok(shares[0]! > shares[1]!);
  const equal = householdTax(germany, {}, [{ label: "You", gross: 50_000 }, { label: "Partner", gross: 50_000 }], true);
  near(equal.combined.net, householdTax(germany, {}, [{ label: "You", gross: 50_000 }, { label: "Partner", gross: 50_000 }], false).combined.net, 1);
  assert.ok(tarif2026(1) === 0);
});

test("joint filing: France taxes a married couple together, always; the US and Poland only when it is cheaper", () => {
  const fr = householdTax(TAX_MODELS.FR!, {}, [{ label: "You", gross: 80_000 }, { label: "Partner", gross: 80_000 }], true);
  assert.equal(fr.filing.mode, "joint");
  const us = householdTax(unitedStates, { region: "US-TX" }, [{ label: "You", gross: 200_000 }, { label: "Partner", gross: 0 }], true);
  assert.equal(us.filing.mode, "joint");
  assert.match(us.filing.note ?? "", /saves/);
  const pl = householdTax(poland, {}, [{ label: "You", gross: 300_000 }, { label: "Partner", gross: 30_000 }], true);
  assert.equal(pl.filing.mode, "joint");
});

test("where joint filing is not modelled, the couple is taxed separately and the country's rule is said", () => {
  const ch = householdTax(TAX_MODELS.CH!, { region: "CH-ZH", city: "zurich-ch" }, [{ label: "You", gross: 120_000 }, { label: "Partner", gross: 40_000 }], true);
  assert.equal(ch.filing.mode, "individual");
  assert.match(ch.filing.note ?? "", /Switzerland taxes married couples together/);
  const it = householdTax(TAX_MODELS.IT!, {}, [{ label: "You", gross: 50_000 }, { label: "Partner", gross: 30_000 }], true);
  assert.match(it.filing.note ?? "", /own income/);
  // Two earners: the combined result carries every line, labelled by person, and adds up.
  assert.ok(ch.combined.lines.every((l) => l.label.startsWith("You: ") || l.label.startsWith("Partner: ")));
  near(ch.combined.net, ch.people[0]!.result.net + ch.people[1]!.result.net, 0.05);
});
