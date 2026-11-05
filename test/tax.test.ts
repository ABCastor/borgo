import assert from "node:assert/strict";
import { test } from "node:test";
import { TAX_MODELS } from "../src/tax/index.ts";

const line = (r: { lines: { label: string; amount: number }[] }, prefix: string) => r.lines.find((l) => l.label.startsWith(prefix))!.amount;
const near = (a: number, b: number, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("UK 2026-27, £60,000 in England", () => {
  const r = TAX_MODELS.GB!.compute({ gross: 60_000 });
  near(line(r, "Income tax"), 11_432); // 37,700 × 20% + 9,730 × 40%
  near(line(r, "National Insurance"), 3_210.6); // 37,700 × 8% + 9,730 × 2%
  near(r.net, 45_357.4);
});

test("UK allowance tapers away above £100,000", () => {
  const r = TAX_MODELS.GB!.compute({ gross: 110_000 });
  near(line(r, "Income tax"), 33_432); // allowance 7,570; 7,540 + 64,730 × 40%
  const top = TAX_MODELS.GB!.compute({ gross: 200_000 });
  near(line(top, "Income tax"), 7_540 + (125_140 - 37_700) * 0.4 + (200_000 - 125_140) * 0.45);
});

test("UK uses Scottish bands for Scottish cities", () => {
  const eng = TAX_MODELS.GB!.compute({ gross: 60_000 });
  const sco = TAX_MODELS.GB!.compute({ gross: 60_000, region: "GB-SCT" });
  // 3,967×19% + 12,989×20% + 14,136×21% + 16,338×42%
  near(line(sco, "Income tax"), 753.73 + 2_597.8 + 2_968.56 + 6_861.96, 1);
  assert.ok(sco.net < eng.net);
});

test("Ireland 2026, €60,000 single PAYE", () => {
  const r = TAX_MODELS.IE!.compute({ gross: 60_000 });
  near(line(r, "Income tax"), 11_200); // 8,800 + 6,400 − 4,000 credits
  near(line(r, "Universal Social Charge"), 1_332.82);
  near(line(r, "PRSI"), 60_000 * (0.042 * 0.75 + 0.0435 * 0.25));
});

test("Ireland: no USC at or below €13,000", () => {
  const r = TAX_MODELS.IE!.compute({ gross: 13_000 });
  assert.equal(line(r, "Universal Social Charge"), 0);
});

test("US 2026, $150,000 in California", () => {
  const r = TAX_MODELS.US!.compute({ gross: 150_000, region: "US-CA" });
  near(line(r, "Federal income tax"), 24_734); // on 133,900 after the $16,100 deduction
  near(line(r, "Social Security"), 11_475);
  near(line(r, "California income tax"), 9_704.98);
  near(line(r, "California SDI"), 1_950);
});

test("US without a state module says so", () => {
  const r = TAX_MODELS.US!.compute({ gross: 100_000, region: "US-PA" });
  assert.ok(r.caveats.some((c) => c.includes("state income tax is not included")));
  const tx = TAX_MODELS.US!.compute({ gross: 100_000, region: "US-TX" });
  assert.equal(tx.lines.length, 2);
});

test("Italy 2026, €40,000 employee in Torino", () => {
  const r = TAX_MODELS.IT!.compute({ gross: 40_000, region: "IT-21", city: "turin-it" });
  near(line(r, "INPS"), 3_676);
  near(line(r, "IRPEF"), 7_540.09, 1); // 9,186.92 − 1,187.33 employment credit − 459.50 cuneo credit
  near(line(r, "Regional"), 866.92);
  near(line(r, "Municipal"), 315.56);
});

test("Italy: the cuneo tax-free sum is paid below €20,000", () => {
  const r = TAX_MODELS.IT!.compute({ gross: 18_000 });
  assert.ok(r.lines.some((l) => l.label.startsWith("Cuneo") && l.amount < 0));
});

test("Italy: income above €50,000 is taxed at the top IRPEF rate of 43%", () => {
  const irpef = (gross: number) => line(TAX_MODELS.IT!.compute({ gross, region: "IT-21", city: "turin-it" }), "IRPEF");
  near(irpef(301_000) - irpef(300_000), 430, 0.5); // above the INPS ceiling every extra euro is taxed at 43%
});

test("A taxable share halves the taxed base (impatriate-style regimes)", () => {
  const full = TAX_MODELS.IT!.compute({ gross: 100_000 });
  const half = TAX_MODELS.IT!.compute({ gross: 100_000, tweak: { taxableShare: 0.5 } });
  assert.ok(half.net > full.net);
  assert.ok(half.caveats.some((c) => c.includes("50%")));
});

test("A flat rate replaces the schedule", () => {
  const r = TAX_MODELS.IE!.compute({ gross: 100_000, tweak: { flatRate: 0.24 } });
  near(line(r, "Income tax"), 24_000);
});

test("Net never exceeds gross plus received credits, and rises with gross", () => {
  const region: Record<string, string> = { US: "US-CA", CA: "CA-ON" };
  for (const m of Object.values(TAX_MODELS)) {
    let prev = -Infinity;
    for (let g = 10_000; g <= 400_000; g += 10_000) {
      const r = m.compute({ gross: g, region: region[m.country] });
      assert.ok(r.net > prev, `${m.country}: net fell at ${g}`);
      assert.ok(r.net <= g * 1.08, `${m.country}: net above gross at ${g}`);
      prev = r.net;
    }
  }
});
