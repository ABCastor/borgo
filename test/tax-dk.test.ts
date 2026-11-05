import { test } from "node:test";
import { denmark, workAllowances } from "../src/tax/dk.ts";
import { line, near } from "./tax-helpers.ts";

test("Denmark: allowances reach skat.dk's 2026 maxima at the published salaries", () => {
  // skat.dk: full employment allowance from DKK 496,471, full job allowance from DKK 304,089
  near(workAllowances(304_089), 304_089 * 0.1275 + 3_100, 0.5);
  near(workAllowances(496_471), 63_300 + 3_100, 0.5);
});

test("Denmark 2026, DKK 600,000 in Copenhagen", () => {
  const r = denmark.compute({ gross: 600_000, city: "copenhagen-dk" });
  near(line(r, "Labour market"), 48_000); // 8%
  // personal income 552,000; taxable = 552,000 − 63,300 − 3,100 = 485,600
  near(line(r, "Municipal"), 100_927.85); // (485,600 − 54,100) × 23.39%
  near(line(r, "Bottom"), 59_797.79); // (552,000 − 54,100) × 12.01%
  near(line(r, "Middle"), 0);
  near(r.net, 391_274.36);
});

test("Denmark 2026, DKK 1,000,000: middle and top brackets", () => {
  const r = denmark.compute({ gross: 1_000_000, city: "copenhagen-dk" });
  // personal income 920,000: (920,000 − 641,200) × 7.5% + (920,000 − 777,900) × 7.5%
  near(line(r, "Middle"), 20_910 + 10_657.5);
  near(line(r, "Municipal"), 187_003.05); // (920,000 − 66,400 − 54,100) × 23.39%
});
