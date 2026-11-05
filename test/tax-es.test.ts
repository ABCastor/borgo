import assert from "node:assert/strict";
import { test } from "node:test";
import { half, spain, taxableBase } from "../src/tax/es.ts";
import { line, near } from "./tax-helpers.ts";

test("Spain: the state half matches the AEAT manual's worked example (Renta 2025, unchanged scale)", () => {
  // Base liquidable general 23,900, minimum 5,550: 2,667.75 − 527.25 = 2,140.50
  near(half(23_900, [[12_450, 0.095], [20_200, 0.12], [35_200, 0.15], [60_000, 0.185], [300_000, 0.225], [Infinity, 0.245]], 5_550), 2_140.5, 0.01);
});

test("Spain 2026, €30,000 in Madrid", () => {
  const r = spain.compute({ gross: 30_000, region: "ES-MD" });
  near(line(r, "Social security"), 1_950); // 30,000 × 6.50%
  // base = 30,000 − 1,950 − 2,000 = 26,050 (no art. 20 reduction above 19,747.50)
  near(taxableBase(30_000, 1_950), 26_050, 0.01);
  // state: 2,112.75 + 5,850 × 15% = 2,990.25, less 5,550 × 9.5% = 527.25 → 2,463.00
  near(line(r, "IRPF state"), 2_463);
  // Madrid: 1,739.53 + 7,045.37 × 12.8% = 2,641.34, less 5,956.65 × 8.5% = 506.32 → 2,135.02
  near(line(r, "IRPF regional"), 2_135.02);
  near(r.net, 30_000 - 1_950 - 2_463 - 2_135.02);
});

test("Spain 2026, €18,000 in Málaga (Andalusia): low-income reduction and minimum-wage credit", () => {
  const r = spain.compute({ gross: 18_000, region: "ES-AN" });
  // SS 1,170; net 16,830; art. 20: 7,302 − 1.75 × 1,978 = 3,840.50; base = 16,830 − 2,000 − 3,840.50 = 10,989.50
  near(line(r, "Social security"), 1_170);
  // state: 10,989.50 × 9.5% − 5,550 × 9.5% = 516.75
  near(line(r, "IRPF state"), 516.75);
  // Andalusia: (10,989.50 − 5,790) × 9.5% = 493.95
  near(line(r, "IRPF regional"), 493.95);
  // credit: 590.89 − 0.2 × (18,000 − 17,094) = 409.69
  near(line(r, "Minimum-wage"), -409.69);
});

test("Spain: pay above the maximum base pays the solidarity contribution, employee share 4.70/28.30", () => {
  const r = spain.compute({ gross: 100_000, region: "ES-VC" });
  const max = 61_214.4;
  // 6.5% of the base + (6,121.44 × 1.15% + 24,485.76 × 1.25% + 8,178.80 × 1.46%) × 4.7/28.3
  const sol = (6_121.44 * 0.0115 + 24_485.76 * 0.0125 + (100_000 - max * 1.5) * 0.0146) * (4.7 / 28.3);
  near(line(r, "Social security"), max * 0.065 + sol);
});

test("Spain: Catalonia taxes €60,000 more than Madrid", () => {
  const mad = spain.compute({ gross: 60_000, region: "ES-MD" });
  const cat = spain.compute({ gross: 60_000, region: "ES-CT" });
  assert.ok(cat.net < mad.net);
});

test("Spain: the special regime taxes the whole of gross pay (art. 93 LIRPF), not the ordinary reduced base", () => {
  // Art. 93.2 LIRPF applies the non-resident rules: the base is all employment income, 24% up to €600,000
  // (https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#a93). €100,000 → €24,000 of income tax; social security
  // is still due on top and is not deducted first.
  const r = spain.compute({ gross: 100_000, region: "ES-MD", tweak: { flatRate: 0.24 } });
  near(line(r, "Income tax"), 24_000);
  assert.ok(line(r, "Social security") > 4_000);
  assert.ok(!r.lines.some((l) => l.label.startsWith("IRPF regional")));
  // A pension plan contribution does not reduce it.
  near(line(spain.compute({ gross: 100_000, tweak: { flatRate: 0.24, pretaxDeduction: 1_500 } }), "Income tax"), 24_000);
});
