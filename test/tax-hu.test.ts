import { test } from "node:test";
import { hungary } from "../src/tax/hu.ts";
import { line, near } from "./tax-helpers.ts";

test("Hungary 2026, HUF 6,000,000 in Budapest", () => {
  const r = hungary.compute({ gross: 6_000_000, city: "budapest-hu" });
  near(line(r, "Social security"), 1_110_000); // 18.5%
  near(line(r, "Personal income tax"), 900_000); // 15%
  near(r.net, 3_990_000);
});

test("Hungary 2026, HUF 12,000,000: both rates are flat", () => {
  const r = hungary.compute({ gross: 12_000_000 });
  near(r.net, 12_000_000 * (1 - 0.185 - 0.15));
  near(r.effectiveRate, 0.335, 1e-9);
});
