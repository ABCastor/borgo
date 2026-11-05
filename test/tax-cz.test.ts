import { test } from "node:test";
import { czechia, twoRates } from "../src/tax/cz.ts";
import { line, near } from "./tax-helpers.ts";

test("Czechia: the two rates match Finanční správa's 2026 worked example (monthly advance, CZK 165,700)", () => {
  // 146,901 × 15% + (165,700 − 146,901) × 23% = 22,035.15 + 4,323.77 = 26,358.92
  near(twoRates(165_700, 3 * 48_967), 26_358.92, 0.01);
});

test("Czechia 2026, CZK 600,000 in Prague", () => {
  const r = czechia.compute({ gross: 600_000, city: "prague-cz" });
  near(line(r, "Social security"), 42_600); // 7.1%
  near(line(r, "Health insurance"), 27_000); // 4.5%
  near(line(r, "Income tax"), 59_160); // 600,000 × 15% − 30,840
  near(r.net, 471_240);
});

test("Czechia 2026, CZK 2,400,000: the 23% band and the social security ceiling", () => {
  const r = czechia.compute({ gross: 2_400_000 });
  near(line(r, "Social security"), 166_879.54); // 2,350,416 × 7.1%
  // 1,762,812 × 15% + 637,188 × 23% − 30,840 = 264,421.80 + 146,553.24 − 30,840
  near(line(r, "Income tax"), 380_135.04);
});
