import { test } from "node:test";
import { estonia } from "../src/tax/ee.ts";
import { line, near } from "./tax-helpers.ts";

test("Estonia 2026, €30,000 in Tallinn", () => {
  const r = estonia.compute({ gross: 30_000, city: "tallinn-ee" });
  near(line(r, "Unemployment"), 480); // 1.6%
  near(line(r, "Funded pension"), 600); // 2%
  near(line(r, "Income tax"), 4_514.4); // (30,000 − 480 − 600 − 8,400) × 22%
  near(r.net, 24_405.6);
});

test("Estonia 2026, €60,000: the exemption no longer tapers", () => {
  const r = estonia.compute({ gross: 60_000 });
  near(line(r, "Income tax"), 10_876.8); // (60,000 − 960 − 1,200 − 8,400) × 22%
  near(r.net, 46_963.2);
});

test("Estonia: income at or below the exemption pays no income tax", () => {
  near(line(estonia.compute({ gross: 8_000 }), "Income tax"), 0);
});
