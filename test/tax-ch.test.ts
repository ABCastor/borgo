import { test } from "node:test";
import assert from "node:assert/strict";
import { bvgEmployee, cantonalTaxes, coordinatedSalary, federalTax, nbuPremium, switzerland, taxableIncomes } from "../src/tax/ch.ts";
import { line, near } from "./tax-helpers.ts";

test("Switzerland: matches the ESTV calculator on CHF 80,000 taxable income (queried 27 Oct 2026)", () => {
  // ESTV API_calculateSimpleTaxes 2026, single, no confession: federal 1,378
  near(federalTax(80_000), 1_378, 1); // 1,152.50 + 3,800 × 5.94% = 1,378.22
  // Zurich: simple tax 4,370 → canton 95% = 4,152, city 119% = 5,200
  const zh = cantonalTaxes("CH-ZH", "zurich-ch", 80_000);
  near(zh.canton, 4_152, 1);
  near(zh.city, 5_200, 1);
  // Geneva: base 7,337 → canton 9,597, city 3,338
  const ge = cantonalTaxes("CH-GE", "geneva-ch", 80_000);
  near(ge.canton, 9_597, 1);
  near(ge.city, 3_338, 1);
});

test("Switzerland 2026, CHF 100,000 in Zurich", () => {
  const r = switzerland.compute({ gross: 100_000, region: "CH-ZH", city: "zurich-ch" });
  near(line(r, "AHV"), 5_300);
  near(line(r, "Unemployment"), 1_100);
  // BVG statutory minimum (BVV 2 art. 5, BVG art. 16): coordinated 90,720 − 26,460 = 64,260; no age given, so the
  // 35-44 credit of 10% = 6,426, the employee's half 3,213. NBU at the assumed 1% = 1,000.
  near(line(r, "Occupational pension"), 3_213);
  near(line(r, "Non-occupational accident"), 1_000);
  // Before BVG and NBU the ESTV calculator's figure: net 93,600; federal taxable = 93,600 − 2,808 (3%) − 1,800 = 88,992.
  near(taxableIncomes(100_000).federal, 88_992, 0.01);
  // With them: net wage 100,000 − 6,400 − 3,213 − 1,000 = 89,387; federal taxable = 89,387 − 2,681.61 − 1,800
  // = 84,905.39 → 84,900: 1,502.95 + 2,800 × 6.6% = 1,687.75
  near(line(r, "Federal"), 1_687.75);
  // cantonal taxable = 89,387 − 2,681.61 − 2,900 = 83,805.39 → 83,800; simple 4,046 + 7,400 × 9% = 4,712
  near(line(r, "Cantonal"), 4_712 * 0.95);
  near(line(r, "Communal"), 4_712 * 1.19);
  near(line(r, "Personal"), 24);
  near(r.net, 100_000 - 5_300 - 1_100 - 3_213 - 1_000 - 1_687.75 - 4_476.4 - 5_607.28 - 24);
  // Both payroll lines are stand-ins for the employer's own plan and insurer: approximate, and each is named.
  assert.equal(r.completeness.status, "approximate");
  assert.ok(r.completeness.approximations.some((a) => /BVG/.test(a) && /35 to 44/.test(a)));
  assert.ok(r.completeness.approximations.some((a) => /NBU/.test(a)));
});

test("Switzerland: BVG follows the statutory thresholds and age credits", () => {
  // At or below the CHF 22,680 entry threshold nothing is insured; just above it, the CHF 3,780 minimum coordinated salary.
  assert.equal(coordinatedSalary(22_680), 0);
  assert.equal(coordinatedSalary(25_000), 3_780);
  assert.equal(coordinatedSalary(50_000), 50_000 - 26_460);
  assert.equal(coordinatedSalary(200_000), 90_720 - 26_460);
  // BVG art. 16: 7% from 25, 10% from 35, 15% from 45, 18% from 55; none before 25; the employee pays half.
  assert.equal(bvgEmployee(80_000, 24), 0);
  near(bvgEmployee(80_000, 30), ((80_000 - 26_460) * 0.07) / 2);
  near(bvgEmployee(80_000, 50), ((80_000 - 26_460) * 0.15) / 2);
  near(bvgEmployee(80_000, 60), ((80_000 - 26_460) * 0.18) / 2);
  // NBU stops at the UVG maximum insured earnings.
  near(nbuPremium(200_000), 1_482);
});

test("Switzerland 2026, CHF 100,000 in Geneva", () => {
  // The ESTV calculator's cantonal figures at its own taxable income (no BVG or NBU): 87,223.
  // base = 7,015.10 + 9,493 × 14.2% = 8,363.11; canton × 1.308 = 10,938.95 (ESTV 10,939); city × 45.49% = 3,804.38 (ESTV 3,804)
  const estv = cantonalTaxes("CH-GE", "geneva-ch", 87_223);
  near(estv.canton, 10_938.95);
  near(estv.city, 3_804.38);
  const r = switzerland.compute({ gross: 100_000, region: "CH-GE", city: "geneva-ch" });
  // With BVG and NBU: cantonal taxable = 89,387 − 1,817 − 4,560 = 83,010; base = 7,015.10 + 5,280 × 14.2% = 7,764.86
  near(line(r, "Cantonal"), 7_764.86 * 1.308);
  near(line(r, "Communal"), 7_764.86 * 0.4549);
  near(line(r, "Personal"), 25);
});

test("Switzerland: federal tax is a flat 11.5% from CHF 794,000", () => {
  near(federalTax(1_000_000), 115_000);
});
