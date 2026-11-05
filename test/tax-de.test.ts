import assert from "node:assert/strict";
import { test } from "node:test";
import { germany, soli, tarif2026, taxableIncome } from "../src/tax/de.ts";
import { line, near } from "./tax-helpers.ts";

test("Germany: § 32a 2026 zones join up and the basic allowance is tax-free", () => {
  assert.equal(tarif2026(12_348), 0);
  // zone 3 at 69,878: z = 5.2079 → (173.10 z + 2,397) z + 1,034.87 = 18,213.07; zone 4: 0.42 × 69,878 − 11,135.63 = 18,213.13
  assert.equal(tarif2026(69_878), 18_213);
  assert.equal(tarif2026(69_879), Math.floor(0.42 * 69_879 - 11_135.63));
});

test("Germany 2026, €50,000 in Berlin", () => {
  const r = germany.compute({ gross: 50_000, city: "berlin-de" });
  near(line(r, "Health"), 4_375); // 8.75%
  near(line(r, "Care"), 1_200); // 2.4%
  near(line(r, "Pension"), 4_650); // 9.3%
  near(line(r, "Unemployment"), 650); // 1.3%
  // zvE = 50,000 − 1,230 − 36 − 4,650 − (4,375 × 0.96 + 1,200) = 38,684
  near(taxableIncome(50_000), 38_684, 0.01);
  // z = 2.0885: (173.10 × 2.0885 + 2,397) × 2.0885 + 1,034.87 = 6,796.04 → 6,796
  near(line(r, "Income tax"), 6_796, 0);
  near(line(r, "Solidarity"), 0, 0);
  near(r.net, 32_329);
});

test("Germany 2026, €120,000: contribution ceilings and the soli phase-in", () => {
  const r = germany.compute({ gross: 120_000 });
  near(line(r, "Health"), 6_103.13); // 69,750 × 8.75%
  near(line(r, "Pension"), 9_430.2); // 101,400 × 9.3%
  // zvE = 120,000 − 1,266 − 9,430.20 − (6,103.125 × 0.96 + 1,674) = 101,770.80 → 0.42 × 101,770 − 11,135.63 = 31,607.77 → 31,607
  near(line(r, "Income tax"), 31_607, 0);
  // soli = min(5.5% × 31,607, 11.9% × (31,607 − 20,350)) = 1,339.58
  near(line(r, "Solidarity"), 1_339.58);
  near(soli(100_000), 5_500);
});
