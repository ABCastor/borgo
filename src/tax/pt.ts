import { completenessOf, finish, incomeTax, progressive, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// Portugal (mainland), single employee resident for tax, 2026 (category A income only).

// CIRS art. 68 as amended by Decreto-Lei 212/2026 of 4 November, which lowers the first six rates for 2026 income
// (https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs68.aspx).
const IRS_2026: Bands = [
  [8_342, 0.122],
  [12_587, 0.152],
  [17_838, 0.207],
  [23_089, 0.236],
  [29_397, 0.306],
  [43_090, 0.346],
  [46_566, 0.431],
  [86_634, 0.446],
  [Infinity, 0.48],
];
// Art. 68-A: additional solidarity rate on taxable income above €80,000.
const SOLIDARITY: Bands = [
  [80_000, 0],
  [250_000, 0.025],
  [Infinity, 0.05],
];

const IAS_2026 = 537.13; // indexante dos apoios sociais; see caveats
const SPECIFIC_DEDUCTION = 8.54 * IAS_2026; // art. 25: or the contributions actually paid, if higher
const SOCIAL_SECURITY = 0.11; // employee rate, general scheme
/** The autonomous regions, which set their own lower IRS rates. */
const ISLANDS: Record<string, string> = { "PT-20": "the Azores", "PT-30": "Madeira" };

// Art. 70: minimum-subsistence allowance, taken off taxable income for low earners.
const REFERENCE = 12_880;
const GENERAL_EXPENSES_LIMIT = 250; // art. 78-B, the general family expenses credit
const FIRST_RATE = IRS_2026[0]![1];
const FIRST_LIMIT = IRS_2026[0]![0];
const L = REFERENCE - GENERAL_EXPENSES_LIMIT / FIRST_RATE / 3.6 + FIRST_LIMIT / 3.6;
const SUBSISTENCE_CEILING = 2.2 * 14 * IAS_2026; // art. 70(4)(a): per taxpayer on the return

/**
 * Art. 70: the allowance one holder's income gets. `household` is the return the person files: on a joint return the
 * ceiling reads the couple's combined gross against the ceiling times the number of taxpayers (art. 70(4)(a)).
 */
export function subsistenceAllowance(gross: number, specific: number, household?: { gross: number; filers: number }): number {
  const total = household ?? { gross, filers: 1 };
  if (total.gross > SUBSISTENCE_CEILING * total.filers) return 0;
  const expenses = GENERAL_EXPENSES_LIMIT / FIRST_RATE;
  let a: number;
  if (gross <= REFERENCE) a = REFERENCE - (specific + expenses);
  else if (gross <= L) a = REFERENCE - 2.6 * (gross - REFERENCE) - (specific + expenses);
  else a = L - FIRST_LIMIT - 1.35 * (gross - L) - specific;
  return Math.min(Math.max(0, a), Math.max(0, gross - specific));
}

export function taxableIncome(gross: number, household?: { gross: number; filers: number }): number {
  const specific = Math.min(gross, Math.max(SPECIFIC_DEDUCTION, gross * SOCIAL_SECURITY));
  return Math.max(0, gross - specific - subsistenceAllowance(gross, specific, household));
}

export const portugal: TaxModel = {
  country: "PT",
  year: 2026,
  currency: "EUR",
  scope:
    "Single employee resident in mainland Portugal: IRS with the 2026 brackets, specific deduction, minimum-subsistence allowance, solidarity surcharge, general expenses credit, social security.",
  sources: [
    { label: "Portal das Finanças: CIRS art. 68 (2026 rates, Decreto-Lei 212/2026)", url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs68.aspx" },
    { label: "Portal das Finanças: CIRS art. 68-A (solidarity rate)", url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs68a.aspx" },
    { label: "Portal das Finanças: CIRS art. 25 (specific deduction for employment income)", url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs25.aspx" },
    { label: "Portal das Finanças: CIRS art. 70 (mínimo de existência)", url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs70.aspx" },
    { label: "Portal das Finanças: CIRS art. 78-B (general family expenses)", url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs78b.aspx" },
    { label: "Portal das Finanças: CIRS art. 12-B (IRS Jovem)", url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs12b.aspx" },
    { label: "EURES: Portugal working conditions (employee social insurance 11%)", url: "https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-portugal_en" },
  ],
  caveats: [
    "Employee social insurance uses the general 11% rate. The 2026 IAS of €537.13, which sets the specific deduction (8.54 × IAS) and minimum-subsistence ceiling, is not independently verified here.",
    "Assumes the €250 general family expenses credit is fully used (35% of invoiced spending of about €715 a year with your tax number).",
    "Municipal IRS participation (some councils, Lisbon and Porto among those to check, return part of their 5% share) is not applied.",
    "No health, education or housing credits; no dependants; mainland rates (Azores and Madeira set lower ones). A PPR contribution, set as your pension share, gets its IRS credit.",
    "IRS Jovem (art. 12-B, under 35, first ten years of work) exempts 100% down to 25% of earned income up to 55 × IAS; set a taxable share to model it (e.g. 0.25 in years 2-4 if under the cap).",
    "Newcomers: the IFICI regime (EBF art. 58-A, successor to NHR) taxes qualifying employment income at a flat 20%; set a flat rate of 0.20.",
  ],
  joint: {
    kind: "optional",
    base: (input) => taxableIncome(input.gross, input.household),
    tax: (total) => Math.max(0, 2 * (progressive(total / 2, IRS_2026) + progressive(total / 2, SOLIDARITY)) - 2 * GENERAL_EXPENSES_LIMIT),
    replaces: ["IRS income tax, after the general expenses credit"],
    label: "IRS income tax, joint return",
    note: "Married couples may file together: the rates apply to half the combined taxable income (quociente conjugal), then twice that tax, less both general expenses credits.",
  },
  compute(input: TaxInput) {
    const g = input.gross;
    const ss = g * SOCIAL_SECURITY;
    const base = taxableIncome(g);
    const flat = input.tweak?.flatRate !== undefined;
    const irs = incomeTax(base, input.tweak, (t) => progressive(t, IRS_2026) + progressive(t, SOLIDARITY));
    const credit = flat ? 0 : Math.min(GENERAL_EXPENSES_LIMIT, irs);
    const islands = input.region && ISLANDS[input.region];
    return finish(
      this,
      g,
      [
        { label: "Social security (employee)", amount: ss },
        { label: flat ? "IRS income tax (your flat rate)" : "IRS income tax, after the general expenses credit", amount: irs - credit },
      ],
      tweakCaveats(input.tweak),
      completenessOf([], islands ? [`Mainland IRS rates; ${islands} sets its own lower rates, so tax here is overstated.`] : []),
    );
  },
};
