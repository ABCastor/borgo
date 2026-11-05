import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bands } from "../src/tax/common.ts";
import { newYorkStateTax, nyRecaptureSteps, unitedStates } from "../src/tax/us.ts";

const line = (r: { lines: { label: string; amount: number }[] }, prefix: string) => r.lines.find((l) => l.label.startsWith(prefix))?.amount;
const near = (a: number | undefined, b: number, tol = 0.6) => assert.ok(a !== undefined && Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

// Federal at $100,000: 83,900 taxable → 13,170; FICA 7.65% = 7,650 (shared by the state examples below).

test("New York 2026, $150,000 in New York City", () => {
  // Taxable 150,000 − 8,000 = 142,000. Statutory table: 4,191 + 5.9% × (142,000 − 80,650) = 7,810.65.
  // Recapture (AGI over 107,650, taxable ≤ 215,400): flat 5.9% × 142,000 = 8,378;
  // 7,810.65 + (8,378 − 7,810.65) × (150,000 − 107,650) / 50,000 = 7,810.65 + 567.35 × 0.847 = 8,291.19.
  // NYC: 1,813 + 3.876% × (142,000 − 50,000) = 5,378.92.
  // School credits: fixed 63 + rate reduction 21 + 0.228% × (142,000 − 12,000) = 317.40 → 380.40.
  // SDI 0.5% capped at 0.60 × 52 = 31.20; PFL 0.432% × 150,000 = 648, capped at 411.91.
  const r = unitedStates.compute({ gross: 150_000, region: "US-NY", city: "new-york-us" });
  near(line(r, "New York State income tax"), 8_291.19, 1); // the statute rounds its bracket constants to whole dollars
  near(line(r, "New York City income tax"), 5_378.92, 1);
  near(line(r, "NYC school tax credits"), -380.4);
  near(line(r, "New York SDI"), 31.2);
  near(line(r, "New York Paid Family Leave"), 411.91);
});

test("New York 2026, $60,000 outside New York City: no city tax, no recapture", () => {
  // Taxable 52,000: 586 + 5.4% × (52,000 − 13,900) = 2,643.40. PFL 0.432% × 60,000 = 259.20.
  const r = unitedStates.compute({ gross: 60_000, region: "US-NY", city: "albany-us" });
  near(line(r, "New York State income tax"), 2_643.4, 1);
  assert.equal(line(r, "New York City income tax"), undefined);
  near(line(r, "New York Paid Family Leave"), 259.2);
});

test("New York: full recapture taxes all income at the top bracket's rate", () => {
  // AGI 500,000, taxable 492,000: 12,141 + 6.85% × 276,600 = 31,088.10; + base 567.60 + increment 2,046.30 in full
  // = 33,702.00 = 6.85% × 492,000.
  near(newYorkStateTax(500_000, 492_000), 492_000 * 0.0685, 1);
});

test("New York: the recapture steps reproduce the DTF's 2025 worksheet constants", () => {
  // IT-201-I (2025), single, worksheets 8 to 10: base 568 / increment 1,831; 2,399 / 30,172; 32,571 / 32,500.
  const NY_2025: Bands = [
    [8_500, 0.04], [11_700, 0.045], [13_900, 0.0525], [80_650, 0.055], [215_400, 0.06],
    [1_077_550, 0.0685], [5_000_000, 0.0965], [25_000_000, 0.103], [Infinity, 0.109],
  ];
  const steps = nyRecaptureSteps(NY_2025);
  const expected: [number, number, number][] = [[215_400, 568, 1_831], [1_077_550, 2_399, 30_172], [5_000_000, 32_571, 32_500]];
  assert.equal(steps.length, expected.length);
  steps.forEach((s, i) => {
    assert.equal(s.from, expected[i]![0]);
    near(s.base, expected[i]![1], 1.5);
    near(s.increment, expected[i]![2], 1.5);
  });
});

test("Massachusetts 2026, $120,000", () => {
  // Taxable 120,000 − 4,400 exemption − 2,000 FICA deduction (capped) = 113,600 × 5% = 5,680. PFML 0.46% = 552.
  const r = unitedStates.compute({ gross: 120_000, region: "US-MA", city: "boston-us" });
  near(line(r, "Massachusetts income tax"), 5_680);
  near(line(r, "Massachusetts PFML"), 552);
});

test("Massachusetts 2026, $2,000,000 pays the 4% surtax", () => {
  // Taxable 1,993,600 × 5% = 99,680 + 4% × (1,993,600 − 1,107,750) = 35,434 → 135,114. PFML capped: 0.46% × 184,500 = 848.70.
  const r = unitedStates.compute({ gross: 2_000_000, region: "US-MA" });
  near(line(r, "Massachusetts income tax"), 135_114);
  near(line(r, "Massachusetts PFML"), 848.7);
});

test("Illinois 2026: the exemption disappears above $250,000", () => {
  // 4.95% × (100,000 − 2,925) = 4,805.21; at 300,000 no exemption: 14,850.
  near(line(unitedStates.compute({ gross: 100_000, region: "US-IL" }), "Illinois income tax"), 4_805.21);
  near(line(unitedStates.compute({ gross: 300_000, region: "US-IL" }), "Illinois income tax"), 14_850);
});

test("Colorado 2026, $100,000 in Denver", () => {
  // 4.4% × federal taxable 83,900 = 3,691.60; FAMLI 0.44% = 440; Denver head tax 5.75 × 12 = 69.
  const r = unitedStates.compute({ gross: 100_000, region: "US-CO", city: "denver-us" });
  near(line(r, "Colorado income tax"), 3_691.6);
  near(line(r, "Colorado FAMLI"), 440);
  near(line(r, "Denver occupational privilege tax"), 69);
});

test("Colorado 2026, $400,000 outside Denver: the standard deduction is added back above $300,000 AGI", () => {
  // Federal taxable 383,900 + (16,100 − 1,000) = 399,000 × 4.4% = 17,556. FAMLI 0.44% × 184,500 = 811.80.
  const r = unitedStates.compute({ gross: 400_000, region: "US-CO" });
  near(line(r, "Colorado income tax"), 17_556);
  near(line(r, "Colorado FAMLI"), 811.8);
  assert.equal(line(r, "Denver"), undefined);
});

test("US states: a flat rate replaces federal tax only, a taxable share reaches the state", () => {
  const flat = unitedStates.compute({ gross: 100_000, region: "US-IL", tweak: { flatRate: 0.2 } });
  near(line(flat, "Federal income tax"), 83_900 * 0.2);
  near(line(flat, "Illinois income tax"), 4_805.21);
  const half = unitedStates.compute({ gross: 100_000, region: "US-IL", tweak: { taxableShare: 0.5 } });
  near(line(half, "Illinois income tax"), 97_075 * 0.5 * 0.0495);
});
