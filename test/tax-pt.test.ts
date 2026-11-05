import { test } from "node:test";
import { progressive } from "../src/tax/common.ts";
import { portugal } from "../src/tax/pt.ts";
import { line, near } from "./tax-helpers.ts";

// CIRS art. 68 as amended by Decreto-Lei 212/2026 of 4 November, column A (normal rates), read from the Tax
// Authority's consolidated code on 5 Nov 2026:
// https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs68.aspx
const IRS: [number, number][] = [[8_342, 0.122], [12_587, 0.152], [17_838, 0.207], [23_089, 0.236], [29_397, 0.306], [43_090, 0.346], [46_566, 0.431], [86_634, 0.446], [Infinity, 0.48]];

test("Portugal: the brackets reproduce the official average rates (CIRS art. 68, column B, DL 212/2026)", () => {
  // Column B of the same table: 12.200, 13.212, 15.416, 17.277, 20.136, 24.732, 26.103, 34.658 (%).
  const columnB: [number, number][] = [[8_342, 0.122], [12_587, 0.13212], [17_838, 0.15416], [23_089, 0.17277], [29_397, 0.20136], [43_090, 0.24732], [46_566, 0.26103], [86_634, 0.34658]];
  for (const [upper, avg] of columnB) near(progressive(upper, IRS) / upper, avg, 0.000006);
});

test("Portugal: the model taxes on the DL 212/2026 rates (an old first-six-band table fails this)", () => {
  // €40,000 of taxable income: column B at 29,397 (20.136% → 5,919.38) + 10,603 × 34.6% (3,668.64) = 9,588.02.
  // Gross 44,943.82: social security (11%, 4,943.82) beats the 4,587.09 specific deduction, so taxable = 89% of gross,
  // and pay is far above the subsistence ceiling.
  const r = portugal.compute({ gross: 40_000 / 0.89 });
  near(line(r, "IRS"), 9_588.02 - 250, 0.05);
});

test("Portugal 2026, €30,000 in Lisbon", () => {
  const r = portugal.compute({ gross: 30_000, city: "lisbon-pt" });
  near(line(r, "Social security"), 3_300); // 11%
  // taxable = 30,000 − 8.54 × 537.13 (4,587.09) = 25,412.91
  // IRS = 1,017.72 + 645.24 + 1,086.96 + 1,239.24 + 2,323.91 × 30.6% (711.12) = 4,700.27, less the €250 credit
  near(line(r, "IRS"), 4_450.27);
  near(r.net, 22_249.73);
});

test("Portugal 2026, €100,000: contributions replace the specific deduction, solidarity rate above €80,000", () => {
  const r = portugal.compute({ gross: 100_000 });
  // taxable = 100,000 − 11,000 = 89,000; 30,025.70 at 86,634 (column B 34.658%) + 2,366 × 48% = 31,161.35;
  // + 9,000 × 2.5% = 31,386.35; − 250
  near(line(r, "IRS"), 31_136.35);
});

test("Portugal 2026, €14,000: the minimum-subsistence allowance", () => {
  const r = portugal.compute({ gross: 14_000 });
  // Art. 70 (2)(b) with the first rate now 12.2%: allowance = 12,880 − 2.6 × 1,120 − (4,587.09 + 250 / 12.2%) = 3,331.73;
  // taxable = 14,000 − 4,587.09 − 3,331.73 = 6,081.18; IRS = 6,081.18 × 12.2% − 250 = 491.90
  near(line(r, "IRS"), 491.9);
});

test("Portugal: a 20% flat rate models IFICI", () => {
  const r = portugal.compute({ gross: 100_000, tweak: { flatRate: 0.2 } });
  near(line(r, "IRS"), 89_000 * 0.2);
});
