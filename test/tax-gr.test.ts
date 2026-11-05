import assert from "node:assert/strict";
import { test } from "node:test";
import { contributions, greece, reduction, taxOn } from "../src/tax/gr.ts";
import { regimeById, regimeTweak } from "../src/tax/regimes.ts";
import { line, near } from "./tax-helpers.ts";

test("Greece 2026, €30,000 in Athens", () => {
  const r = greece.compute({ gross: 30_000, city: "athens-gr" });
  near(line(r, "EFKA"), 4_011); // 13.37%
  // taxable 25,989: 900 + 2,000 + 5,989 × 26% = 4,457.14; reduction 777 − 2% × 13,989 = 497.22 → 3,959.92
  near(reduction(25_989), 497.22, 0.01);
  near(line(r, "Income tax"), 3_959.92);
  near(r.net, 22_029.08);
});

test("Greece 2026, €120,000: contributions stop at the ceiling, no reduction left", () => {
  const r = greece.compute({ gross: 120_000 });
  // ceiling 14 × 7,761.94 = 108,667.16 → 14,528.80
  near(line(r, "EFKA"), 14_528.8);
  // taxable 105,471.20: 900 + 2,000 + 2,600 + 3,400 + 7,800 + 45,471.20 × 44% = 36,707.33
  near(line(r, "Income tax"), 36_707.33);
  near(r.net, 120_000 - 14_528.8 - 36_707.33);
});

test("Greece: the reduction never exceeds the tax", () => {
  near(taxOn(8_000), 0); // 720 of tax against a 777 reduction
  near(contributions(10_000), 1_337, 1e-6);
});

test("Greece: article 5C halves taxable pay for income tax only", () => {
  const plain = greece.compute({ gross: 60_000 });
  const r = greece.compute({ gross: 60_000, tweak: regimeTweak(regimeById("gr-5c")!, 60_000) });
  assert.equal(line(r, "EFKA"), line(plain, "EFKA"));
  near(line(r, "Income tax"), taxOn((60_000 - 8_022) / 2)); // 13.37% of 60,000 = 8,022
});
