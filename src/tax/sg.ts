import { finish, incomeTax, progressive, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// Singapore, tax resident employee, income earned in 2026 (Year of Assessment 2027).

export const RESIDENT_FROM_YA2024: Bands = [
  [20_000, 0],
  [30_000, 0.02],
  [40_000, 0.035],
  [80_000, 0.07],
  [120_000, 0.115],
  [160_000, 0.15],
  [200_000, 0.18],
  [240_000, 0.19],
  [280_000, 0.195],
  [320_000, 0.2],
  [500_000, 0.22],
  [1_000_000, 0.23],
  [Infinity, 0.24],
];

const EARNED_INCOME_RELIEF = 1_000; // below age 55

// CPF, Singapore Citizen or PR from the third year, age 55 and below, from 1 January 2026.
const CPF_EMPLOYEE = 0.2;
const CPF_OW_CEILING = 8_000; // per month
const CPF_NO_EMPLOYEE_SHARE = 500; // monthly wages up to here: employer share only
const CPF_PHASE_IN_TO = 750; // between $500 and $750 the employee pays 0.6 x (wage - 500)

/** Employee CPF for a year of equal monthly ordinary wages. */
export function cpfEmployee(gross: number): number {
  const monthly = gross / 12;
  if (monthly <= CPF_NO_EMPLOYEE_SHARE) return 0;
  if (monthly <= CPF_PHASE_IN_TO) return 12 * 0.6 * (monthly - CPF_NO_EMPLOYEE_SHARE);
  return 12 * CPF_EMPLOYEE * Math.min(monthly, CPF_OW_CEILING);
}

export const singapore: TaxModel = {
  country: "SG",
  year: 2026,
  currency: "SGD",
  scope: "Tax resident employee under 55, income earned in 2026 (YA 2027): resident rates, earned income relief, and employee CPF with CPF relief for citizens and PRs.",
  sources: [
    { label: "IRAS: individual income tax rates", url: "https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/individual-income-tax-rates" },
    { label: "IRAS: earned income relief", url: "https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/earned-income-relief" },
    { label: "IRAS: CPF relief for employees (ordinary wage ceiling)", url: "https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/central-provident-fund(cpf)-relief-for-employees" },
    { label: "CPF Board: contribution rates from 1 January 2026", url: "https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay" },
    { label: "IRAS: personal income tax rebate (YA 2024 and 2025 only)", url: "https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/personal-income-tax-rebate" },
  ],
  caveats: [
    "CPF applies to Singapore citizens and permanent residents only: foreigners on an Employment Pass or S Pass pay no CPF and get no CPF relief; switch on the Employment Pass setting to model that.",
    "CPF uses the full rates for citizens and PRs from their third year, age 55 and below; PRs in their first two years pay graduated lower rates.",
    "Salary is treated as twelve equal monthly ordinary wages; bonuses (additional wages) can attract CPF up to the $102,000 annual ceiling.",
    "No personal income tax rebate: none has been announced for YA 2027.",
    "No other reliefs (qualifying child, NSman, SRS, course fees), no donations.",
  ],
  options: [{ field: "noSocialContributions", label: "I hold an Employment Pass or S Pass (no CPF)" }],
  compute(input: TaxInput) {
    const g = input.gross;
    const cpf = input.tweak?.noSocialContributions ? 0 : cpfEmployee(g);
    const reliefs = Math.min(g, EARNED_INCOME_RELIEF) + cpf;
    const tax = incomeTax(g, input.tweak, (t) => progressive(Math.max(0, t - reliefs), RESIDENT_FROM_YA2024));
    return finish(
      this,
      g,
      [
        { label: "Income tax", amount: tax },
        { label: "CPF contributions (employee)", amount: cpf },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
