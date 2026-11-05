import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { money } from "../src/core/money.ts";
import type { Iso2 } from "../src/core/types.ts";
import { TAX_MODELS } from "../src/tax/index.ts";
import {
  NO_WAGE_REGIME,
  REGIMES,
  eligibleRegimes,
  exemptAmount,
  regimeById,
  regimeTweak,
  withRegime,
  type Condition,
  type RegimeFacts,
} from "../src/tax/regimes.ts";
import { fixture, profile } from "./fixture.ts";

const near = (a: number, b: number, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
const line = (r: { lines: { label: string; amount: number }[] }, prefix: string) => r.lines.find((l) => l.label.startsWith(prefix))!.amount;
const R = (id: string) => regimeById(id)!;
/** Taxable pay under a regime's tweak: gross × taxable share. */
const taxable = (id: string, gross: number) => gross * regimeTweak(R(id), gross).taxableShare!;

// ---------- Effect on taxable income, worked by hand ----------

test("NL expat scheme: 30% carved out, salary floor and €262k cap respected", () => {
  near(taxable("nl-expat", 70_000), 49_000); // 30% × 70,000 = 21,000 tax-free (the Belastingdienst's own example 1)
  near(taxable("nl-expat", 50_000), 48_013); // 30% would be 15,000, but only 50,000 − 48,013 = 1,987 may be tax-free (their example 2)
  near(taxable("nl-expat", 300_000), 221_400); // 30% × 262,000 = 78,600 tax-free, the 2026 maximum
  near(taxable("nl-expat-young-master", 45_000), 36_497); // 13,500 would cut below the 36,497 floor: 8,503 tax-free
  near(taxable("nl-expat-research", 40_000), 28_000); // no floor for researchers: 30% × 40,000 = 12,000 tax-free
});

test("PT IFICI: flat 20% on the national schedule", () => {
  assert.deepEqual({ ...regimeTweak(R("pt-ifici"), 80_000), note: undefined }, { flatRate: 0.2, flatRateScope: "national", note: undefined });
});

test("ES Beckham: flat 24% replacing state and regional tax, 47% above €600k blended", () => {
  const t = regimeTweak(R("es-beckham"), 100_000);
  assert.equal(t.flatRate, 0.24);
  assert.equal(t.flatRateScope, "all");
  near(regimeTweak(R("es-beckham"), 1_000_000).flatRate!, 0.332, 1e-9); // (24% × 600,000 + 47% × 400,000) / 1,000,000 = 332,000 / 1,000,000
});

test("IT impatriati: 50% taxed (40% with a child), only on the first €600k", () => {
  near(taxable("it-impatriati", 80_000), 40_000); // 50% × 80,000
  near(taxable("it-impatriati", 1_000_000), 700_000); // 50% × 600,000 = 300,000 tax-free; the rest fully taxed
  near(taxable("it-impatriati-child", 80_000), 32_000); // 60% × 80,000 = 48,000 tax-free
});

test("IT impatriati through the Italian model: IRPEF on half the income", () => {
  const tweak = regimeTweak(R("it-impatriati"), 80_000);
  const r = TAX_MODELS.IT!.compute({ gross: 80_000, region: "IT-21", city: "turin-it", tweak });
  // INPS 80,000 × 9.19% + (80,000 − 56,224) × 1% = 7,589.76 → base 72,410.24 → half is 36,205.12
  // IRPEF 28,000 × 23% + 8,205.12 × 33% = 9,147.69; employment credit 1,910 × 13,794.88 / 22,000 = 1,197.64.
  // No cuneo credit: its €40,000 limit reads the whole income, the exempt half included (L. 207/2024 art. 1 c. 9,
  // https://www.gazzettaufficiale.it/eli/id/2024/12/31/24G00229/sg), and 72,410.24 is above it → 7,950.05.
  near(line(r, "INPS"), 7_589.76);
  near(line(r, "IRPEF"), 7_950.05, 1);
  const plain = TAX_MODELS.IT!.compute({ gross: 80_000, region: "IT-21", city: "turin-it" });
  assert.equal(line(r, "INPS"), line(plain, "INPS")); // contributions are not halved
  assert.ok(r.net > plain.net + 10_000);
});

test("FR impatriés: 30% of pay left out of income tax", () => {
  near(taxable("fr-impatries", 100_000), 70_000);
});

test("BE impatriates: up to 35% on top of salary, with the €70k salary floor", () => {
  near(taxable("be-impatriate", 120_000), 88_888.89, 0.01); // package 120,000 = salary 88,888.89 + 35% allowance 31,111.11
  near(taxable("be-impatriate", 80_000), 70_000); // 35/135 would be 20,740.74, but the salary may not drop below 70,000: 10,000
  near(taxable("be-impatriate-researcher", 54_000), 40_000, 0.01); // no floor: 54,000 / 1.35 = 40,000 salary + 14,000 allowance
});

test("DK researcher scheme: flat 27% replacing every income-tax layer", () => {
  const t = regimeTweak(R("dk-researcher"), 900_000);
  assert.equal(t.flatRate, 0.27);
  assert.equal(t.flatRateScope, "all");
});

test("SE expert relief: a quarter of pay tax-free", () => {
  near(taxable("se-expert", 1_200_000), 900_000); // 25% × 1,200,000 = 300,000 tax-free
});

test("FI key employee: final 25% replacing state, municipal and church tax", () => {
  const t = regimeTweak(R("fi-key-employee"), 90_000);
  assert.equal(t.flatRate, 0.25);
  assert.equal(t.flatRateScope, "all");
});

test("AT researcher allowance and GR 5C: 30% and 50% tax-free", () => {
  near(taxable("at-researcher", 90_000), 63_000); // 30% × 90,000 = 27,000 tax-free
  near(taxable("gr-5c", 60_000), 30_000); // 50% × 60,000
});

test("IE SARP: 30% of pay between €125k and €1m, income tax only", () => {
  near(taxable("ie-sarp", 200_000), 177_500); // 30% × (200,000 − 125,000) = 22,500 tax-free
  near(taxable("ie-sarp", 1_500_000), 1_237_500); // 30% × (1,000,000 − 125,000) = 262,500 tax-free
  near(taxable("ie-sarp", 120_000), 120_000); // below the threshold nothing is tax-free
  const tweak = regimeTweak(R("ie-sarp"), 200_000);
  const r = TAX_MODELS.IE!.compute({ gross: 200_000, tweak });
  const plain = TAX_MODELS.IE!.compute({ gross: 200_000 });
  near(line(r, "Income tax"), 58_200); // 44,000 × 20% + 133,500 × 40% − 4,000 credits
  assert.equal(line(r, "Universal Social Charge"), line(plain, "Universal Social Charge")); // USC on all pay
});

test("PL return relief: up to PLN 85,528 tax-free", () => {
  near(taxable("pl-return", 200_000), 114_472); // 200,000 − 85,528
  near(taxable("pl-return", 60_000), 0); // all of it under the limit
  near(exemptAmount(R("pl-return").effect, 85_528), 85_528);
});

// ---------- The tweak contract ----------

test("flatRateScope 'all' zeroes the sub-national layers; the default keeps them", () => {
  const all = TAX_MODELS.US!.compute({ gross: 150_000, region: "US-CA", tweak: { flatRate: 0.2, flatRateScope: "all" } });
  const national = TAX_MODELS.US!.compute({ gross: 150_000, region: "US-CA", tweak: { flatRate: 0.2 } });
  assert.equal(line(all, "California income tax"), 0);
  assert.ok(line(national, "California income tax") > 9_000);
  assert.equal(line(all, "Federal income tax"), line(national, "Federal income tax"));
  assert.ok(all.caveats.some((c) => c.includes("every layer of income tax")));
});

test("the person's own tweak wins over the regime's", () => {
  const t = withRegime({ taxableShare: 0.9, note: "Mine." }, R("it-impatriati"), 80_000)!;
  assert.equal(t.taxableShare, 0.9);
  assert.ok(t.note!.includes("Impatriati") && t.note!.endsWith("Mine."));
  assert.equal(withRegime(undefined, undefined, 80_000), undefined);
});

test("money model never counts a regime by default; a chosen one is established or a scenario, and a fact can rule it out", () => {
  const data = fixture();
  const torino = data.cities.find((c) => c.id === "turin-it")!;
  const base = profile();
  const off = money(data, base, torino);
  assert.equal(off.regime, null);
  // Someone who has never lived in Italy still gets ordinary taxation until they choose the regime.
  const newcomer = profile({ household: [{ label: "Me", citizenships: ["FR"], newcomer: { yearsSinceResident: { IT: "never" }, age: 35 } }] });
  const notChosen = money(data, newcomer, torino);
  assert.equal(notChosen.regime, null);
  assert.equal(notChosen.net, off.net);
  // Chosen with conditions unconfirmed: a labelled scenario, with what is left to confirm.
  const on = money(data, profile({ income: { ...base.income, regimes: { IT: "it-impatriati" } } }), torino);
  assert.ok(on.net! > off.net! + 8_000);
  assert.equal(on.regime?.status, "scenario");
  assert.equal(on.regime?.byDefault, false);
  assert.ok(on.regime!.unconfirmed.length >= 3);
  assert.ok(on.tax!.caveats.some((c) => c.includes("scenario you chose")));
  assert.equal(on.completeness.status, "approximate");
  // Chosen, every fact and answer meeting it: established.
  const confirmed = Object.fromEntries(R("it-impatriati").conditions.map((c) => [c.id, true]));
  const sure = profile({ household: [{ label: "Me", citizenships: ["FR"], newcomer: { yearsSinceResident: { IT: "never" }, age: 35, confirmed } }], income: { ...base.income, regimes: { IT: "it-impatriati" } } });
  assert.equal(money(data, sure, torino).regime?.status, "established");
  // Chosen, but a fact fails a condition (resident in Italy last year): not counted, and said.
  const recent = profile({ household: [{ label: "Me", citizenships: ["FR"], newcomer: { yearsSinceResident: { IT: 1 } } }], income: { ...base.income, regimes: { IT: "it-impatriati" } } });
  const ruled = money(data, recent, torino);
  assert.equal(ruled.regime, null);
  assert.equal(ruled.net, off.net);
  assert.ok(ruled.tax!.caveats.some((c) => c.includes("was not counted") && c.includes("last resident 1 years ago")));
  const none = money(data, { ...newcomer, income: { ...newcomer.income, regimes: { IT: "none" } } }, torino);
  assert.equal(none.regime, null);
  const wrong = money(data, profile({ income: { ...base.income, regimes: { IT: "es-beckham" } } }), torino);
  assert.equal(wrong.net, off.net);
  assert.ok(wrong.tax!.caveats.some((c) => c.includes("not known for Italy")));
});

test("Netherlands: no fall-through between the expat variants, so take-home never drops for a €1 raise", () => {
  // The old default chose nl-expat-research (no salary floor) at €48,012 and nl-expat at €48,013: −€6,159.50 for €1.
  const data = fixture();
  const ams = { id: "amsterdam-nl", name: "Amsterdam", country: "NL", lat: 52.37, lon: 4.9 };
  data.cities.push(ams);
  data.countries.NL = { code: "NL", name: "Netherlands", currency: "EUR", areas: ["EU"] };
  const at = (g: number, regimes?: Record<string, string>) => money(data, profile({ income: { ...profile().income, gross: g, currency: "EUR", ...(regimes ? { regimes } : {}) } }), ams).net!;
  assert.ok(at(48_013) >= at(48_012));
  assert.ok(at(48_013, { NL: "nl-expat" }) >= at(48_012, { NL: "nl-expat" }));
  assert.equal(money(data, profile({ income: { ...profile().income, gross: 48_012, currency: "EUR" } }), ams).regime, null);
});

// ---------- Eligibility ----------

/** Facts that satisfy every condition of a regime: never resident, enough pay, under 30, a child, an EU passport, every confirmation yes. */
function qualifying(country: Iso2, conditions: Condition[]): RegimeFacts {
  const confirmed: Record<string, boolean> = {};
  let gross = 0;
  const walk = (cs: Condition[]) =>
    cs.forEach((c) => {
      if (c.kind === "confirm") confirmed[c.id] = true;
      if (c.kind === "minSalary") gross = Math.max(gross, c.amount + 1);
      if (c.kind === "anyOf" || c.kind === "allOf") walk(c.options);
    });
  walk(conditions);
  return { yearsSinceResident: { [country]: "never" }, gross: Math.max(gross, 50_000), age: 28, minorChildren: 1, citizenships: country === "IT" ? ["FR"] : ["IT"], confirmed };
}

/** One way each regime fails, on top of qualifying facts. */
const FAILS: Record<string, (f: RegimeFacts) => RegimeFacts> = {
  "nl-expat": (f) => ({ ...f, gross: 45_000 }),
  "nl-expat-young-master": (f) => ({ ...f, age: 31 }),
  "nl-expat-research": (f) => ({ ...f, confirmed: { ...f.confirmed, "nl-150km": false } }),
  "pt-ifici": (f) => ({ ...f, yearsSinceResident: { PT: 2 } }),
  "es-beckham": (f) => ({ ...f, yearsSinceResident: { ES: 4 } }),
  "it-impatriati": (f) => ({ ...f, yearsSinceResident: { IT: 2 } }),
  "it-impatriati-child": (f) => ({ ...f, minorChildren: 0 }),
  "fr-impatries": (f) => ({ ...f, confirmed: { ...f.confirmed, "fr-recruited-abroad": false } }),
  "be-impatriate": (f) => ({ ...f, gross: 65_000 }),
  "be-impatriate-researcher": (f) => ({ ...f, yearsSinceResident: { BE: 3 } }),
  "dk-researcher": (f) => ({ ...f, gross: 600_000, confirmed: { ...f.confirmed, "dk-approved-researcher": false } }),
  "se-expert": (f) => ({ ...f, citizenships: ["SE"] }),
  "fi-key-employee": (f) => ({ ...f, gross: 60_000, confirmed: { ...f.confirmed, "fi-teacher-researcher": false } }),
  "at-researcher": (f) => ({ ...f, confirmed: { ...f.confirmed, "at-research": false } }),
  "gr-5c": (f) => ({ ...f, confirmed: { ...f.confirmed, "gr-job": false } }),
  "ie-sarp": (f) => ({ ...f, gross: 110_000 }),
  "pl-return": (f) => ({ ...f, citizenships: ["US"], confirmed: { ...f.confirmed, "pl-karta-or-history": false } }),
};

for (const regime of REGIMES) {
  test(`eligibility, ${regime.id}: a qualifying and a non-qualifying person`, () => {
    const yes = qualifying(regime.country, regime.conditions);
    const check = (f: RegimeFacts) => eligibleRegimes(regime.country, f).find((c) => c.regime.id === regime.id)!;
    assert.equal(check(yes).verdict, "eligible", JSON.stringify(check(yes).conditions));
    const fail = FAILS[regime.id];
    assert.ok(fail, `no failing case written for ${regime.id}`);
    assert.equal(check(fail(yes)).verdict, "not eligible");
  });
}

test("with no facts, every condition is yours to confirm", () => {
  const checks = eligibleRegimes("NL", {});
  assert.equal(checks.length, 3);
  assert.ok(checks.every((c) => c.verdict === "maybe" && c.conditions.every((x) => x.verdict === "confirm")));
});

test("eligible regimes come first, and nested paths explain themselves", () => {
  // Denmark: salary below the threshold, but an approved researcher; the salary route fails, the researcher route carries it.
  const confirmed = { "dk-approved-researcher": true, "dk-employer": true, "dk-not-management": true, "dk-move": true };
  const checks = eligibleRegimes("DK", { yearsSinceResident: { DK: 12 }, gross: 500_000, confirmed });
  const path = checks[0]!.conditions.find((c) => c.id === "dk-path")!;
  assert.equal(checks[0]!.verdict, "eligible");
  assert.deepEqual(path.options!.map((o) => o.verdict), ["not met", "met"]);
  // Italy: someone without children is eligible for the 50% regime, not the 60% one, and it is listed first.
  const it = eligibleRegimes("IT", { ...qualifying("IT", R("it-impatriati").conditions), minorChildren: 0 });
  assert.deepEqual(it.map((c) => [c.regime.id, c.verdict]), [["it-impatriati", "eligible"], ["it-impatriati-child", "not eligible"]]);
});

test("Greece's 5-of-6-years rule: a recent stay asks you to confirm instead of ruling you out", () => {
  const f = { ...qualifying("GR", R("gr-5c").conditions), yearsSinceResident: { GR: 2 } };
  assert.equal(eligibleRegimes("GR", f)[0]!.verdict, "maybe");
});

test("Austria's allowance needs more than five years away (§ 103(2) EStG); Denmark's scheme ten", () => {
  const at = (y: number) => eligibleRegimes("AT", { ...qualifying("AT", R("at-researcher").conditions), yearsSinceResident: { AT: y } })[0]!.verdict;
  assert.equal(at(3), "not eligible");
  assert.equal(at(6), "eligible");
  const dk = (y: number) => eligibleRegimes("DK", { ...qualifying("DK", R("dk-researcher").conditions), yearsSinceResident: { DK: y } })[0]!.verdict;
  assert.equal(dk(9), "not eligible");
  assert.equal(dk(10), "eligible");
});

test("Belgium: five years plus the three-year extension; Greece: seven, never extended", () => {
  assert.equal(R("be-impatriate").years, 8);
  assert.equal(R("be-impatriate-researcher").years, 8);
  assert.equal(R("gr-5c").years, 7);
});

// ---------- Records and docs ----------

test("every regime is complete, sourced and in the docs table", () => {
  const doc = readFileSync(new URL("../docs/tax-regimes.md", import.meta.url), "utf8");
  const ids = new Set<string>();
  for (const r of REGIMES) {
    assert.ok(!ids.has(r.id), `duplicate ${r.id}`);
    ids.add(r.id);
    assert.ok(r.summary.length > 20 && r.sources.length > 0 && r.years > 0, r.id);
    assert.ok(r.sources.every((s) => s.url.startsWith("https://")), r.id);
    assert.ok((r.effect.exemptShare !== undefined) !== (r.effect.flatRate !== undefined), `${r.id}: one effect, exempt share or flat rate`);
    assert.ok(doc.includes(`\`${r.id}\``), `${r.id} missing from docs/tax-regimes.md`);
  }
  for (const c of Object.keys(NO_WAGE_REGIME)) assert.ok(!REGIMES.some((r) => r.country === c), `${c} has a regime and a no-regime note`);
});
