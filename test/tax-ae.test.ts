import assert from "node:assert/strict";
import { test } from "node:test";
import { unitedArabEmirates } from "../src/tax/ae.ts";

const line = (r: { lines: { label: string; amount: number }[] }, prefix: string) => r.lines.find((l) => l.label.startsWith(prefix))!.amount;

test("UAE 2026, AED 120,000: no income tax, AED 5 a month unemployment insurance", () => {
  // 120,000 / 12 = 10,000 a month, under 16,000 → 5 × 12 = 60
  const r = unitedArabEmirates.compute({ gross: 120_000 });
  assert.equal(line(r, "Income tax"), 0);
  assert.equal(line(r, "Unemployment insurance"), 60);
  assert.equal(r.net, 119_940);
});

test("UAE 2026, AED 300,000: the AED 10 a month band", () => {
  // 300,000 / 12 = 25,000 a month, over 16,000 → 10 × 12 = 120
  const r = unitedArabEmirates.compute({ gross: 300_000 });
  assert.equal(line(r, "Unemployment insurance"), 120);
  assert.equal(r.net, 299_880);
});

test("UAE: a flat rate still applies, for people taxed by their home country", () => {
  const r = unitedArabEmirates.compute({ gross: 300_000, tweak: { flatRate: 0.1 } });
  assert.equal(line(r, "Income tax"), 30_000);
});
