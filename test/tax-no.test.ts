import { test } from "node:test";
import { norway, trygdeavgift } from "../src/tax/no.ts";
import { line, near } from "./tax-helpers.ts";

test("Norway 2026, NOK 600,000 in Oslo", () => {
  const r = norway.compute({ gross: 600_000, city: "oslo-no" });
  near(line(r, "National insurance"), 45_600); // 7.6%
  // ordinary income = 600,000 − 95,700 − 114,540 = 389,760 × 22% = 85,747.20
  near(line(r, "Tax on ordinary"), 85_747.2);
  // bracket: 92,200 × 1.7% + 281,700 × 4% = 1,567.40 + 11,268
  near(line(r, "Bracket tax"), 12_835.4);
  near(r.net, 455_817.4);
});

test("Norway 2026, NOK 1,200,000: steps 3 and 4", () => {
  const r = norway.compute({ gross: 1_200_000 });
  near(line(r, "Tax on ordinary"), 217_747.2); // (1,200,000 − 95,700 − 114,540) × 22%
  // 1,567.40 + 406,750 × 4% + 255,050 × 13.7% + 219,900 × 16.8%
  near(line(r, "Bracket tax"), 89_722.45);
});

test("Norway: the national insurance contribution phases in above NOK 99,650", () => {
  near(trygdeavgift(99_000), 0);
  near(trygdeavgift(110_000), 2_587.5); // 25% × 10,350 < 7.6% × 110,000
  near(trygdeavgift(200_000), 15_200);
});

test("Norway: a flat rate (PAYE-style) replaces all income taxes", () => {
  const r = norway.compute({ gross: 600_000, tweak: { flatRate: 0.25 } });
  near(line(r, "Income tax"), 150_000);
});
