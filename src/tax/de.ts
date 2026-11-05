import { finish, incomeTax, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// Germany, employee in statutory health insurance, no church membership, assessed for 2026; married couples may
// be assessed together (splitting).

/** § 32a EStG, 2026 tariff, on taxable income rounded down to the euro; the result is rounded down too. */
export function tarif2026(income: number): number {
  const x = Math.floor(income);
  let tax: number;
  if (x <= 12_348) tax = 0;
  else if (x <= 17_799) {
    const y = (x - 12_348) / 10_000;
    tax = (914.51 * y + 1_400) * y;
  } else if (x <= 69_878) {
    const z = (x - 17_799) / 10_000;
    tax = (173.1 * z + 2_397) * z + 1_034.87;
  } else if (x <= 277_825) tax = 0.42 * x - 11_135.63;
  else tax = 0.45 * x - 19_470.38;
  return Math.floor(tax);
}

/** Solidarity surcharge: 5.5%, nothing up to €20,350 of income tax (€40,700 for a joint assessment), phased in at 11.9% of the excess. */
export function soli(incomeTaxDue: number, joint = false): number {
  const free = joint ? 40_700 : 20_350;
  if (incomeTaxDue <= free) return 0;
  return Math.min(incomeTaxDue * 0.055, (incomeTaxDue - free) * 0.119);
}

const HEALTH_CEILING = 69_750; // health and care insurance, 2026
const PENSION_CEILING = 101_400; // pension and unemployment insurance, 2026
const HEALTH = 0.073 + 0.029 / 2; // half the general rate plus half the average additional rate
const CARE = 0.018; // half of 3.6%
const CARE_CHILDLESS = 0.006; // surcharge for the childless from age 23
const CARE_PER_CHILD = 0.0025; // less from the second child under 25 to the fifth
const PENSION = 0.093;
const UNEMPLOYMENT = 0.013;

const WORK_ALLOWANCE = 1_230; // § 9a Arbeitnehmer-Pauschbetrag
const SPECIAL_EXPENSES = 36; // § 10c Sonderausgaben-Pauschbetrag
const OTHER_INSURANCE_CAP = 1_900; // § 10 (4) for employees; basic health and care cover is deductible in full

/**
 * The employee's care insurance rate (§ 55 SGB XI, https://www.gesetze-im-internet.de/sgb_11/__55.html): the childless
 * surcharge from age 23 (§ 55 (3)), or less for each child under 25 from the second (§ 55 (3a)). Parenthood counts for
 * both parents. Without an age, an adult of 23 or more is assumed.
 */
export function careRate(children?: number[], age?: number): number {
  if (!children?.length) return CARE + (age !== undefined && age < 23 ? 0 : CARE_CHILDLESS);
  const young = children.filter((a) => a < 25).length;
  return CARE - CARE_PER_CHILD * Math.max(0, Math.min(young, 5) - 1);
}

export function socialInsurance(gross: number, children?: number[], age?: number) {
  const h = Math.min(gross, HEALTH_CEILING);
  const p = Math.min(gross, PENSION_CEILING);
  return { health: h * HEALTH, care: h * careRate(children, age), pension: p * PENSION, unemployment: p * UNEMPLOYMENT };
}

export function taxableIncome(gross: number, children?: number[], age?: number): number {
  const s = socialInsurance(gross, children, age);
  const basicCover = s.health * 0.96 + s.care; // less 4% where the cover includes sick pay
  const otherInsurance = Math.max(basicCover, Math.min(OTHER_INSURANCE_CAP, basicCover + s.unemployment));
  return Math.max(0, gross - Math.min(gross, WORK_ALLOWANCE) - SPECIAL_EXPENSES - s.pension - otherInsurance);
}

export const germany: TaxModel = {
  country: "DE",
  year: 2026,
  currency: "EUR",
  scope:
    "Employee, statutory health insurance, no church tax: income tax (§ 32a 2026, splitting for a married couple), solidarity surcharge, health, care (by number of children), pension and unemployment insurance, with the standard allowances.",
  sources: [
    { label: "Gesetze im Internet: § 32a EStG (2026 tariff)", url: "https://www.gesetze-im-internet.de/estg/__32a.html" },
    { label: "Gesetze im Internet: § 9a EStG (employee allowance)", url: "https://www.gesetze-im-internet.de/estg/__9a.html" },
    { label: "Gesetze im Internet: § 10 and § 10c EStG (insurance and special expenses)", url: "https://www.gesetze-im-internet.de/estg/__10.html" },
    { label: "Gesetze im Internet: §§ 3-4 SolzG 1995 (exemption threshold and rate)", url: "https://www.gesetze-im-internet.de/solzg_1995/__3.html" },
    { label: "Gesetze im Internet: Sozialversicherungs-Rechengrößenverordnung 2026", url: "https://www.gesetze-im-internet.de/svbezgrv_2026/BJNR1160A0025.html" },
    { label: "Bundesgesundheitsministerium: health insurance contributions 2026 (average additional rate 2.9%)", url: "https://www.bundesgesundheitsministerium.de/beitraege" },
    { label: "Deutsche Rentenversicherung: Werte der Sozialversicherung 2026 (pension 18.6%, care 3.6%/4.2%)", url: "https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html" },
  ],
  caveats: [
    "Health insurance uses the 2026 average additional rate (2.9%); each fund sets its own. Above €77,400 an employee may switch to private insurance instead.",
    "Care insurance includes the 0.6% surcharge for the childless from age 23 (assumed reached when no age is given); a parent pays no surcharge, and 0.25 points less for each child under 25 from the second to the fifth.",
    "Child benefit (Kindergeld) and the child allowance are not counted.",
    "No church tax (8% of income tax in Bavaria, 9% elsewhere, for members).",
    "Annual assessment with standard allowances only; payroll withholding differs during the year.",
    "No special regime for newcomers in Germany; a taxable share or flat rate can still model a treaty or employer arrangement.",
  ],
  joint: {
    kind: "optional",
    base: (input) => taxableIncome(input.gross, input.children, input.age),
    tax: (total) => {
      const est = 2 * tarif2026(total / 2);
      return est + soli(est, true);
    },
    replaces: ["Income tax", "Solidarity surcharge"],
    label: "Income tax and solidarity surcharge, joint (splitting)",
    note: "Married couples may be assessed together: twice the tax on half their combined taxable income (§ 32a (5) EStG), with the joint solidarity threshold.",
  },
  compute(input: TaxInput) {
    const g = input.gross;
    const s = socialInsurance(g, input.children, input.age);
    const est = incomeTax(taxableIncome(g, input.children, input.age), input.tweak, tarif2026);
    return finish(
      this,
      g,
      [
        { label: "Income tax", amount: est },
        { label: "Solidarity surcharge", amount: soli(est) },
        { label: "Health insurance", amount: s.health },
        { label: "Care insurance", amount: s.care },
        { label: "Pension insurance", amount: s.pension },
        { label: "Unemployment insurance", amount: s.unemployment },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
