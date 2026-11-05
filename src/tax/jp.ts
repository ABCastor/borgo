import { finish, incomeTax, progressive, taxedShare, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// Japan, resident employee under 40 in Tokyo, salary earned in 2026.

export const INCOME_TAX: Bands = [
  [1_950_000, 0.05],
  [3_300_000, 0.1],
  [6_950_000, 0.2],
  [9_000_000, 0.23],
  [18_000_000, 0.33],
  [40_000_000, 0.4],
  [Infinity, 0.45],
];
const RECONSTRUCTION_SURTAX = 0.021; // of income tax, to 2037

/** Employment income deduction for 2026 and 2027 (minimum raised to ¥740,000 by the 2026 reform). */
function employmentIncome(salary: number): number {
  let deduction: number;
  if (salary <= 2_200_000) deduction = 740_000;
  else if (salary <= 3_600_000) deduction = salary * 0.3 + 80_000;
  else if (salary <= 6_600_000) deduction = salary * 0.2 + 440_000;
  else if (salary <= 8_500_000) deduction = salary * 0.1 + 1_100_000;
  else deduction = 1_950_000;
  return Math.max(0, salary - deduction);
}

/** National basic deduction for 2026 and 2027, by total income. */
function basicDeduction(income: number): number {
  if (income <= 4_890_000) return 1_040_000;
  if (income <= 6_550_000) return 670_000;
  if (income <= 23_500_000) return 620_000;
  if (income <= 24_000_000) return 480_000;
  if (income <= 24_500_000) return 320_000;
  if (income <= 25_000_000) return 160_000;
  return 0;
}

/** Resident tax basic deduction (unchanged by the 2025 and 2026 reforms). */
function residentBasicDeduction(income: number): number {
  if (income <= 24_000_000) return 430_000;
  if (income <= 24_500_000) return 290_000;
  if (income <= 25_000_000) return 150_000;
  return 0;
}

const RESIDENT_RATE = 0.1; // 4% metropolitan + 6% special ward
const PER_CAPITA = 1_000 + 3_000 + 1_000; // metropolitan, ward, forest environment tax
const RESIDENT_EXEMPT_UP_TO = 450_000; // total income, single, 23 wards
const PERSONAL_DEDUCTION_GAP = 50_000; // basic deduction, income tax vs resident tax, for the adjustment credit

/** Adjustment credit (調整控除) for a single person with only the basic deduction. */
function adjustmentCredit(taxable: number, income: number): number {
  if (income > 25_000_000) return 0;
  if (taxable <= 2_000_000) return 0.05 * Math.min(PERSONAL_DEDUCTION_GAP, taxable);
  return Math.max(2_500, 0.05 * (PERSONAL_DEDUCTION_GAP - (taxable - 2_000_000)));
}

const floor1000 = (n: number) => Math.floor(Math.max(0, n) / 1_000) * 1_000;

// Employee social insurance, Kyokai Kenpo Tokyo branch, from March 2026 (child support levy from April 2026).
// Standard monthly remuneration grades: [lower bound of monthly pay, standard amount].
const GRADES: readonly (readonly [number, number])[] = [
  [0, 58_000], [63_000, 68_000], [73_000, 78_000], [83_000, 88_000], [93_000, 98_000], [101_000, 104_000],
  [107_000, 110_000], [114_000, 118_000], [122_000, 126_000], [130_000, 134_000], [138_000, 142_000],
  [146_000, 150_000], [155_000, 160_000], [165_000, 170_000], [175_000, 180_000], [185_000, 190_000],
  [195_000, 200_000], [210_000, 220_000], [230_000, 240_000], [250_000, 260_000], [270_000, 280_000],
  [290_000, 300_000], [310_000, 320_000], [330_000, 340_000], [350_000, 360_000], [370_000, 380_000],
  [395_000, 410_000], [425_000, 440_000], [455_000, 470_000], [485_000, 500_000], [515_000, 530_000],
  [545_000, 560_000], [575_000, 590_000], [605_000, 620_000], [635_000, 650_000], [665_000, 680_000],
  [695_000, 710_000], [730_000, 750_000], [770_000, 790_000], [810_000, 830_000], [855_000, 880_000],
  [905_000, 930_000], [955_000, 980_000], [1_005_000, 1_030_000], [1_055_000, 1_090_000],
  [1_115_000, 1_150_000], [1_175_000, 1_210_000], [1_235_000, 1_270_000], [1_295_000, 1_330_000],
  [1_355_000, 1_390_000],
];
const PENSION_FLOOR = 88_000;
const PENSION_CEILING = 650_000;
const HEALTH_EMPLOYEE = 0.0985 / 2;
const CHILD_SUPPORT_EMPLOYEE = 0.0023 / 2;
const PENSION_EMPLOYEE = 0.183 / 2;
const EMPLOYMENT_INSURANCE_EMPLOYEE = 0.005; // general business, April 2026 to March 2027
const ENROLMENT_FROM = 88_000; // monthly pay below which this model assumes no employee insurance

export function standardMonthly(pay: number): number {
  let standard = GRADES[0]![1];
  for (const [from, amount] of GRADES) if (pay >= from) standard = amount;
  return standard;
}

export function socialInsurance(salary: number): { health: number; pension: number; employment: number } {
  const monthly = salary / 12;
  const employment = salary * EMPLOYMENT_INSURANCE_EMPLOYEE;
  if (monthly < ENROLMENT_FROM) return { health: 0, pension: 0, employment };
  const standard = standardMonthly(monthly);
  const pensionable = Math.min(PENSION_CEILING, Math.max(PENSION_FLOOR, standard));
  return {
    health: 12 * standard * (HEALTH_EMPLOYEE + CHILD_SUPPORT_EMPLOYEE),
    pension: 12 * pensionable * PENSION_EMPLOYEE,
    employment,
  };
}

export const japan: TaxModel = {
  country: "JP",
  year: 2026,
  currency: "JPY",
  scope: "Resident employee under 40 in Tokyo's 23 wards, salary for 2026: national income tax and reconstruction surtax, resident tax on that income, and employee social insurance (health, child support levy, pension, employment insurance).",
  sources: [
    { label: "NTA: No.2260 income tax rates", url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm" },
    { label: "NTA: No.1410 employment income deduction (2026 reform)", url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm" },
    { label: "NTA: No.1199 basic deduction (2026 reform)", url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm" },
    { label: "NTA: April 2026 withholding tax changes (basic deduction bands for 2026 and 2027)", url: "https://www.nta.go.jp/publication/pamph/gensen/2026kaisei.pdf" },
    { label: "Tokyo Bureau of Taxation: individual resident tax", url: "https://www.tax.metro.tokyo.lg.jp/kazei/life/kojin_ju" },
    { label: "Chuo City: resident tax basic deduction", url: "https://www.city.chuo.lg.jp/a0009/kurashi/zeikin/juuminzei/shotokukoujo/zintekikozyo.html" },
    { label: "Nerima City: resident tax adjustment credit", url: "https://www.city.nerima.tokyo.jp/kurashi/zei/jyuminzei/zeigakukojo/choseikojo.html" },
    { label: "Kyokai Kenpo: Tokyo premium table from March 2026", url: "https://www.kyoukaikenpo.or.jp/assets/R8_13tokyo.pdf" },
    { label: "MHLW: employment insurance rates for fiscal 2026", url: "https://www.mhlw.go.jp/content/001692566.pdf" },
  ],
  caveats: [
    "Resident tax on 2026 salary is billed from June 2027; it is shown here against the year it is earned on.",
    "Health insurance is Kyokai Kenpo (Tokyo); company health insurance societies often charge less. Under 40: no long-term care premium (an extra 0.81% from age 40 to 64).",
    "Salary is treated as twelve equal months with no bonus; bonuses have their own premium ceilings.",
    "Employment income below ¥6.6 million is computed with the formula, not the statutory table, so it can differ by a few thousand yen.",
    "No spouse, dependants or life insurance deductions (iDeCo set as your pension share is deducted); below ¥88,000 a month the model assumes no employee insurance.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const si = socialInsurance(g);
    const premiums = si.health + si.pension + si.employment;
    const income = employmentIncome(g);
    const afterPremiums = Math.max(0, income - premiums);
    const tax = incomeTax(afterPremiums, input.tweak, (t) => progressive(floor1000(t - basicDeduction(income)), INCOME_TAX));
    const residentBase = taxedShare(afterPremiums, input.tweak);
    const residentTaxable = floor1000(residentBase - residentBasicDeduction(income));
    const resident =
      income <= RESIDENT_EXEMPT_UP_TO
        ? 0
        : Math.max(0, residentTaxable * RESIDENT_RATE - adjustmentCredit(residentTaxable, income)) + PER_CAPITA;
    return finish(
      this,
      g,
      [
        { label: "Income tax", amount: tax },
        { label: "Reconstruction surtax", amount: tax * RECONSTRUCTION_SURTAX },
        { label: "Resident tax (Tokyo)", amount: resident },
        { label: "Health insurance and child support levy", amount: si.health },
        { label: "Employees' pension", amount: si.pension },
        { label: "Employment insurance", amount: si.employment },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
