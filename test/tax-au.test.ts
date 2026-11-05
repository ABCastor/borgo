import assert from "node:assert/strict";
import { test } from "node:test";
import { australia, medicareLevy } from "../src/tax/au.ts";

const line = (r: { lines: { label: string; amount: number }[] }, prefix: string) => r.lines.find((l) => l.label.startsWith(prefix))!.amount;
const near = (a: number, b: number, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("Australia 2026-27, $100,000", () => {
  const r = australia.compute({ gross: 100_000 });
  near(line(r, "Income tax"), 20_520); // 4,020 + 30% × 55,000; no offset above $66,667
  near(line(r, "Medicare levy"), 2_000); // 2% × 100,000
  near(r.net, 77_480);
});

test("Australia 2026-27, $40,000 with the low income tax offset", () => {
  // 15% × (40,000 − 18,200) = 3,270; offset 700 − 5% × (40,000 − 37,500) = 575 → 2,695
  const r = australia.compute({ gross: 40_000 });
  near(line(r, "Income tax"), 2_695);
  near(line(r, "Medicare levy"), 800); // above the shade-in range: 2% × 40,000
});

test("Australia: no tax and no Medicare levy under the tax-free threshold", () => {
  const r = australia.compute({ gross: 18_000 });
  assert.equal(line(r, "Income tax"), 0);
  assert.equal(line(r, "Medicare levy"), 0);
});

test("Australia: matches the ATO's published Medicare levy examples", () => {
  // ATO, Medicare levy reduction for low-income earners: Angie, taxable income $29,000, levy reduced to $98.90.
  near(medicareLevy(29_000), 98.9, 0.01);
  // ATO, what is the Medicare levy: Matthew, taxable income $75,000, levy $1,500.
  near(medicareLevy(75_000), 1_500, 0.01);
});

test("Australia: a flat rate replaces the income tax schedule", () => {
  const r = australia.compute({ gross: 100_000, tweak: { flatRate: 0.2 } });
  near(line(r, "Income tax"), 20_000);
});
