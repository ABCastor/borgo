import { test } from "node:test";
import { finland, stateTax, workCredit } from "../src/tax/fi.ts";
import { line, near } from "./tax-helpers.ts";

test("Finland: the 2026 state scale rows are consistent (tax at each threshold)", () => {
  near(stateTax(22_000), 2_780.8); // 22,000 × 12.64%
  near(stateTax(32_600), 4_794.8); // + 10,600 × 19%
  near(stateTax(52_100), 11_053.55); // 7,063.55 + 12,000 × 33.25%
});

test("Finland 2026, €50,000 in Helsinki", () => {
  const r = finland.compute({ gross: 50_000, city: "helsinki-fi" });
  near(line(r, "Employee pension"), 3_650); // 7.30%
  near(line(r, "Unemployment"), 445); // 0.89%
  near(line(r, "Health insurance daily"), 440); // 0.88%
  // taxable = 50,000 − 750 − 4,535 = 44,715 (basic deduction fully tapered)
  near(line(r, "State income tax"), 8_598.04); // 7,063.55 + 4,615 × 33.25%
  near(line(r, "Municipal tax"), 2_369.9); // 5.30%
  near(line(r, "Health insurance medical"), 491.87); // 1.10%
  near(workCredit(50_000, 49_250), 3_145); // 3,430 − 2% × 14,250
  near(line(r, "Yle"), 160);
  near(r.net, 36_990.19);
});

test("Finland 2026, €25,000: the basic deduction and the credit spill over to municipal tax", () => {
  const r = finland.compute({ gross: 25_000, city: "helsinki-fi" });
  // after contributions 21,982.50; basic deduction 4,265 − 18% × 17,717.50 = 1,075.85; taxable 20,906.65
  near(line(r, "State income tax"), 2_642.6);
  near(line(r, "Earned income credit"), -3_430);
  // total paid = 1,825 + 222.50 + 220 + (2,642.60 + 1,108.05 + 229.97 − 3,430) + 160
  near(r.net, 25_000 - 2_978.12);
});
