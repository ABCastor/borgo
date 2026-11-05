import { test } from "node:test";
import { austria, regularTax } from "../src/tax/at.ts";
import { line, near } from "./tax-helpers.ts";

test("Austria: matches the BMF Brutto-Netto-Rechner 2026 for €4,000 × 14 in Vienna (queried 27 Oct 2026)", () => {
  // Calculator: SV 10,159.20, Lohnsteuer 6,941.78 (6,580.92 regular + 360.86 on the 13th/14th), net 38,899.02
  const r = austria.compute({ gross: 56_000, city: "vienna-at" });
  near(line(r, "Social insurance"), 10_159.2, 0.01); // 48,000 × 18.32% + 8,000 × 17.07%
  // regular: 48,000 − 8,793.60 − 132 = 39,074.40 → 1,690.60 + 4,339.80 + 2,616.40 × 40% = 7,076.96, less 496
  near(line(r, "Income tax on regular"), 6_580.96);
  // special: 8,000 − 1,365.60 − 620 = 6,014.40 × 6% = 360.86
  near(line(r, "Tax on 13th"), 360.86);
  near(r.net, 38_899.02, 0.1);
});

test("Austria 2026, €28,000 (€2,000 × 14): no unemployment contribution, the low-income supplement at assessment", () => {
  const r = austria.compute({ gross: 28_000, city: "vienna-at" });
  near(line(r, "Social insurance"), 24_000 * 0.1537 + 4_000 * 0.1412); // 3,688.80 + 564.80
  // regular base 20,179.20: tariff 1,328.04 (as the calculator); credits 496 + 804 × 10,079.80 / 10,498 = 771.97
  // The payroll calculator shows 832.04 here because the supplement is only granted on assessment.
  near(line(r, "Income tax on regular"), 1_328.04 - 496 - 771.97);
  near(line(r, "Tax on 13th"), (4_000 - 564.8 - 620) * 0.06); // 168.91
});

test("Austria 2026, €100,000: contribution ceilings", () => {
  const r = austria.compute({ gross: 100_000, city: "vienna-at" });
  // 12 × 6,930 × 18.32% + 13,860 × 17.07% = 15,234.91 + 2,365.90
  near(line(r, "Social insurance"), 17_600.81);
  // regular: 85,714.29 − 15,234.91 − 132 = 70,347.38 → 6,030.40 + 13,555.75 − 496
  near(line(r, "Income tax on regular"), 19_090.15);
  // special: 14,285.71 − 2,365.90 − 620 = 11,299.81 × 6% = 677.99
  near(line(r, "Tax on 13th"), 677.99);
});

test("Austria: below zero, part of the contributions is refunded", () => {
  near(regularTax(12_000, 2_000), -1_100); // credits 1,300, 55% of 2,000 = 1,100
});
