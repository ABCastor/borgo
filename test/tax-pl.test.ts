import { test } from "node:test";
import { poland, scale } from "../src/tax/pl.ts";
import { line, near } from "./tax-helpers.ts";

test("Poland: the scale follows podatki.gov.pl (12% − 3,600; 10,800 + 32% above 120,000)", () => {
  near(scale(30_000), 0);
  near(scale(120_000), 10_800);
  near(scale(150_000), 10_800 + 0.32 * 30_000);
});

test("Poland 2026, PLN 120,000 in Warsaw", () => {
  const r = poland.compute({ gross: 120_000, city: "warsaw-pl" });
  near(line(r, "Social insurance"), 16_452); // 13.71%
  near(line(r, "Health insurance"), 9_319.32); // 9% × 103,548
  // base = 120,000 − 16,452 − 3,000 = 100,548 → 12% − 3,600 = 8,465.76
  near(line(r, "Income tax"), 8_465.76);
  near(r.net, 85_762.92);
});

test("Poland 2026, PLN 300,000: pension ceiling and the 32% band", () => {
  const r = poland.compute({ gross: 300_000 });
  near(line(r, "Social insurance"), 39_170.76); // 282,600 × 11.26% + 300,000 × 2.45%
  near(line(r, "Health insurance"), 23_474.63); // 9% × 260,829.24
  // base = 257,829.24 → 10,800 + 32% × 137,829.24
  near(line(r, "Income tax"), 54_905.36);
});
