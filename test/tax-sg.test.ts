import assert from "node:assert/strict";
import { test } from "node:test";
import { cpfEmployee, singapore } from "../src/tax/sg.ts";

const line = (r: { lines: { label: string; amount: number }[] }, prefix: string) => r.lines.find((l) => l.label.startsWith(prefix))!.amount;
const near = (a: number, b: number, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("Singapore, income 2026, $120,000: CPF stops at the $8,000 monthly ceiling", () => {
  // CPF 20% × 8,000 × 12 = 19,200; chargeable 120,000 − 1,000 − 19,200 = 99,800
  // tax on first 80,000 = 3,350; 19,800 × 11.5% = 2,277 → 5,627
  const r = singapore.compute({ gross: 120_000 });
  near(line(r, "CPF"), 19_200);
  near(line(r, "Income tax"), 5_627);
  near(r.net, 95_173);
});

test("Singapore, income 2026, $60,000", () => {
  // CPF 20% × 60,000 = 12,000; chargeable 60,000 − 1,000 − 12,000 = 47,000
  // tax on first 40,000 = 550; 7,000 × 7% = 490 → 1,040
  const r = singapore.compute({ gross: 60_000 });
  near(line(r, "CPF"), 12_000);
  near(line(r, "Income tax"), 1_040);
});

test("Singapore: matches the IRAS sample calculation (Mr Heng, chargeable income $34,750)", () => {
  // IRAS: tax on first 30,000 = 200; 4,750 × 3.5% = 166.25 → 366.25.
  // A salary of 44,687.50 gives the same chargeable income: 44,687.50 − 1,000 − 20% × 44,687.50 = 34,750.
  const r = singapore.compute({ gross: 44_687.5 });
  near(line(r, "Income tax"), 366.25, 0.01);
});

test("Singapore: employee CPF phases in between $500 and $750 a month", () => {
  assert.equal(cpfEmployee(500 * 12), 0);
  near(cpfEmployee(600 * 12), 720); // 0.6 × (600 − 500) × 12
});

test("Singapore warns that foreigners pay no CPF", () => {
  const r = singapore.compute({ gross: 100_000 });
  assert.ok(r.caveats.some((c) => c.includes("foreigners") && c.includes("no CPF")));
});

test("Singapore: a flat rate replaces the resident schedule", () => {
  const r = singapore.compute({ gross: 100_000, tweak: { flatRate: 0.15 } });
  near(line(r, "Income tax"), 15_000);
});

test("Employment Pass holders pay no CPF and get no CPF relief", () => {
  const ep = singapore.compute({ gross: 120_000, tweak: { noSocialContributions: true } });
  assert.equal(line(ep, "CPF"), 0);
  const pr = singapore.compute({ gross: 120_000 });
  assert.ok(ep.net > pr.net);
});
