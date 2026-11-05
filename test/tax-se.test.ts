import assert from "node:assert/strict";
import { test } from "node:test";
import { grundavdrag, sweden } from "../src/tax/se.ts";
import { line, near } from "./tax-helpers.ts";

test("Sweden: the basic deduction matches Skatteverket's 2026 figures (25,100 / 45,600 / 17,400)", () => {
  assert.equal(grundavdrag(30_000), 25_100);
  assert.equal(grundavdrag(3 * 59_200), 45_600);
  assert.equal(grundavdrag(1_000_000), 17_400);
});

test("Sweden: state tax starts at Skatteverket's 2026 brytpunkt of SEK 660,400", () => {
  near(line(sweden.compute({ gross: 660_400, city: "stockholm-se" }), "State income tax"), 0);
  near(line(sweden.compute({ gross: 670_400, city: "stockholm-se" }), "State income tax"), 2_000);
});

test("Sweden 2026, SEK 600,000 in Stockholm", () => {
  const r = sweden.compute({ gross: 600_000, city: "stockholm-se" });
  // taxable = 600,000 − 17,400 = 582,600; municipal 30.55% = 177,984.30
  near(line(r, "Municipal"), 177_984.3);
  // credit: (3.027 × 59,200 − 17,400) × 30.55% = 161,798.40 × 30.55% = 49,429.41
  near(line(r, "Earned income"), -49_429.41);
  near(line(r, "General pension fee"), 42_000);
  near(line(r, "Pension fee credit"), -42_000);
  near(line(r, "Burial"), 407.82); // 0.07%
  near(line(r, "Public service"), 1_184);
  near(line(r, "Tax reduction for earned income"), -1_500); // above 240,000 taxable
  near(r.net, 471_353.29);
});

test("Sweden 2026, SEK 900,000: state tax and the pension fee cap", () => {
  const r = sweden.compute({ gross: 900_000, city: "stockholm-se" });
  near(line(r, "State income tax"), 47_920); // 20% × (882,600 − 643,000)
  near(line(r, "General pension fee"), 47_100);
});
