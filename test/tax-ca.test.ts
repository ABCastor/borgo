import assert from "node:assert/strict";
import { test } from "node:test";
import { canada } from "../src/tax/ca.ts";

const line = (r: { lines: { label: string; amount: number }[] }, prefix: string) => r.lines.find((l) => l.label.startsWith(prefix))!.amount;
const near = (a: number, b: number, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

// At $100,000 the contributions are the same in every province but Quebec:
// CPP: (74,600 − 3,500) × 5.95% = 4,230.45, of which base 71,100 × 4.95% = 3,519.45 and first additional 711;
//      CPP2 (85,000 − 74,600) × 4% = 416; total 4,646.45. EI 68,900 × 1.63% = 1,123.07.
// Taxable income 100,000 − 711 − 416 = 98,873.
// Federal: 58,523 × 14% + 40,350 × 20.5% = 8,193.22 + 8,271.75 = 16,464.97;
//          credits 14% × (16,452 + 3,519.45 + 1,123.07 + 1,501) = 3,163.37; tax 13,301.60.

test("Canada 2026, $100,000 in Ontario", () => {
  const r = canada.compute({ gross: 100_000, region: "CA-ON" });
  near(line(r, "CPP"), 4_646.45);
  near(line(r, "EI"), 1_123.07);
  near(line(r, "Federal income tax"), 13_301.6);
  // 53,891 × 5.05% + 44,982 × 9.15% = 2,721.50 + 4,115.85 = 6,837.35
  // − 5.05% × (12,989 + 3,519.45 + 1,123.07) = 890.39 → 5,946.96; surtax 20% × (5,946.96 − 5,818) = 25.79
  near(line(r, "Ontario income tax"), 5_972.75);
  near(line(r, "Ontario Health Premium"), 750); // 600 + 25% × (98,873 − 72,000), capped at 750
  near(r.net, 74_206.13);
});

test("Canada 2026, $25,000 in Ontario gets the Ontario tax reduction", () => {
  // CPP base (25,000 − 3,500) × 4.95% = 1,064.25, first additional 215; EI 407.50; taxable 24,785.
  // Ontario: 24,785 × 5.05% = 1,251.64 − 5.05% × (12,989 + 1,064.25 + 407.50) = 730.27 → 521.37;
  // reduction = 2 × 300 − 521.37 = 78.63 → 442.75
  const r = canada.compute({ gross: 25_000, region: "CA-ON" });
  near(line(r, "Ontario income tax"), 442.75);
  near(line(r, "Ontario Health Premium"), 287.1); // 6% × (24,785 − 20,000)
});

test("Canada 2026, $100,000 in British Columbia", () => {
  // 50,363 × 5.6% + 48,510 × 7.7% = 2,820.33 + 3,735.27 = 6,555.60
  // − 5.6% × (13,216 + 3,519.45 + 1,123.07) = 1,000.08 → 5,555.52; no tax reduction above $44,952
  const r = canada.compute({ gross: 100_000, region: "CA-BC" });
  near(line(r, "British Columbia income tax"), 5_555.52);
  near(r.net, 75_373.36);
});

test("Canada 2026, $30,000 in British Columbia gets the BC tax reduction", () => {
  // CPP base 26,500 × 4.95% = 1,311.75, first additional 265; EI 489; taxable 29,735.
  // 29,735 × 5.6% = 1,665.16 − 5.6% × (13,216 + 1,311.75 + 489) = 840.94 → 824.22
  // reduction 690 − 3.56% × (29,735 − 25,570) = 541.73 → 282.50
  const r = canada.compute({ gross: 30_000, region: "CA-BC" });
  near(line(r, "British Columbia income tax"), 282.5);
});

test("Canada 2026, $100,000 in Quebec: QPP, QPIP, Quebec EI rate and the abatement", () => {
  // QPP 71,100 × 6.30% = 4,479.30 (base 3,768.30, first additional 711) + QPP2 416 = 4,895.30.
  // EI 68,900 × 1.30% = 895.70; QPIP 100,000 × 0.43% = 430.
  // Federal: 16,464.97 − 14% × (16,452 + 3,768.30 + 895.70 + 430 + 1,501) = 3,226.58 → 13,238.39; × (1 − 16.5%) = 11,054.05
  // Quebec taxable 100,000 − 1,450 (deduction for workers, 6% capped) − 711 − 416 = 97,423:
  // 54,345 × 14% + 43,078 × 19% = 7,608.30 + 8,184.82 = 15,793.12 − 14% × 18,952 = 2,653.28 → 13,139.84
  const r = canada.compute({ gross: 100_000, region: "CA-QC" });
  near(line(r, "QPP"), 4_895.3);
  near(line(r, "EI"), 895.7);
  near(line(r, "QPIP"), 430);
  near(line(r, "Federal income tax, after the Quebec abatement"), 11_054.05);
  near(line(r, "Quebec income tax"), 13_139.84);
});

test("Canada 2026, the basic personal amount falls to its minimum at high income", () => {
  // $300,000 in Ontario: taxable 300,000 − 711 − 416 = 298,873.
  // 8,193.22 + 58,522 × 20.5% + 64,395 × 26% + 77,042 × 29% + 40,391 × 33% = 72,604.14
  // credits 14% × (14,829 + 3,519.45 + 1,123.07 + 1,501) = 2,936.15 → 69,667.99
  const r = canada.compute({ gross: 300_000, region: "CA-ON" });
  near(line(r, "Federal income tax"), 69_667.99);
});

test("Canada 2026, contributions stop at CRA's and Revenu Québec's published maximums", () => {
  // CRA: maximum employee CPP 4,230.45 + CPP2 416, EI 1,123.07 (Quebec 895.70); Revenu Québec: QPP 4,479.30 + 416, QPIP 442.90.
  const on = canada.compute({ gross: 250_000, region: "CA-ON" });
  near(line(on, "CPP"), 4_230.45 + 416, 0.01);
  near(line(on, "EI"), 1_123.07, 0.01);
  const qc = canada.compute({ gross: 250_000, region: "CA-QC" });
  near(line(qc, "QPP"), 4_479.3 + 416, 0.01);
  near(line(qc, "EI"), 895.7, 0.01);
  near(line(qc, "QPIP"), 442.9, 0.01);
});

test("Canada without a provincial module says so", () => {
  const r = canada.compute({ gross: 80_000, region: "CA-AB" });
  assert.ok(r.caveats.some((c) => c.includes("provincial income tax is not included")));
});

test("Canada: a flat rate replaces federal tax only; a taxable share also cuts provincial tax", () => {
  const flat = canada.compute({ gross: 100_000, region: "CA-ON", tweak: { flatRate: 0.2 } });
  near(line(flat, "Federal income tax"), 98_873 * 0.2);
  near(line(flat, "Ontario income tax"), 5_972.75);
  const half = canada.compute({ gross: 100_000, region: "CA-ON", tweak: { taxableShare: 0.5 } });
  assert.ok(line(half, "Ontario income tax") < 5_972.75);
});
