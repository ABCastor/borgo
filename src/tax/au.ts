import { finish, incomeTax, progressive, taxedShare, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// Australia, resident employee, income year 1 July 2026 to 30 June 2027.

const RESIDENT_2026_27: Bands = [
  [18_200, 0],
  [45_000, 0.15], // 16% until 30 June 2026
  [135_000, 0.3],
  [190_000, 0.37],
  [Infinity, 0.45],
];

const MEDICARE_LEVY = 0.02;
// Single, no SAPTO: no levy up to the lower threshold, then 10c per dollar above it until the full 2% is reached.
const MEDICARE_LOWER = 28_011; // 2025-26 threshold, the latest published
const MEDICARE_SHADE_IN = 0.1;

/** Low income tax offset: $700, reduced above $37,500 and gone at $66,667. */
function lito(taxable: number): number {
  if (taxable <= 37_500) return 700;
  if (taxable <= 45_000) return 700 - 0.05 * (taxable - 37_500);
  return Math.max(0, 325 - 0.015 * (taxable - 45_000));
}

export function medicareLevy(taxable: number): number {
  if (taxable <= MEDICARE_LOWER) return 0;
  return Math.min(taxable * MEDICARE_LEVY, (taxable - MEDICARE_LOWER) * MEDICARE_SHADE_IN);
}

export const australia: TaxModel = {
  country: "AU",
  year: 2026,
  reviewBy: "2027-07-01",
  currency: "AUD",
  scope: "Resident employee, income year 2026-27: income tax with the tax-free threshold and low income tax offset, plus the 2% Medicare levy.",
  sources: [
    { label: "ATO: tax rates for Australian residents (2026-27)", url: "https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents" },
    { label: "ATO: low income tax offset", url: "https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset" },
    { label: "ATO: what is the Medicare levy", url: "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/what-is-the-medicare-levy" },
    { label: "ATO: Medicare levy reduction for low-income earners", url: "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners" },
  ],
  caveats: [
    "The income year runs 1 July 2026 to 30 June 2027; the gross is that year's salary.",
    "Medicare levy low-income thresholds are the 2025-26 values until the 2026-27 ones are published.",
    "Assumes private hospital cover: without it, the Medicare levy surcharge (1% to 1.5%) applies above the surcharge threshold.",
    "Superannuation guarantee is paid by the employer on top of the salary, so it is not deducted; no work-related deductions or HELP repayments.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const tax = incomeTax(g, input.tweak, (t) => Math.max(0, progressive(t, RESIDENT_2026_27) - lito(t)));
    return finish(
      this,
      g,
      [
        { label: "Income tax, after the low income tax offset", amount: tax },
        { label: "Medicare levy", amount: medicareLevy(taxedShare(g, input.tweak)) },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
