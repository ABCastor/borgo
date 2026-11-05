import assert from "node:assert/strict";
import { test } from "node:test";
import { belgium, brusselsCentimes, incomeTaxes, socialSecurity, stateTax, workBonus, type IncomeYear } from "../src/tax/be.ts";
import { regimeById, regimeTweak } from "../src/tax/regimes.ts";
import { line, near } from "./tax-helpers.ts";

// Income 2025 (tax year 2026), the year Tax-Calc simulates: SPF Finances' rates and expenses pages.
// The fiscal work bonus cap is left open: neither Tax-Calc case reaches it.
const INCOME_2025: IncomeYear = {
  scale: [
    [16_320, 0.25],
    [28_800, 0.4],
    [49_840, 0.45],
    [Infinity, 0.5],
  ],
  taxFree: 10_910,
  expensesCap: 5_930,
  workBonusCredit: { a: 0.3314, b: 0.5254, cap: Infinity },
};
const BRUSSELS = { region: "BE-BRU", city: "brussels-be" };

test("Belgium: the scale matches SPF Finances' worked example (single, €38,000 taxable, income 2025 → €10,484.50)", () => {
  near(stateTax(38_000, INCOME_2025), 10_484.5, 0.01);
});

test("Belgium: Brussels' centimes come out at 32.591% from the ordinance's formula", () => {
  near(brusselsCentimes(), 0.32591, 1e-9);
});

test("Belgium: matches Tax-Calc (tax year 2026, Brussels 1000) on €43,465 taxable pay (queried 27 Oct 2026)", () => {
  const lines = incomeTaxes(43_465, { a: 0, b: 0 }, INCOME_2025, BRUSSELS);
  const r = { lines } as Parameters<typeof line>[0];
  // Tax-Calc: expenses 5,930 → 37,535; state tax 10,275.25; × 75.043% = 7,710.86; regional × 32.591% = 2,513.05;
  // municipal 4.9% of 10,223.91 = 500.97; special contribution 343.16; total 11,068.04
  near(line(r, "Federal"), 7_710.86, 0.01);
  near(line(r, "Regional"), 2_513.05, 0.01);
  near(line(r, "Municipal"), 500.97, 0.01);
  near(line(r, "Special social security"), 343.16, 0.01);
  near(lines.reduce((s, l) => s + l.amount, 0), 11_068.04, 0.02);
});

test("Belgium: matches Tax-Calc on €26,079 taxable pay with a €600 + €800 work bonus (queried 27 Oct 2026)", () => {
  const lines = incomeTaxes(26_079, { a: 600, b: 800 }, INCOME_2025, BRUSSELS);
  const r = { lines } as Parameters<typeof line>[0];
  // Tax-Calc: 20,149 taxable; state tax 2,884.10; federal 2,164.32; regional 705.37; municipal 140.61;
  // work bonus credit 33.14% × 600 + 52.54% × 800 = 619.16; special contribution 77.85; total 2,468.99
  near(line(r, "Federal"), 2_164.32, 0.01);
  near(line(r, "Regional"), 705.37, 0.01);
  near(line(r, "Municipal"), 140.61, 0.01);
  near(line(r, "Fiscal work bonus"), -619.16, 0.01);
  near(line(r, "Special social security"), 77.85, 0.01);
  near(lines.reduce((s, l) => s + l.amount, 0), 2_468.99, 0.02);
});

test("Belgium 2026, €60,000 in Brussels: no work bonus, expenses at their cap", () => {
  const r = belgium.compute({ gross: 60_000, ...BRUSSELS });
  near(line(r, "Social security"), 7_842); // 13.07%
  // taxable = 52,158 − 6,070 = 46,088; scale 4,180 + 5,116 + 16,578 × 45% = 16,756.10; less 25% × 11,550 → 13,868.60
  near(line(r, "Federal"), 10_407.41); // × 75.043%
  near(line(r, "Regional"), 3_391.88); // × 32.591%
  near(line(r, "Municipal"), 676.17); // 4.9% of 13,799.29
  near(line(r, "Special social security"), 548.12); // 481.96 + 1.2996% × 5,090.74
  near(r.net, 60_000 - 7_842 - 10_407.41 - 3_391.88 - 676.17 - 548.12, 1);
});

test("Belgium 2026, €30,000 in Brussels: the work bonus lowers contributions and comes back as a tax credit", () => {
  // €2,500 a month. Part A: 123.00 (Jan-Mar), 125.04 (Apr-Jun), 127.54 (Jul-Dec) → 1,509.36.
  // Part B: 165.87 − 0.2699 × 281.27 = 89.96 (Jan-Mar), 168.62 − 0.2699 × 244.50 = 102.63 (Apr-Jun),
  // 171.99 − 0.2699 × 199.38 = 118.18 (Jul-Dec) → 1,286.85
  const bonus = workBonus(30_000);
  near(bonus.a, 1_509.36, 0.05);
  near(bonus.b, 1_286.85, 0.05);
  const r = belgium.compute({ gross: 30_000, ...BRUSSELS });
  near(line(r, "Social security"), 3_921 - 2_796.21, 0.1);
  // taxable = 28,875.21 − 6,070 = 22,805.21; state 4,180 + 6,085.21 × 40% − 2,887.50 = 3,726.58
  near(line(r, "Federal"), 2_796.54); // × 75.043%
  near(line(r, "Regional"), 911.42);
  near(line(r, "Municipal"), 181.69);
  near(line(r, "Fiscal work bonus"), -1_310.92, 0.1); // 33.14% × 1,509.36 + 63% × 1,286.85
  near(line(r, "Special social security"), 146.5); // 123.95 + 1.3% × 1,734.25
});

test("Belgium: at very low pay the work bonus is capped by the contributions due", () => {
  const ss = socialSecurity(18_000); // €1,500 a month: 196.05 due, part A alone is 123-127.54
  assert.ok(ss.contributions >= 0);
  near(ss.contributions, 0, 0.01);
});

test("Belgium: the impatriate regime lowers income tax but not social security", () => {
  const plain = belgium.compute({ gross: 120_000, ...BRUSSELS });
  const tweak = regimeTweak(regimeById("be-impatriate")!, 120_000);
  const r = belgium.compute({ gross: 120_000, ...BRUSSELS, tweak });
  assert.equal(line(r, "Social security"), line(plain, "Social security"));
  assert.ok(line(r, "Federal") < line(plain, "Federal") - 8_000);
  assert.ok(line(r, "Regional") < line(plain, "Regional"));
  assert.ok(r.net > plain.net + 10_000);
});

test("Belgium: a flat rate for every layer replaces federal, regional and municipal tax", () => {
  const r = belgium.compute({ gross: 100_000, ...BRUSSELS, tweak: { flatRate: 0.3, flatRateScope: "all" } });
  assert.ok(!r.lines.some((l) => l.label.startsWith("Regional") || l.label.startsWith("Municipal")));
  const taxable = 100_000 - line(r, "Social security") - 6_070;
  near(line(r, "Income tax"), taxable * 0.3);
});
