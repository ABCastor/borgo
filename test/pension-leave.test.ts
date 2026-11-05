import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { taxableIncome as frenchProfessionalIncome } from "../src/tax/fr.ts";
import { socialSecurity as spanishSocialSecurity } from "../src/tax/es.ts";
import { earnerTax, householdTax } from "../src/tax/household.ts";
import { TAX_MODELS } from "../src/tax/index.ts";
import { pensionRelief } from "../src/tax/pension.ts";
import { STATUTORY_LEAVE } from "../src/fetch/family.ts";
import { ageExtraLeave } from "../src/core/money.ts";

// Sources and policy reference periods: docs/pension-leave-audit.md.
test("2026 pension deduction boundaries: Italy, Norway, France, Czechia and Spain", () => {
  assert.equal(pensionRelief("IT", 5_299, 80_000, 40).deducted, 5_299);
  assert.equal(pensionRelief("IT", 5_301, 80_000, 40).deducted, 5_300);
  assert.equal(pensionRelief("NO", 30_000, 900_000, 40).credit, 5_500);
  assert.equal(pensionRelief("NO", 20_000, 900_000, 40).credit, 4_400);
  assert.equal(pensionRelief("FR", 20_000, 100_000, 69).deducted, 0.1 * frenchProfessionalIncome(100_000));
  assert.equal(pensionRelief("FR", 20_000, 100_000, 70).deducted, 0);
  assert.equal(pensionRelief("FR", 20_000, 100_000, 17).deducted, 0);
  assert.ok(pensionRelief("FR", 20_000, 100_000, 18).deducted > 0);
  assert.equal(pensionRelief("FR", 20_000, 20_000, 40).deducted, 4_710);
  assert.equal(pensionRelief("FR", 100_000, 1_000_000, 40).deducted, 37_680);
  assert.equal(pensionRelief("CZ", 20_400, 1_200_000, 40).deducted, 0);
  assert.equal(pensionRelief("CZ", 20_401, 1_200_000, 40).deducted, 1);
  assert.equal(pensionRelief("CZ", 68_400, 1_200_000, 40).deducted, 48_000);
  assert.equal(pensionRelief("CZ", 90_000, 1_200_000, 40).deducted, 48_000);
  assert.equal(pensionRelief("ES", 1_500, 5_000, 40).deducted, 0.3 * (5_000 - spanishSocialSecurity(5_000) - 2_000));
  assert.equal(pensionRelief("ES", 1_500, 1_000, 40).deducted, 0);
});

test("Italy's post-1995 INPS base stops at the official 2026 ceiling", () => {
  const contribution = (gross: number) => TAX_MODELS.IT!.compute({ gross }).lines.find((l) => l.label.startsWith("INPS"))!.amount;
  assert.equal(contribution(122_295), contribution(200_000));
  assert.equal(contribution(122_295), Math.round((122_295 * 0.0919 + (122_295 - 56_224) * 0.01) * 100) / 100);
  assert.ok(contribution(122_294) < contribution(122_295));
});

test("pension credits cannot refund social insurance or Norway's bracket tax", () => {
  for (const [country, gross] of [["PT", 10_000], ["NO", 100_000]] as const) {
    const model = TAX_MODELS[country]!;
    const plain = earnerTax(model, {}, { label: "You", gross });
    const saving = earnerTax(model, {}, { label: "You", gross, pension: 0.1 });
    assert.ok(plain.result.lines.some((l) => l.amount > 0), "payroll contributions remain due");
    assert.ok(!saving.result.lines.some((l) => l.label.includes("tax credit (received)")));
    assert.equal(saving.result.net, plain.result.net - gross * 0.1);
  }
  const p = householdTax(TAX_MODELS.PT!, {}, [
    { label: "You", gross: 15_000, pension: 0.1, age: 30 },
    { label: "Partner", gross: 1_000, pension: 0.1, age: 30 },
  ], true);
  for (const person of p.people) {
    const irs = person.result.lines.filter((l) => l.label.startsWith("IRS income tax")).reduce((s, l) => s + l.amount, 0);
    const credit = person.result.lines.find((l) => l.label.includes("tax credit (received)"))?.amount ?? 0;
    assert.ok(irs + credit >= -0.01, "joint filing also caps the credit at IRS due");
  }
});

test("Ireland's weekly PRSI credit and Sweden's pension fee exemption and rounding", () => {
  const prsi = (weekly: number) => TAX_MODELS.IE!.compute({ gross: weekly * 52 }).lines.find((l) => l.label.startsWith("PRSI"))!.amount;
  assert.equal(prsi(352), 0);
  const blended = 0.042 * 9 / 12 + 0.0435 * 3 / 12;
  assert.equal(prsi(352.01), Math.round((352.01 * blended - 12) * 52 * 100) / 100);
  assert.equal(prsi(377), Math.round((377 * blended - (12 - (377 - 352.01) / 6)) * 52 * 100) / 100);
  assert.equal(prsi(425), Math.round(425 * blended * 52 * 100) / 100);
  const fee = (gross: number) => TAX_MODELS.SE!.compute({ gross }).lines.find((l) => l.label === "General pension fee")!.amount;
  assert.equal(fee(25_041), 0);
  assert.equal(fee(25_042), 1_700);
  assert.equal(fee(75_000), 5_200, "SEK 5,250 rounds down on a tie");
  assert.equal(fee(100_715), 7_000, "base is rounded down before calculating the fee");
  assert.equal(fee(1_000_000), 47_100);
});

test("Hungary's pension tax transfer increases the fund, not spendable take-home pay", () => {
  const model = TAX_MODELS.HU!;
  const plain = earnerTax(model, {}, { label: "You", gross: 1_000_000 });
  const saving = earnerTax(model, {}, { label: "You", gross: 1_000_000, pension: 0.5 });
  assert.equal(saving.result.net, plain.result.net - 500_000);
  assert.equal(saving.result.lines.find((l) => l.label.endsWith("tax transfer into pension"))?.amount, 100_000);
  assert.equal(saving.result.lines.find((l) => l.label.includes("tax credit (received)"))?.amount, -100_000);
  assert.ok(saving.result.sources.some((s) => s.url.includes("nav.gov.hu")));
});

test("statutory leave preserves the legal unit, first-year minimum and age boundary", () => {
  assert.equal(STATUTORY_LEAVE.GB!.days, 28);
  assert.equal(STATUTORY_LEAVE.FI!.days, 20);
  assert.equal(STATUTORY_LEAVE.ES!.days, 30 * 5 / 7);
  assert.equal(STATUTORY_LEAVE.AE!.days, 30 * 5 / 7);
  assert.match(STATUTORY_LEAVE.ES!.note, /not an exact workday entitlement/);
  assert.equal(ageExtraLeave("CH", 19)?.days, 5);
  assert.equal(ageExtraLeave("CH", 20), null);
  assert.equal(ageExtraLeave("NO", 59), null);
  assert.equal(ageExtraLeave("NO", 60)?.days, 5);
  const snapshot = JSON.parse(readFileSync(new URL("../data/observations/labour-law.json", import.meta.url), "utf8"));
  for (const [city, observations] of Object.entries(snapshot.observations) as [string, { value: number; url: string; note: string }[]][]) {
    const law = STATUTORY_LEAVE[city.split("-").at(-1)!.toUpperCase()]!;
    assert.equal(observations[0]!.value, law.days, city);
    assert.equal(observations[0]!.url, law.source.url, city);
    assert.equal(observations[0]!.note, `${law.note} (${law.source.label})`, city);
  }
});
