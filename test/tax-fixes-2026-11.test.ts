// Statutory corrections and regime bases, each checked against the primary source named in its comment. Expected
// figures are worked out by hand from that source, not read back from the model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { progressive } from "../src/tax/common.ts";
import { TAX_MODELS } from "../src/tax/index.ts";
import { austria, split } from "../src/tax/at.ts";
import { careRate, germany } from "../src/tax/de.ts";
import { finland } from "../src/tax/fi.ts";
import { householdTax } from "../src/tax/household.ts";
import { italy } from "../src/tax/it.ts";
import { generalCredit, labourCredit, netherlands } from "../src/tax/nl.ts";
import { portugal, subsistenceAllowance, taxableIncome as ptTaxable } from "../src/tax/pt.ts";
import { childTaxCredit, unitedStates } from "../src/tax/us.ts";
import { line, near } from "./tax-helpers.ts";

// ---------- Italy ----------

test("Italy: trattamento integrativo of €1,200 up to €15,000 of income (D.L. 3/2020 art. 1)", () => {
  // https://www.normattiva.it/eli/id/2020/02/05/20G00013/CONSOLIDATED: €1,200 when income is at most €15,000 and gross
  // tax exceeds the art. 13 employment credit less €75. €16,000 gross: INPS 9.19% = 1,470.40 → income 14,529.60;
  // gross tax 23% = 3,341.81 > 1,955 − 75, so it is due.
  const r = italy.compute({ gross: 16_000, region: "IT-21", city: "turin-it" });
  near(line(r, "Trattamento integrativo"), -1_200);
  // €30,000 gross (income 27,243): above €15,000 and the tax exceeds the credits, so nothing.
  assert.ok(!italy.compute({ gross: 30_000, region: "IT-21", city: "turin-it" }).lines.some((l) => l.label.startsWith("Trattamento")));
});

test("Italy: no regional or municipal surcharge when no net IRPEF is due", () => {
  // Regione Piemonte: "L'addizionale è dovuta se, per lo stesso anno, risulta dovuta l'IRPEF, al netto delle detrazioni"
  // (https://www.regione.piemonte.it/web/temi/tributi/addizionali-regionali/addizionale-regionale-allirpef).
  // €8,000 gross: income 7,264.80, gross tax 1,670.90 below the €1,955 employment credit.
  const r = italy.compute({ gross: 8_000, region: "IT-21", city: "turin-it" });
  near(line(r, "IRPEF"), 0);
  near(line(r, "Regional surcharge"), 0);
  near(line(r, "Municipal surcharge"), 0);
});

test("Italy: 2026 regional surcharges from the Ministry of Finance register", () => {
  // https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/addregirpef/addregirpef.php?reg=NN&anno=2026
  // €100,000 gross: INPS 100,000 → 122,295 cap not reached: 9,190 + 437.76 = 9,627.76 → taxable 90,372.24.
  const taxable = 100_000 - (100_000 * 0.0919 + (100_000 - 56_224) * 0.01);
  const regional = (region: string) => line(italy.compute({ gross: 100_000, region }), "Regional surcharge");
  const bands = (rates: number[]) => 15_000 * rates[0]! + 13_000 * rates[1]! + 22_000 * rates[2]! + (taxable - 50_000) * rates[3]!;
  near(regional("IT-21"), bands([0.0162, 0.0268, 0.0331, 0.0333])); // Piemonte, top band 3.33% above €50,000
  near(regional("IT-25"), bands([0.0123, 0.0158, 0.0172, 0.0173])); // Lombardia
  near(regional("IT-45"), bands([0.0133, 0.0193, 0.0278, 0.0333])); // Emilia-Romagna
  near(regional("IT-52"), bands([0.0142, 0.0143, 0.0332, 0.0333])); // Toscana
  near(regional("IT-72"), bands([0.0173, 0.0296, 0.032, 0.0333])); // Campania
  near(regional("IT-62"), 15_000 * 0.0173 + (taxable - 15_000) * 0.0333); // Lazio
});

test("Italy: Lazio taxes the whole income at 1.73% up to €28,000, and takes €60 off between €28,001 and €30,000", () => {
  // L.R. Lazio 20/2025 art. 2 c. 2-3, as registered with the Ministry of Finance for 2026 (reg=08).
  const at = (gross: number) => {
    const r = italy.compute({ gross, region: "IT-62" });
    const taxable = gross - gross * 0.0919;
    return { surcharge: line(r, "Regional surcharge"), taxable };
  };
  const low = at(30_000); // taxable 27,243
  near(low.surcharge, low.taxable * 0.0173);
  const mid = at(32_500); // taxable 29,513.25: banded, less €60
  near(mid.surcharge, 15_000 * 0.0173 + (mid.taxable - 15_000) * 0.0333 - 60);
});

test("Italy: municipal surcharges of the seed cities, from each council's resolution in the Ministry register", () => {
  // https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/nuova_addcomirpef/sceltaregione.htm
  // Torino: 0.8% to €28,000, 1.1% to €50,000, 1.2% above, nothing up to €11,790 (resolution 195, under
  // L. 207/2024 c. 751: a higher rate than the 0.8% ordinary ceiling is lawful here). Roma 0.9%, exempt to €14,000.
  const taxable = 100_000 - (100_000 * 0.0919 + (100_000 - 56_224) * 0.01);
  near(line(italy.compute({ gross: 100_000, city: "turin-it" }), "Municipal"), 28_000 * 0.008 + 22_000 * 0.011 + (taxable - 50_000) * 0.012);
  near(line(italy.compute({ gross: 100_000, city: "rome-it" }), "Municipal"), taxable * 0.009);
  near(line(italy.compute({ gross: 100_000, city: "milan-it" }), "Municipal"), taxable * 0.008);
  near(line(italy.compute({ gross: 100_000, city: "naples-it" }), "Municipal"), taxable * 0.01);
  near(line(italy.compute({ gross: 100_000, city: "florence-it" }), "Municipal"), taxable * 0.002);
  // Firenze exempts income up to €25,000: €26,000 gross gives taxable 23,610.60.
  near(line(italy.compute({ gross: 26_000, city: "florence-it" }), "Municipal"), 0);
  // Unknown cities and regions are flagged as approximate, the seed cities are not.
  assert.equal(italy.compute({ gross: 60_000, region: "IT-62", city: "rome-it" }).completeness.status, "complete");
  assert.equal(italy.compute({ gross: 60_000, region: "IT-88" }).completeness.status, "approximate");
});

// ---------- Finland ----------

test("Finland: the key-employee 25% replaces the health insurance contributions and the Yle tax", () => {
  // Vero, avainhenkilöiden verotus 3.2: no insured person's health insurance contribution on top of the source tax
  // (https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/106825/avainhenkiloiden-verotus4/); the Yle tax is on
  // earned income under the Income Tax Act (Laki yleisradioverosta 484/2012 § 2). €100,000: 25,000 tax, 7.30% pension,
  // 0.89% unemployment → net 66,810.
  const r = finland.compute({ gross: 100_000, tweak: { flatRate: 0.25, flatRateScope: "all" } });
  assert.ok(!r.lines.some((l) => /Health insurance|Yle/.test(l.label)));
  near(r.net, 100_000 - 25_000 - 7_300 - 890);
});

// ---------- Netherlands ----------

test("Netherlands: a workplace pension premium lowers the income both credits are worked out on", () => {
  // Belastingdienst credit tables 2026: the general credit falls 6.398% of income above €29,736; the labour credit
  // 6.51% above €45,592. A €6,000 premium on €60,000 leaves €54,000 of taxable wages.
  const r = netherlands.compute({ gross: 60_000, tweak: { pretaxDeduction: 6_000 } });
  const box1 = 38_883 * 0.3575 + (54_000 - 38_883) * 0.3756;
  near(line(r, "Income tax"), box1 - generalCredit(54_000) - labourCredit(54_000));
  near(generalCredit(54_000) - generalCredit(60_000), 6_000 * 0.06398);
});

// ---------- Portugal ----------

test("Portugal: on a joint return the subsistence ceiling reads the couple's combined gross (CIRS art. 70(4)(a))", () => {
  // https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs70.aspx: no
  // allowance for either holder when the sum of all holders' gross exceeds 2.2 × 14 × IAS times the number of
  // taxpayers (2 × 16,543.60 = 33,087.21). €12,880 alone gets an allowance; next to a €40,000 spouse it does not.
  const specific = 8.54 * 537.13;
  assert.ok(subsistenceAllowance(12_880, specific) > 0);
  near(subsistenceAllowance(12_880, specific, { gross: 52_880, filers: 2 }), 0);
  near(ptTaxable(12_880, { gross: 52_880, filers: 2 }), 12_880 - specific);
  // Joint return: taxable 35,412.91 (40,000 − 4,587.09) + 8,292.91 (12,880 − 4,587.09, no allowance) = 43,705.82;
  // half is 21,852.91, taxed 3,697.44 on the DL 212/2026 scale; twice that less two €250 credits = 6,894.88.
  // Keeping the €12,880 earner's own allowance would give 5,421.36: €1,473.52 too little.
  const h = householdTax(portugal, {}, [{ label: "You", gross: 40_000 }, { label: "Spouse", gross: 12_880 }], true);
  assert.equal(h.filing.mode, "joint");
  near(h.combined.lines.filter((l) => l.label.includes("IRS income tax, joint return")).reduce((s, l) => s + l.amount, 0), 6_894.88, 0.05);
});

// ---------- Germany ----------

test("Germany: no childless surcharge under 23 (§ 55 (3) SGB XI), and parenthood counts for both parents", () => {
  // https://www.gesetze-im-internet.de/sgb_11/__55.html: the 0.6-point surcharge applies to the childless who have
  // turned 23. €60,000 is below the €69,750 ceiling: 0.6% of it is €360.
  near(careRate([], 22), 0.018);
  near(careRate([], 23), 0.024);
  const young = germany.compute({ gross: 60_000, age: 22 });
  const older = germany.compute({ gross: 60_000, age: 30 });
  near(line(older, "Care insurance") - line(young, "Care insurance"), 360);
  const h = householdTax(germany, {}, [{ label: "You", gross: 60_000, age: 35, children: [4] }, { label: "Spouse", gross: 40_000, age: 35, children: [4] }], true);
  near(line(h.people[1]!.result, "Care insurance"), 40_000 * 0.018);
});

// ---------- United States ----------

test("US: the Child Tax Credit phases out above $400,000 on a joint return, and either spouse's children count", () => {
  // IRC § 24(b)(2): $400,000 for a joint return, $200,000 otherwise (https://www.irs.gov/credits-deductions/individuals/child-tax-credit).
  near(childTaxCredit(300_000, 50_000, [5], true), 2_200);
  near(childTaxCredit(300_000, 50_000, [5], false), 0);
  // A married couple where the first person earns nothing and the spouse earns $100,000, one child of 5.
  const h = householdTax(unitedStates, { region: "US-TX" }, [{ label: "You", gross: 0, children: [5] }, { label: "Spouse", gross: 100_000, children: [5], claimsChildren: false }], true);
  assert.equal(h.filing.mode, "joint");
  // Joint federal: (100,000 − 32,200) → 2,480 + 43,000 × 12% = 7,640, less $2,200 = 5,440.
  near(h.combined.lines.filter((l) => l.label.includes("Federal income tax")).reduce((s, l) => s + l.amount, 0), 5_440);
});

test("US: a state with no state module is partial; a state with no wage tax is complete", () => {
  assert.equal(unitedStates.compute({ gross: 120_000, region: "US-OR" }).completeness.status, "partial");
  assert.equal(unitedStates.compute({ gross: 120_000 }).completeness.status, "partial");
  assert.equal(unitedStates.compute({ gross: 120_000, region: "US-TX" }).completeness.status, "complete");
  assert.equal(unitedStates.compute({ gross: 120_000, region: "US-WY" }).completeness.status, "complete");
});

// ---------- Austria ----------

test("Austria: 13th and 14th salaries above €83,333 are taxed on the tariff, not left untaxed (§ 67 (2) EStG)", () => {
  // https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004570&Paragraf=67: the fixed
  // rates cover the first €83,333 after contributions; the excess is taxed under § 67 (10), with regular pay, on the
  // § 33 tariff (2026: 0/20/30/40/48/50/55% at 13,539/21,992/36,458/70,365/104,859/1,000,000).
  const tariff = (x: number) => progressive(x, [[13_539, 0], [21_992, 0.2], [36_458, 0.3], [70_365, 0.4], [104_859, 0.48], [1_000_000, 0.5], [Infinity, 0.55]]);
  const gross = 1_400_000; // 14 × €100,000
  const s = split(gross, "vienna-at");
  const excess = s.special - s.specialSv - 83_333;
  const regularBase = s.regular - s.regularSv - 132; // less the € 132 work expenses allowance
  const r = austria.compute({ gross, city: "vienna-at" });
  near(line(r, "Tax on 13th and 14th"), 24_380 * 0.06 + 25_000 * 0.27 + 33_333 * 0.3575);
  near(line(r, "Income tax on regular pay"), tariff(regularBase + excess) - 496); // less the traffic credit
});

// ---------- Spain, Switzerland, Canada, Portugal islands ----------

test("completeness: unsupported jurisdictions say so instead of passing for a cheaper place", () => {
  // Switzerland outside Zurich and Geneva: cantonal and communal tax are left out, so the figure is partial.
  const basel = TAX_MODELS.CH!.compute({ gross: 120_000, region: "CH-BS" });
  assert.equal(basel.completeness.status, "partial");
  assert.ok(basel.completeness.missing[0]!.includes("cantonal"));
  // Zurich itself: every tax is there, but BVG and NBU are stand-ins (statutory minimum, assumed rate): approximate.
  assert.equal(TAX_MODELS.CH!.compute({ gross: 120_000, region: "CH-ZH", city: "zurich-ch" }).completeness.status, "approximate");
  const winterthur = TAX_MODELS.CH!.compute({ gross: 120_000, region: "CH-ZH", city: "winterthur-ch" }).completeness;
  assert.equal(winterthur.status, "approximate");
  assert.ok(winterthur.approximations.some((a) => a.includes("winterthur-ch") && a.includes("Zurich's multiplier")));
  assert.equal(TAX_MODELS.CA!.compute({ gross: 120_000, region: "CA-AB" }).completeness.status, "partial");
  assert.equal(TAX_MODELS.CA!.compute({ gross: 120_000, region: "CA-ON" }).completeness.status, "complete");
  // The Basque Country and Navarre levy their own income tax: the common regime does not apply.
  assert.equal(TAX_MODELS.ES!.compute({ gross: 60_000, region: "ES-PV" }).completeness.status, "unsupported");
  assert.equal(TAX_MODELS.ES!.compute({ gross: 60_000, region: "ES-NC" }).completeness.status, "unsupported");
  assert.equal(TAX_MODELS.ES!.compute({ gross: 60_000, region: "ES-MD" }).completeness.status, "complete");
  assert.equal(TAX_MODELS.ES!.compute({ gross: 60_000, region: "ES-GA" }).completeness.status, "approximate");
  // The Azores and Madeira set lower rates: mainland ones overstate tax, an approximation and never an advantage.
  assert.equal(TAX_MODELS.PT!.compute({ gross: 60_000, region: "PT-20" }).completeness.status, "approximate");
});

test("France: a flat-rate setting for one spouse never claims France taxes spouses separately", () => {
  const h = householdTax(TAX_MODELS.FR!, {}, [{ label: "You", gross: 80_000, tweak: { flatRate: 0.2 } }, { label: "Spouse", gross: 30_000 }], true);
  assert.equal(h.filing.mode, "individual");
  assert.equal(h.filing.status, "approximate");
  assert.match(h.filing.note!, /taxed together/);
  assert.doesNotMatch(h.filing.note!, /taxes each spouse on their own income/);
  assert.equal(h.combined.completeness.status, "approximate");
});

test("a pension deduction comes off in full under a newcomer exemption (it is not shrunk by the taxable share)", () => {
  // Italy: the impatriati exemption leaves half of employment income out of reddito complessivo; the €5,300 supplementary
  // pension deduction (D.Lgs. 252/2005 art. 8(4)) then comes off that income in full.
  const share = 0.5;
  const work = 100_000 - (100_000 * 0.0919 + (100_000 - 56_224) * 0.01);
  const r = italy.compute({ gross: 100_000, tweak: { taxableShare: share, pretaxDeduction: 5_300 } });
  const taxable = work * share - 5_300; // 39,886.12 (the old order gave (90,372.24 − 5,300) × 0.5 = 42,536.12)
  const grossTax = 28_000 * 0.23 + (taxable - 28_000) * 0.33;
  // Employment credit on reddito complessivo (45,186.12): 1,910 × (50,000 − 45,186.12) / 22,000; no cuneo credit,
  // whose limit reads the whole 90,372.24.
  const credit = (1_910 * (50_000 - work * share)) / 22_000;
  near(line(r, "IRPEF"), grossTax - credit);
});
