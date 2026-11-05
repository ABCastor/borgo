import { claimedBy, completenessOf, finish, incomeTax, progressive, taxedShare, tweakCaveats, type Bands, type TaxInput, type TaxLine, type TaxModel } from "./common.ts";

// United States, wage income, tax year 2026: single filer, or married filing jointly for the federal tax. State income
// tax by module below.

const STANDARD_DEDUCTION = 16_100;
const FEDERAL_2026: Bands = [
  [12_400, 0.1],
  [50_400, 0.12],
  [105_700, 0.22],
  [201_775, 0.24],
  [256_225, 0.32],
  [640_600, 0.35],
  [Infinity, 0.37],
];
// Married filing jointly, Rev. Proc. 2025-32.
const STANDARD_DEDUCTION_JOINT = 32_200;
const FEDERAL_2026_JOINT: Bands = [
  [24_800, 0.1],
  [100_800, 0.12],
  [211_400, 0.22],
  [403_550, 0.24],
  [512_450, 0.32],
  [768_700, 0.35],
  [Infinity, 0.37],
];
// Child Tax Credit 2026, per child under 17: phased out by $50 per $1,000 of income above $200,000, or $400,000 on a
// joint return (IRC § 24(b)(2) and (h)(3); https://www.irs.gov/credits-deductions/individuals/child-tax-credit).
const CTC = { perChild: 2_200, refundable: 1_700, phaseFrom: 200_000, phaseFromJoint: 400_000, earnedFloor: 2_500 };

/** The Child Tax Credit against this federal tax: the part the tax absorbs, then the refundable part. */
export function childTaxCredit(agi: number, federal: number, children: number[] | undefined, joint = false): number {
  const n = (children ?? []).filter((a) => a < 17).length;
  if (!n) return 0;
  const credit = Math.max(0, CTC.perChild * n - 50 * Math.ceil(Math.max(0, agi - (joint ? CTC.phaseFromJoint : CTC.phaseFrom)) / 1_000));
  const used = Math.min(credit, federal);
  const refund = Math.min(credit - used, CTC.refundable * n, 0.15 * Math.max(0, agi - CTC.earnedFloor));
  return used + refund;
}

const SS_RATE = 0.062;
const SS_WAGE_BASE = 184_500;
const MEDICARE = 0.0145;
const ADDITIONAL_MEDICARE = 0.009;
const ADDITIONAL_MEDICARE_FROM = 200_000;

/** What a state module needs to know beyond its own rules. Wages are the whole AGI in this model. */
interface StateContext {
  gross: number;
  tweak: TaxInput["tweak"];
  city?: string;
  /** Federal taxable income before the person's tweaks (Colorado starts from it). */
  federalTaxable: number;
  /** Employee Social Security and Medicare paid (Massachusetts deducts part of it). */
  fica: number;
}

interface StateModel {
  label: string;
  compute(ctx: StateContext): TaxLine[];
  sources: { label: string; url: string }[];
  caveats: string[];
}

// California: 2025 schedule (the 2026 schedule is published late in the year), single filer.
const CA_2025: Bands = [
  [11_079, 0.01],
  [26_264, 0.02],
  [41_452, 0.04],
  [57_542, 0.06],
  [72_724, 0.08],
  [371_479, 0.093],
  [445_771, 0.103],
  [742_953, 0.113],
  [Infinity, 0.123],
];
const CA_STANDARD_DEDUCTION = 5_706;
const CA_PERSONAL_CREDIT = 153;
const CA_SDI = 0.013; // 2026, all wages

// New York State 2026, single (Tax Law §601(c)(1)(B)(vii)).
export const NY_2026: Bands = [
  [8_500, 0.039],
  [11_700, 0.044],
  [13_900, 0.0515],
  [80_650, 0.054],
  [215_400, 0.059],
  [1_077_550, 0.0685],
  [5_000_000, 0.0965],
  [25_000_000, 0.103],
  [Infinity, 0.109],
];
const NY_STANDARD_DEDUCTION = 8_000;
const NY_RECAPTURE_FROM = 107_650; // NY AGI above which the lower brackets' benefit is taken back
const NY_RECAPTURE_STEP = 50_000;
const NY_FLAT_ABOVE = 25_000_000; // NY AGI above which the top rate applies to all taxable income
const NY_SDI = { rate: 0.005, weeklyMax: 0.6 };
const NY_PFL = { rate: 0.00432, max: 411.91 };

/**
 * The tax-table benefit recapture of Tax Law §601(d-1), as the DTF worksheets compute it: from the bracket that
 * starts at $215,400 upward, each bracket has a fixed recapture base (the benefits already taken back) and an
 * increment phased in over $50,000 of AGI above the bracket's start.
 */
export function nyRecaptureSteps(bands: Bands): { from: number; base: number; increment: number }[] {
  const steps: { from: number; base: number; increment: number }[] = [];
  const first = bands.findIndex(([upper]) => upper === 215_400);
  let base = bands[first]![0] * bands[first]![1] - progressive(bands[first]![0], bands);
  for (let i = first + 1; i < bands.length - 1; i++) {
    const from = bands[i - 1]![0];
    const increment = from * bands[i]![1] - progressive(from, bands) - base;
    steps.push({ from, base, increment });
    base += increment;
  }
  return steps;
}

export function newYorkStateTax(agi: number, taxable: number, bands: Bands = NY_2026): number {
  const table = progressive(taxable, bands);
  if (agi <= NY_RECAPTURE_FROM) return table;
  if (agi > NY_FLAT_ABOVE) return taxable * bands[bands.length - 1]![1];
  const phase = (from: number) => Math.min(1, Math.max(0, agi - from) / NY_RECAPTURE_STEP);
  const steps = nyRecaptureSteps(bands);
  const step = steps.findLast((s) => taxable > s.from);
  if (!step) {
    // Up to $215,400 of taxable income: phase toward the flat 5.9% (2026) on all of it.
    const flat = taxable * bands.find(([upper]) => upper === 215_400)![1];
    return table + (flat - table) * phase(NY_RECAPTURE_FROM);
  }
  return table + step.base + step.increment * phase(step.from);
}

// New York City resident tax, single, and the school tax credits every resident gets.
const NYC: Bands = [
  [12_000, 0.03078],
  [25_000, 0.03762],
  [50_000, 0.03819],
  [Infinity, 0.03876],
];

function nycSchoolCredits(agi: number, taxable: number): number {
  const fixed = agi <= 250_000 ? 63 : 0;
  const rateReduction = agi > 500_000 ? 0 : taxable <= 12_000 ? taxable * 0.00171 : 21 + (taxable - 12_000) * 0.00228;
  return fixed + rateReduction;
}

// Massachusetts 2026
const MA_RATE = 0.05;
const MA_SURTAX = { rate: 0.04, above: 1_107_750 };
const MA_EXEMPTION = 4_400;
const MA_FICA_DEDUCTION_MAX = 2_000;
const MA_PFML_EMPLOYEE = 0.0018 + 0.0028; // all of family leave, 40% of medical leave

// Illinois 2026
const IL_RATE = 0.0495;
const IL_EXEMPTION = 2_925;
const IL_EXEMPTION_AGI_LIMIT = 250_000;

// Colorado: the statutory 4.4% (2026 not yet published by the Department of Revenue).
const CO_RATE = 0.044;
const CO_ADDBACK = { agiAbove: 300_000, deductionLimit: 1_000 }; // 2026 and later, single
const CO_FAMLI_EMPLOYEE = 0.0044;
const DENVER_OPT = { monthly: 5.75, fromMonthlyPay: 500 };

const STATES: Record<string, StateModel> = {
  "US-CA": {
    label: "California",
    compute({ gross, tweak }) {
      const t = taxedShare(gross - CA_STANDARD_DEDUCTION, tweak);
      const tax = Math.max(0, progressive(t, CA_2025) + Math.max(0, t - 1_000_000) * 0.01 - CA_PERSONAL_CREDIT);
      return [
        { label: "California income tax", amount: tax },
        { label: "California SDI", amount: gross * CA_SDI },
      ];
    },
    sources: [
      { label: "FTB: 2025 California tax rate schedules", url: "https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf" },
      { label: "EDD: 2026 contribution rates (SDI 1.3%)", url: "https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/" },
    ],
    caveats: ["California uses the 2025 schedule until the 2026 one is published.", "California standard deduction and personal credit are 2025 values, not checked against the FTB this year."],
  },
  "US-NY": {
    label: "New York",
    compute({ gross, tweak, city }) {
      const agi = taxedShare(gross, tweak);
      const taxable = Math.max(0, agi - NY_STANDARD_DEDUCTION);
      const lines: TaxLine[] = [{ label: "New York State income tax", amount: newYorkStateTax(agi, taxable) }];
      if (city === "new-york-us") {
        lines.push(
          { label: "New York City income tax", amount: progressive(taxable, NYC) },
          { label: "NYC school tax credits (received)", amount: -nycSchoolCredits(agi, taxable) },
        );
      }
      lines.push(
        { label: "New York SDI", amount: Math.min(gross * NY_SDI.rate, NY_SDI.weeklyMax * 52) },
        { label: "New York Paid Family Leave", amount: Math.min(gross * NY_PFL.rate, NY_PFL.max) },
      );
      return lines;
    },
    sources: [
      { label: "NY Tax Law §601: 2026 rate schedule and benefit recapture", url: "https://www.nysenate.gov/legislation/laws/TAX/601" },
      { label: "DTF: IT-201 instructions (standard deduction, recapture worksheets, NYC rates and school credits)", url: "https://www.tax.ny.gov/pdf/current_forms/it/it201i.pdf" },
      { label: "NY Paid Family Leave: 2026 contribution", url: "https://paidfamilyleave.ny.gov/2026" },
      { label: "WCB: disability benefits employee contribution", url: "https://www.wcb.ny.gov/content/main/DisabilityBenefits/employer-disability-benefits.jsp" },
    ],
    caveats: [
      "New York: the 2026 statutory rates; the recapture worksheets and NYC schedule follow the 2025 DTF instructions until the 2026 ones are published.",
      "New York City tax applies only when the city is New York City; Yonkers is not modelled. No household, Empire State or earned income credits.",
    ],
  },
  "US-MA": {
    label: "Massachusetts",
    compute({ gross, tweak, fica }) {
      const taxable = taxedShare(gross - MA_EXEMPTION - Math.min(fica, MA_FICA_DEDUCTION_MAX), tweak);
      return [
        { label: "Massachusetts income tax", amount: taxable * MA_RATE + Math.max(0, taxable - MA_SURTAX.above) * MA_SURTAX.rate },
        { label: "Massachusetts PFML", amount: Math.min(gross, SS_WAGE_BASE) * MA_PFML_EMPLOYEE },
      ];
    },
    sources: [
      { label: "Mass.gov: 4% surtax threshold by tax year", url: "https://www.mass.gov/info-details/massachusetts-4-surtax-on-taxable-income" },
      { label: "Mass.gov: tax rates (5% on wages)", url: "https://www.mass.gov/info-details/massachusetts-tax-rates" },
      { label: "Mass.gov: personal income tax exemptions", url: "https://www.mass.gov/info-details/personal-income-tax-exemptions" },
      { label: "Mass.gov: Social Security (FICA) and Medicare deduction", url: "https://www.mass.gov/info-details/social-security-fica-and-medicare-deduction" },
      { label: "Mass.gov: PFML contribution rates 2026", url: "https://www.mass.gov/info-details/paid-family-and-medical-leave-employer-contribution-rates-and-calculator" },
    ],
    caveats: [
      "Massachusetts PFML assumes an employer with 25 or more workers withholding the largest employee share allowed (0.46%).",
      "Massachusetts: no rent deduction, no limited income credit, no no-tax status for very low incomes.",
    ],
  },
  "US-IL": {
    label: "Illinois",
    compute({ gross, tweak }) {
      const exemption = gross > IL_EXEMPTION_AGI_LIMIT ? 0 : IL_EXEMPTION;
      return [{ label: "Illinois income tax", amount: taxedShare(gross - exemption, tweak) * IL_RATE }];
    },
    sources: [
      { label: "IDOR: IL-700-T 2026 withholding tables (4.95%, $2,925 exemption)", url: "https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/withholding/documents/currentyear/il-700-t.pdf" },
      { label: "IDOR: FY 2026-15, what's new (exemption limit above $250,000 AGI)", url: "https://tax.illinois.gov/research/publications/bulletins/fy-2026-15.html" },
    ],
    caveats: ["Illinois: no local income tax; no property tax or education credits."],
  },
  "US-CO": {
    label: "Colorado",
    compute({ gross, tweak, city, federalTaxable }) {
      const addback = gross > CO_ADDBACK.agiAbove ? Math.max(0, STANDARD_DEDUCTION - CO_ADDBACK.deductionLimit) : 0;
      const lines: TaxLine[] = [
        { label: "Colorado income tax", amount: taxedShare(federalTaxable + addback, tweak) * CO_RATE },
        { label: "Colorado FAMLI", amount: Math.min(gross, SS_WAGE_BASE) * CO_FAMLI_EMPLOYEE },
      ];
      if (city === "denver-us" && gross / 12 >= DENVER_OPT.fromMonthlyPay)
        lines.push({ label: "Denver occupational privilege tax", amount: 12 * DENVER_OPT.monthly });
      return lines;
    },
    sources: [
      { label: "Colorado DOR: individual income tax guide (rates, deduction addback)", url: "https://tax.colorado.gov/individual-income-tax-guide" },
      { label: "Colorado FAMLI: 2026 premium (0.44% employee share)", url: "https://famli.colorado.gov/individuals-and-families/how-famli-works/premium-and-benefits-calculator" },
      { label: "Denver: tax guide topic 61, occupational privilege tax", url: "https://www.denvergov.org/files/assets/public/v/4/finance/documents/treasury/tax-guides/2026/taxguidetopic61_occupationalprivilegetaxes.pdf" },
    ],
    caveats: [
      "Colorado uses the statutory 4.4%: the Department of Revenue has not published the 2026 rate, which TABOR can lower temporarily (4.25% in 2024).",
      "Denver's $5.75 monthly head tax is owed where you work; the model assumes you work in the city you live in.",
    ],
  },
};
// States with no tax on wages.
for (const [code, label] of [
  ["US-TX", "Texas"],
  ["US-FL", "Florida"],
  ["US-WA", "Washington"],
  ["US-NV", "Nevada"],
  ["US-TN", "Tennessee"],
  ["US-AK", "Alaska"],
  ["US-SD", "South Dakota"],
  ["US-WY", "Wyoming"],
  ["US-NH", "New Hampshire"],
] as const) {
  STATES[code] = { label, compute: () => [], sources: [], caveats: [`${label} has no state income tax on wages.`] };
}

export const unitedStates: TaxModel = {
  country: "US",
  year: 2026,
  currency: "USD",
  scope: "Wages only: federal income tax with the standard deduction (single, or married filing jointly), the Child Tax Credit, Social Security and Medicare, plus state tax where a state module exists and New York City tax.",
  sources: [
    { label: "IRS: tax year 2026 inflation adjustments (Rev. Proc. 2025-32)", url: "https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill" },
    { label: "SSA: contribution and benefit base", url: "https://www.ssa.gov/oact/cola/cbb.html" },
  ],
  childClaims: true,
  joint: {
    kind: "optional",
    base: (input) => input.gross,
    tax: (total, ctx) => {
      const federal = progressive(Math.max(0, total - STANDARD_DEDUCTION_JOINT), FEDERAL_2026_JOINT);
      return federal - childTaxCredit(total, federal, ctx?.children, true);
    },
    replaces: ["Federal income tax", "Child Tax Credit (received)"],
    label: "Federal income tax, joint return",
    note: "Married filing jointly: the joint brackets and standard deduction on the couple's combined wages, less the Child Tax Credit for the couple's children (phased out above $400,000). State taxes stay computed per person as single filers, and the Additional Medicare threshold stays per person.",
  },
  caveats: [
    "City income taxes only for New York City (and Denver's head tax); no itemised deductions. A 401(k) contribution is set as your pension share.",
    "The Child Tax Credit counts children under 17 and phases out above $200,000 of income ($400,000 on a joint return); for an unmarried couple one parent claims it. Dependent care credits are not modelled.",
    "A flat-rate setting replaces the federal schedule only; the taxable share applies to state and city tax too.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const federalTaxable = Math.max(0, g - STANDARD_DEDUCTION);
    const federal = incomeTax(federalTaxable, input.tweak, (t) => progressive(t, FEDERAL_2026));
    const fica = Math.min(g, SS_WAGE_BASE) * SS_RATE + g * MEDICARE + Math.max(0, g - ADDITIONAL_MEDICARE_FROM) * ADDITIONAL_MEDICARE;
    const lines: TaxLine[] = [
      { label: "Federal income tax", amount: federal },
      { label: "Social Security and Medicare", amount: fica },
    ];
    const ctc = childTaxCredit(g, federal, claimedBy(input));
    if (ctc > 0) lines.push({ label: "Child Tax Credit (received)", amount: -ctc });
    const state = input.region ? STATES[input.region] : undefined;
    const extra = [...tweakCaveats(input.tweak)];
    if (state) {
      lines.push(...state.compute({ gross: g, tweak: input.tweak, city: input.city, federalTaxable, fica }));
      extra.push(...state.caveats);
    } else {
      extra.push(input.region ? "No state module for this state yet: state income tax is not included." : "No state given: state income tax is not included.");
    }
    const completeness = completenessOf(state ? [] : [input.region ? `state income tax (${input.region})` : "state income tax (no state given)"]);
    const result = finish(this, g, lines, extra, completeness);
    if (state) result.sources = [...result.sources, ...state.sources];
    return result;
  },
};
