import { test } from "node:test";
import { contributions, france, incomeTaxOn, taxableIncome } from "../src/tax/fr.ts";
import { progressive } from "../src/tax/common.ts";
import { line, near } from "./tax-helpers.ts";

test("France: the scale matches Service-Public's worked example (single, €30,000 net taxable → €2,103.99 before décote)", () => {
  near(progressive(30_000, [[11_600, 0], [29_579, 0.11], [84_577, 0.3], [181_917, 0.41], [Infinity, 0.45]]), 2_103.99, 0.01);
});

test("France: contributions match the Urssaf mon-entreprise simulator at €50,000 (queried 27 Oct 2026)", () => {
  // Simulator, per month: vieillesse 293.0117 + retraite complémentaire 140.1255 + CEG 36.189 + CET 5.8333 = 475.1595 → ×12
  near(contributions(50_000), 5_701.91, 0.05);
  // Simulator net imposable 3,411.77 a month includes a €20 mutuelle and its employer share; ours is about €1.36 a month higher.
  near(taxableIncome(50_000) / 0.9 / 12, 3_411.77, 2);
});

test("France 2026, €30,000 in Paris: the décote applies", () => {
  const r = france.compute({ gross: 30_000, city: "paris-fr" });
  near(line(r, "Social contributions"), 3_393); // 30,000 × 11.31%
  near(line(r, "CSG"), 2_859.08); // 29,475 × 9.7%
  // net taxable = 30,000 − 3,393 − 29,475 × 6.8% = 24,602.70; less 10% → 22,142.43
  // brut = 10,542.43 × 11% = 1,159.67; décote = 897 − 45.25% × 1,159.67 = 372.25 → 787.42
  near(line(r, "Income tax"), 787.42);
  near(r.net, 22_960.5);
});

test("France 2026, €80,000: second pension band and CET", () => {
  const r = france.compute({ gross: 80_000 });
  // 48,060 × 11.31% + 31,940 × 10.12% + 80,000 × 0.14% = 5,435.59 + 3,232.33 + 112 = 8,779.91
  near(line(r, "Social contributions"), 8_779.91);
  // net taxable = 80,000 − 8,779.91 − 78,600 × 6.8% = 65,875.29; less 10% → 59,287.76
  // tax = 17,979 × 11% + 29,708.76 × 30% = 1,977.69 + 8,912.63 = 10,890.32
  near(incomeTaxOn(59_287.76), 10_890.32);
  near(line(r, "Income tax"), 10_890.32);
});

test("France: a taxable share models the impatriate regime", () => {
  const r = france.compute({ gross: 150_000, tweak: { taxableShare: 0.7 } });
  near(line(r, "Income tax"), incomeTaxOn(taxableIncome(150_000) * 0.7));
});
