import { finish, incomeTax, progressive, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// Poland, employee with one employment contract, 2026. Under 26 the youth relief applies.

const SCALE_THRESHOLD = 120_000;
const TAX_REDUCING_AMOUNT = 3_600; // makes the first 30,000 tax-free
const WORK_COSTS = 3_000; // koszty uzyskania przychodów: 250 a month, one employer, art. 22 ust. 2
const SOLIDARITY_FROM = 1_000_000; // art. 30h danina solidarnościowa, 4%
const YOUTH_EXEMPT = 85_528; // art. 21 ust. 1 pkt 148: pay of employees under 26, a year

const PENSION_DISABILITY = 0.0976 + 0.015; // employee halves of 19.52% pension and 1.5% of 8% disability
const PENSION_CEILING = 282_600; // 2026 annual limit for pension and disability contributions
const SICKNESS = 0.0245; // paid by the employee, no ceiling
const HEALTH = 0.09; // on pay less the employee's social contributions; not deductible from tax

/** Pay less contributions and work costs; under 26 only the pay above the youth relief counts, with its share of both. */
export function taxBase(gross: number, age?: number): number {
  const exempt = age !== undefined && age < 26 ? Math.min(gross, YOUTH_EXEMPT) : 0;
  const taxed = gross - exempt;
  if (taxed <= 0) return 0;
  return Math.max(0, taxed - zus(gross) * (taxed / gross) - WORK_COSTS);
}

export function zus(gross: number): number {
  return Math.min(gross, PENSION_CEILING) * PENSION_DISABILITY + gross * SICKNESS;
}

/** The tax scale: 12% less the tax-reducing amount, then 32% above 120,000; plus 4% on income above 1 million. */
export function scale(base: number): number {
  const tax = Math.max(0, progressive(base, [[SCALE_THRESHOLD, 0.12], [Infinity, 0.32]]) - TAX_REDUCING_AMOUNT);
  return tax + Math.max(0, base - SOLIDARITY_FROM) * 0.04;
}

export const poland: TaxModel = {
  country: "PL",
  year: 2026,
  currency: "PLN",
  scope: "Employee, one employer, tax scale: PIT with the tax-free amount and standard work costs (and the youth relief under 26), social insurance (ZUS) and health insurance; joint filing for married couples.",
  sources: [
    { label: "podatki.gov.pl: PIT tax scale (stawki i limity)", url: "https://www.podatki.gov.pl/podatki-osobiste/pit/stawki-i-limity" },
    { label: "Dz.U. 2026 poz. 592: PIT act, consolidated (art. 22 ust. 2 work costs, art. 30h solidarity levy)", url: "https://api.sejm.gov.pl/eli/acts/DU/2026/592/text.pdf" },
    { label: "Dz.U. 2026 poz. 199: social insurance system act (arts. 16 and 22, rates and split)", url: "https://api.sejm.gov.pl/eli/acts/DU/2026/199/text.pdf" },
    { label: "ZUS: annual limit of the pension and disability base, 2026", url: "https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/wskazniki/roczna-podstawa-wymiaru-skladek-na-ubezpieczenia-emerytalne-i-rentowe-od-1999-r" },
    { label: "Dz.U. 2025 poz. 1461: health care benefits act (art. 79, 9% health contribution; art. 81 base)", url: "https://api.sejm.gov.pl/eli/acts/DU/2025/1461/text.pdf" },
  ],
  caveats: [
    "Employees under 26 pay no PIT on pay up to 85,528 PLN (the youth relief): applied when your age is under 26, with contributions and work costs counted against the taxed part only. Without an age, 26 or over is assumed.",
    "PPK workplace pension (2% employee by default, opt-out possible) is not deducted.",
    "No municipal income tax in Warsaw or Kraków.",
    "Newcomers: the return relief (ulga na powrót) exempts up to 85,528 PLN a year for four years for qualifying new residents; set a taxable share to approximate it.",
  ],
  joint: {
    kind: "optional",
    base: (input) => taxBase(input.gross, input.age),
    tax: (total) => 2 * scale(total / 2),
    replaces: ["Income tax (PIT)"],
    label: "Income tax (PIT), joint return",
    note: "Married couples may file together: the tax is twice the tax on half their combined income (art. 6 ust. 2), here with the solidarity levy on the halves too.",
  },
  compute(input: TaxInput) {
    const g = input.gross;
    const social = zus(g);
    const base = taxBase(g, input.age);
    const flat = input.tweak?.flatRate !== undefined;
    return finish(
      this,
      g,
      [
        { label: "Social insurance (ZUS, employee)", amount: social },
        { label: "Health insurance", amount: (g - social) * HEALTH },
        { label: flat ? "Income tax (your flat rate)" : "Income tax (PIT)", amount: incomeTax(base, input.tweak, scale) },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
