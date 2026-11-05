import assert from "node:assert/strict";
import { test } from "node:test";
import { progressive } from "../src/tax/common.ts";
import { INCOME_TAX, japan, socialInsurance, standardMonthly } from "../src/tax/jp.ts";

const line = (r: { lines: { label: string; amount: number }[] }, prefix: string) => r.lines.find((l) => l.label.startsWith(prefix))!.amount;
const near = (a: number, b: number, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("Japan 2026, ¥6,000,000 in Tokyo", () => {
  // Monthly 500,000 → grade 500,000: health 4.925% + child levy 0.115% → 25,200/month = 302,400;
  // pension 9.15% = 45,750/month = 549,000; employment insurance 0.5% = 30,000. Premiums 881,400.
  // Employment income 6,000,000 − (20% × 6,000,000 + 440,000) = 4,360,000; basic deduction 1,040,000 (≤ 4.89M).
  // Taxable 4,360,000 − 881,400 − 1,040,000 = 2,438,600 → 2,438,000; tax 10% − 97,500 = 146,300; surtax 2.1% = 3,072.30.
  // Resident: 4,360,000 − 881,400 − 430,000 → 3,048,000 × 10% = 304,800 − 2,500 adjustment + 5,000 per capita = 307,300.
  const r = japan.compute({ gross: 6_000_000 });
  near(line(r, "Health"), 302_400);
  near(line(r, "Employees' pension"), 549_000);
  near(line(r, "Employment insurance"), 30_000);
  near(line(r, "Income tax"), 146_300);
  near(line(r, "Reconstruction surtax"), 3_072.3);
  near(line(r, "Resident tax"), 307_300);
  near(r.net, 4_661_927.7);
});

test("Japan 2026, ¥12,000,000 in Tokyo: pension ceiling and the ¥620,000 basic deduction", () => {
  // Monthly 1,000,000 → grade 980,000: health + levy 5.04% = 49,392/month = 592,704; pension capped at 650,000 × 9.15%
  // = 59,475/month = 713,700; employment insurance 60,000. Premiums 1,366,404.
  // Employment income 12,000,000 − 1,950,000 = 10,050,000; basic deduction 620,000.
  // Taxable 10,050,000 − 1,366,404 − 620,000 = 8,063,596 → 8,063,000; 23% − 636,000 = 1,218,490; surtax 25,588.29.
  // Resident: 10,050,000 − 1,366,404 − 430,000 → 8,253,000 × 10% = 825,300 − 2,500 + 5,000 = 827,800.
  const r = japan.compute({ gross: 12_000_000 });
  near(line(r, "Employees' pension"), 713_700);
  near(line(r, "Income tax"), 1_218_490);
  near(line(r, "Reconstruction surtax"), 25_588.29);
  near(line(r, "Resident tax"), 827_800);
  near(r.net, 8_561_717.71);
});

test("Japan: matches the NTA's worked example (taxable ¥7,000,000 → ¥974,000)", () => {
  assert.equal(progressive(7_000_000, INCOME_TAX), 974_000); // 7,000,000 × 23% − 636,000
});

test("Japan: premiums match the Kyokai Kenpo Tokyo table from March 2026", () => {
  // Table, grade 30 (500,000): health half 24,625.0, child levy half 575, pension half 45,750.
  // Grade 43 (980,000, pay 955,000 to 1,005,000): health half 48,265.0, child levy half 1,127, pension capped at 59,475.
  assert.equal(standardMonthly(500_000), 500_000);
  assert.equal(standardMonthly(1_000_000), 980_000);
  near(socialInsurance(6_000_000).health / 12, 24_625 + 575, 0.01);
  near(socialInsurance(12_000_000).health / 12, 48_265 + 1_127, 0.01);
  near(socialInsurance(12_000_000).pension / 12, 59_475, 0.01);
});

test("Japan: no income or resident tax under the ¥1.78 million line", () => {
  // ¥1,190,000: employment income 1,190,000 − 740,000 = 450,000, at the 23 wards' non-taxable limit.
  const r = japan.compute({ gross: 1_190_000 });
  assert.equal(line(r, "Income tax"), 0);
  assert.equal(line(r, "Resident tax"), 0);
});

test("Japan: a taxable share cuts national and resident tax; a flat rate replaces only the national schedule", () => {
  const full = japan.compute({ gross: 12_000_000 });
  const half = japan.compute({ gross: 12_000_000, tweak: { taxableShare: 0.5 } });
  assert.ok(line(half, "Income tax") < line(full, "Income tax"));
  assert.ok(line(half, "Resident tax") < line(full, "Resident tax"));
  const flat = japan.compute({ gross: 12_000_000, tweak: { flatRate: 0.1 } });
  near(line(flat, "Income tax"), (10_050_000 - 1_366_404) * 0.1);
  near(line(flat, "Resident tax"), 827_800);
});
