import { finish, incomeTax, progressive, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// United Kingdom, employee, tax year 6 April 2026 to 5 April 2027.

const PERSONAL_ALLOWANCE = 12_570;
const TAPER_START = 100_000; // allowance falls £1 for every £2 above this

// Bands apply to income above the personal allowance.
const RUK: Bands = [
  [37_700, 0.2],
  [125_140, 0.4], // the upper bound is on total income; see compute
  [Infinity, 0.45],
];
const SCOTLAND: Bands = [
  [3_967, 0.19],
  [16_956, 0.2],
  [31_092, 0.21],
  [62_430, 0.42],
  [125_140, 0.45],
  [Infinity, 0.48],
];

const NI_PRIMARY_THRESHOLD = 12_570;
const NI_UPPER_EARNINGS_LIMIT = 50_270;

function allowance(income: number): number {
  return Math.max(0, PERSONAL_ALLOWANCE - Math.max(0, income - TAPER_START) / 2);
}

/**
 * Income tax on total income. Bands count income above the allowance; the last threshold (£125,140)
 * is where the allowance has fully tapered away, so above-allowance and total income coincide there.
 */
function incomeTaxOn(income: number, bands: Bands): number {
  return progressive(Math.max(0, income - allowance(income)), bands);
}

export const unitedKingdom: TaxModel = {
  country: "GB",
  year: 2026,
  currency: "GBP",
  scope: "Employee: income tax (Scottish rates for Scottish cities), employee National Insurance class 1 category A.",
  sources: [
    { label: "GOV.UK: rates and thresholds for employers 2026 to 2027", url: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027" },
    { label: "GOV.UK: income tax rates and personal allowances", url: "https://www.gov.uk/income-tax-rates" },
  ],
  caveats: ["No student loan, pension salary sacrifice, marriage allowance or benefits in kind."],
  compute(input: TaxInput) {
    const g = input.gross;
    const bands = input.region === "GB-SCT" ? SCOTLAND : RUK;
    const tax = incomeTax(g, input.tweak, (t) => incomeTaxOn(t, bands));
    const ni = progressive(g, [
      [NI_PRIMARY_THRESHOLD, 0],
      [NI_UPPER_EARNINGS_LIMIT, 0.08],
      [Infinity, 0.02],
    ]);
    return finish(
      this,
      g,
      [
        { label: input.region === "GB-SCT" ? "Income tax (Scottish rates)" : "Income tax", amount: tax },
        { label: "National Insurance (employee)", amount: ni },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
