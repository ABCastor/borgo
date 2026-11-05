import assert from "node:assert/strict";
import type { TaxResult } from "../src/tax/index.ts";

export const line = (r: TaxResult, prefix: string) => {
  const l = r.lines.find((x) => x.label.startsWith(prefix));
  assert.ok(l, `no line starting with "${prefix}" in ${r.lines.map((x) => x.label).join(", ")}`);
  return l.amount;
};
export const near = (a: number, b: number, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
