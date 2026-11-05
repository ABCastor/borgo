import { completenessOf, finish, incomeTax, progressive, taxedShare, tweakCaveats, type Bands, type TaxInput, type TaxLine, type TaxModel } from "./common.ts";

// Canada, employee resident in a province on 31 December 2026: federal tax plus provincial modules below.

const FEDERAL_2026: Bands = [
  [58_523, 0.14],
  [117_045, 0.205],
  [181_440, 0.26],
  [258_482, 0.29],
  [Infinity, 0.33],
];
const CREDIT_RATE = 0.14; // federal non-refundable credits use the lowest rate
const BPA_MAX = 16_452;
const BPA_MIN = 14_829; // reached where the 33% bracket begins
const CANADA_EMPLOYMENT_AMOUNT = 1_501;
const QUEBEC_ABATEMENT = 0.165;

// Pension plans: the base share earns a credit, the first additional (1%) and second additional parts are deducted.
const YMPE = 74_600;
const YAMPE = 85_000;
const BASIC_EXEMPTION = 3_500;
const ADDITIONAL_RATE = 0.01;
const SECOND_ADDITIONAL_RATE = 0.04;
const CPP = { label: "CPP contributions", base: 0.0495 };
const QPP = { label: "QPP contributions", base: 0.053 };

const EI = { rate: 0.0163, quebecRate: 0.013, maxInsurable: 68_900 };
const QPIP = { rate: 0.0043, maxInsurable: 103_000 };

interface Contributions {
  pension: number; // total employee contribution
  pensionBase: number; // the part that earns a credit
  pensionDeduction: number; // the enhanced parts, deducted from income
  ei: number;
  qpip: number;
}

function contributions(gross: number, quebec: boolean): Contributions {
  const plan = quebec ? QPP : CPP;
  const contributory = Math.max(0, Math.min(gross, YMPE) - BASIC_EXEMPTION);
  const pensionBase = contributory * plan.base;
  const first = contributory * ADDITIONAL_RATE;
  const second = Math.max(0, Math.min(gross, YAMPE) - YMPE) * SECOND_ADDITIONAL_RATE;
  return {
    pension: pensionBase + first + second,
    pensionBase,
    pensionDeduction: first + second,
    ei: Math.min(gross, EI.maxInsurable) * (quebec ? EI.quebecRate : EI.rate),
    qpip: quebec ? Math.min(gross, QPIP.maxInsurable) * QPIP.rate : 0,
  };
}

/** The basic personal amount shrinks from its maximum to its minimum across the 29% bracket. */
function basicPersonalAmount(netIncome: number): number {
  const [from, to] = [181_440, 258_482];
  if (netIncome <= from) return BPA_MAX;
  if (netIncome >= to) return BPA_MIN;
  return BPA_MAX - ((BPA_MAX - BPA_MIN) * (netIncome - from)) / (to - from);
}

function federalTax(taxable: number, gross: number, c: Contributions, quebec: boolean): number {
  const credits = CREDIT_RATE * (basicPersonalAmount(taxable) + c.pensionBase + c.ei + c.qpip + Math.min(gross, CANADA_EMPLOYMENT_AMOUNT));
  const basic = Math.max(0, progressive(taxable, FEDERAL_2026) - credits);
  return quebec ? basic * (1 - QUEBEC_ABATEMENT) : basic;
}

interface ProvinceModel {
  label: string;
  quebec?: boolean;
  compute(gross: number, c: Contributions, tweak: TaxInput["tweak"]): TaxLine[];
  sources: { label: string; url: string }[];
  caveats: string[];
}

// Ontario 2026
const ON_2026: Bands = [
  [53_891, 0.0505],
  [107_785, 0.0915],
  [150_000, 0.1116],
  [220_000, 0.1216],
  [Infinity, 0.1316],
];
const ON_BPA = 12_989;
const ON_REDUCTION_BASIC = 300;

function ontarioTax(taxable: number, c: Contributions): number {
  const basic = Math.max(0, progressive(taxable, ON_2026) - 0.0505 * (ON_BPA + c.pensionBase + c.ei));
  const surtax = 0.2 * Math.max(0, basic - 5_818) + 0.36 * Math.max(0, basic - 7_446);
  const beforeReduction = basic + surtax;
  const reduction = Math.max(0, Math.min(beforeReduction, 2 * ON_REDUCTION_BASIC - beforeReduction));
  return beforeReduction - reduction;
}

/** Ontario Health Premium on taxable income: each step phases in until it reaches its cap. */
function ontarioHealthPremium(taxable: number): number {
  if (taxable <= 20_000) return 0;
  if (taxable <= 36_000) return Math.min(300, 0.06 * (taxable - 20_000));
  if (taxable <= 48_000) return Math.min(450, 300 + 0.06 * (taxable - 36_000));
  if (taxable <= 72_000) return Math.min(600, 450 + 0.25 * (taxable - 48_000));
  if (taxable <= 200_000) return Math.min(750, 600 + 0.25 * (taxable - 72_000));
  return Math.min(900, 750 + 0.25 * (taxable - 200_000));
}

// British Columbia 2026, after Budget 2026 (lowest rate 5.06% to 5.60%, tax reduction $575 to $690)
const BC_2026: Bands = [
  [50_363, 0.056],
  [100_728, 0.077],
  [115_648, 0.105],
  [140_430, 0.1229],
  [190_405, 0.147],
  [265_545, 0.168],
  [Infinity, 0.205],
];
const BC_BPA = 13_216;

function bcTax(taxable: number, c: Contributions): number {
  const basic = Math.max(0, progressive(taxable, BC_2026) - 0.056 * (BC_BPA + c.pensionBase + c.ei));
  const reduction = Math.max(0, 690 - 0.0356 * Math.max(0, taxable - 25_570));
  return Math.max(0, basic - reduction);
}

// Quebec 2026
const QC_2026: Bands = [
  [54_345, 0.14],
  [108_680, 0.19],
  [132_245, 0.24],
  [Infinity, 0.2575],
];
const QC_BPA = 18_952;
const QC_WORKER_DEDUCTION = { rate: 0.06, max: 1_450 };

function quebecTax(taxable: number): number {
  return Math.max(0, progressive(taxable, QC_2026) - 0.14 * QC_BPA);
}

const CRA_T4127_JAN = { label: "CRA: T4127 payroll deductions formulas, 122nd edition (January 2026)", url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html" };
const CRA_T4127_JUL = { label: "CRA: T4127 payroll deductions formulas, 123rd edition (July 2026)", url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul/t4127-jul-payroll-deductions-formulas.html" };

const PROVINCES: Record<string, ProvinceModel> = {
  "CA-ON": {
    label: "Ontario",
    compute(gross, c, tweak) {
      const taxable = taxedShare(gross - c.pensionDeduction, tweak);
      return [
        { label: "Ontario income tax", amount: ontarioTax(taxable, c) },
        { label: "Ontario Health Premium", amount: ontarioHealthPremium(taxable) },
      ];
    },
    sources: [CRA_T4127_JAN],
    caveats: ["Ontario: surtax, tax reduction and Health Premium included; no LIFT credit or Ontario Trillium Benefit."],
  },
  "CA-BC": {
    label: "British Columbia",
    compute(gross, c, tweak) {
      const taxable = taxedShare(gross - c.pensionDeduction, tweak);
      return [{ label: "British Columbia income tax", amount: bcTax(taxable, c) }];
    },
    sources: [CRA_T4127_JUL],
    caveats: ["British Columbia: the 5.60% lowest rate and $690 tax reduction of Budget 2026 are used for the whole year, as the law intends; payroll prorates them from July."],
  },
  "CA-QC": {
    label: "Quebec",
    quebec: true,
    compute(gross, c, tweak) {
      const workerDeduction = Math.min(gross * QC_WORKER_DEDUCTION.rate, QC_WORKER_DEDUCTION.max);
      const taxable = taxedShare(gross - workerDeduction - c.pensionDeduction, tweak);
      return [{ label: "Quebec income tax", amount: quebecTax(taxable) }];
    },
    sources: [
      { label: "Revenu Québec: employers' principal changes for 2026", url: "https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/employers-principal-changes-for-2026/" },
      { label: "Revenu Québec: income tax rates", url: "https://www.revenuquebec.ca/en/citizens/income-tax-return/completing-your-income-tax-return/income-tax-rates/" },
      { label: "Revenu Québec: line 201, deduction for workers", url: "https://www.revenuquebec.ca/en/citizens/income-tax-return/completing-your-income-tax-return/how-to-complete-your-income-tax-return/line-by-line-help/201-to-260-net-income/line-201/" },
    ],
    caveats: [
      "Quebec: federal tax is cut by the 16.5% Quebec abatement; QPP and QPIP replace CPP and part of EI.",
      "Quebec: the only credit is the basic personal amount; no solidarity, work premium or other income-tested credits.",
    ],
  },
};

export const canada: TaxModel = {
  country: "CA",
  year: 2026,
  currency: "CAD",
  scope: "Employee, single, wages only: federal tax with basic, CPP/EI and employment credits, CPP or QPP, EI, QPIP, plus provincial tax for Ontario, British Columbia and Quebec.",
  sources: [
    { label: "CRA: tax rates and income brackets 2026", url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html" },
    { label: "CRA: indexation adjustment for personal income tax amounts", url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html" },
    { label: "CRA: CPP contribution rates, maximums and exemptions", url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html" },
    { label: "CRA: second additional CPP (CPP2) rates and maximums", url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html" },
    { label: "CRA: EI premium rates and maximums", url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html" },
  ],
  caveats: [
    "An RRSP contribution set as your pension share is deducted within this year's room; no union dues, GST/HST credit, Canada Workers Benefit or other refundable credits.",
    "One employer for the whole year: contributions stop at the yearly maximums.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const province = input.region ? PROVINCES[input.region] : undefined;
    const quebec = province?.quebec ?? false;
    const c = contributions(g, quebec);
    const federal = incomeTax(g - c.pensionDeduction, input.tweak, (t) => federalTax(t, g, c, quebec));
    const lines: TaxLine[] = [{ label: quebec ? "Federal income tax, after the Quebec abatement" : "Federal income tax", amount: federal }];
    const extra = [...tweakCaveats(input.tweak)];
    if (province) {
      lines.push(...province.compute(g, c, input.tweak));
      extra.push(...province.caveats);
    } else {
      extra.push(input.region ? "No provincial module for this province yet: provincial income tax is not included." : "No province given: provincial income tax is not included.");
    }
    lines.push(
      { label: quebec ? QPP.label : CPP.label, amount: c.pension },
      { label: "EI premiums", amount: c.ei },
    );
    if (quebec) lines.push({ label: "QPIP premiums", amount: c.qpip });
    const result = finish(this, g, lines, extra, completenessOf(province ? [] : [`provincial income tax (${input.region ?? "no province given"})`]));
    if (province) result.sources = [...result.sources, ...province.sources];
    return result;
  },
};
