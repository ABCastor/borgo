import { test } from "node:test";
import { progressive } from "../src/tax/common.ts";
import { generalCredit, labourCredit, netherlands } from "../src/tax/nl.ts";
import { line, near } from "./tax-helpers.ts";

const BOX1: [number, number][] = [[38_883, 0.3575], [78_426, 0.3756], [Infinity, 0.495]];

test("Netherlands: box 1 matches the Belastingdienst worked example (€80,000 → €29,531 before credits)", () => {
  // The example rounds each band down to the euro: 13,900 + 14,852 + 779
  near(progressive(80_000, BOX1), 29_531, 1.5);
});

test("Netherlands 2026, €50,000 in Amsterdam", () => {
  const r = netherlands.compute({ gross: 50_000, city: "amsterdam-nl" });
  // box 1: 38,883 × 35.75% + 11,117 × 37.56% = 13,900.67 + 4,175.55 = 18,076.22
  // general credit: 3,115 − 6.398% × 20,264 = 1,818.51; labour credit: 5,685 − 6.51% × 4,408 = 5,398.04
  near(generalCredit(50_000), 1_818.51);
  near(labourCredit(50_000), 5_398.04);
  near(line(r, "Income tax"), 18_076.22 - 1_818.51 - 5_398.04);
  near(r.net, 50_000 - 10_859.67);
});

test("Netherlands 2026, €25,000: the labour credit is still rising", () => {
  const r = netherlands.compute({ gross: 25_000 });
  // box 1: 25,000 × 35.75% = 8,937.50; credits 3,115 + (996 + 31.009% × 13,035 = 5,038.02)
  near(line(r, "Income tax"), 8_937.5 - 3_115 - 5_038.02);
});

test("Netherlands: a 0.7 taxable share models the 30% ruling", () => {
  const r = netherlands.compute({ gross: 100_000, tweak: { taxableShare: 0.7 } });
  near(line(r, "Income tax"), progressive(70_000, BOX1) - generalCredit(70_000) - labourCredit(70_000));
});
