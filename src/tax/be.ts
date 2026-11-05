import type { TaxTweak } from "../core/types.ts";
import { finish, incomeTax, progressive, round2, tweakCaveats, type Bands, type TaxInput, type TaxLine, type TaxModel } from "./common.ts";

// Belgium, single resident employee (white-collar, declared at 100%), income year 2026 (tax year 2027).
// Social security is withheld month by month; income tax is federal tax, a regional surcharge on the "reduced state tax"
// and a municipal surcharge on both, then the special social security contribution on net taxable income.

/** Income-tax figures for one income year. Tests run the same calculation with income 2025 against Tax-Calc. */
export interface IncomeYear {
  /** Art. 130 CIR 92: bands of the taxable income. */
  scale: Bands;
  /** Art. 131: the tax-free sum for a single person without dependants, taxed at the first band's 25% (art. 134). */
  taxFree: number;
  /** Art. 51: lump-sum work expenses, 30% of pay after contributions, capped. */
  expensesCap: number;
  /** Art. 289ter/1: the fiscal work bonus, a refundable credit, as a share of each part of the social work bonus. */
  workBonusCredit: { a: number; b: number; cap: number };
}

export const INCOME_2026: IncomeYear = {
  scale: [
    [16_720, 0.25],
    [29_510, 0.4],
    [51_070, 0.45],
    [Infinity, 0.5],
  ],
  taxFree: 11_550, // 4,945 × 2.3356 (law of 15 July 2026, art. 2, 1°; indexation notice of 12 August 2026)
  expensesCap: 6_070,
  workBonusCredit: { a: 0.3314, b: 0.63, cap: 2_000 }, // 63% for part B from tax year 2027 (law of 15 July 2026, art. 96-97)
};

const SS_EMPLOYEE = 0.075 + 0.0355 + 0.0115 + 0.0087; // pensions, health care, sickness benefits, unemployment: 13.07%

/** One stretch of 2026 with its social work bonus parameters (employees declared at 100%), monthly amounts. */
interface BonusPeriod {
  months: number;
  /** Part A, low wages: full amount up to `upTo`, then reduced by `slope` per euro until it reaches zero. */
  a: { amount: number; upTo: number; slope: number };
  /** Part B, very low wages. */
  b: { amount: number; upTo: number; slope: number };
}

// ONSS administrative instructions 2026/1, 2026/2 and 2026/3, "Le bonus à l'emploi".
const BONUS_2026: BonusPeriod[] = [
  { months: 2, a: { amount: 123.0, upTo: 2_833.36, slope: 0.2807 }, b: { amount: 165.87, upTo: 2_218.73, slope: 0.2699 } }, // January-February
  { months: 1, a: { amount: 123.0, upTo: 2_833.36, slope: 0.2442 }, b: { amount: 165.87, upTo: 2_218.73, slope: 0.2699 } }, // March
  { months: 3, a: { amount: 125.04, upTo: 2_880.32, slope: 0.2738 }, b: { amount: 168.62, upTo: 2_255.5, slope: 0.2699 } }, // April-June
  { months: 2, a: { amount: 127.54, upTo: 2_937.93, slope: 0.3196 }, b: { amount: 171.99, upTo: 2_300.62, slope: 0.2699 } }, // July-August
  { months: 4, a: { amount: 127.54, upTo: 2_937.93, slope: 0.2739 }, b: { amount: 171.99, upTo: 2_300.62, slope: 0.2699 } }, // September-December
];

function part(s: number, p: { amount: number; upTo: number; slope: number }): number {
  if (s <= p.upTo) return p.amount;
  return round2(Math.max(0, p.amount - p.slope * (s - p.upTo)));
}

/** The social work bonus over the year, split into its two parts, for pay spread evenly over twelve months. */
export function workBonus(gross: number): { a: number; b: number } {
  const s = gross / 12;
  const due = s * SS_EMPLOYEE;
  let a = 0;
  let b = 0;
  for (const p of BONUS_2026) {
    const pa = part(s, p.a);
    // The bonus never exceeds the contributions due; any cut falls on part B first, then part A.
    const pb = Math.min(part(s, p.b), Math.max(0, due - pa));
    a += Math.min(pa, due) * p.months;
    b += pb * p.months;
  }
  return { a, b };
}

export function socialSecurity(gross: number): { contributions: number; bonus: { a: number; b: number } } {
  const bonus = workBonus(gross);
  return { contributions: gross * SS_EMPLOYEE - bonus.a - bonus.b, bonus };
}

/** Taxable income: pay after contributions, less the lump-sum work expenses. */
export function taxableIncome(payAfterContributions: number, y: IncomeYear): number {
  return Math.max(0, payAfterContributions - Math.min(payAfterContributions * 0.3, y.expensesCap));
}

/** State tax: the scale on taxable income, less the same scale on the tax-free sum (never below zero). */
export function stateTax(taxable: number, y: IncomeYear): number {
  return Math.max(0, progressive(taxable, y.scale) - 0.25 * Math.min(taxable, y.taxFree));
}

/** Art. 5/2 special financing law: the regions' share of the state tax (royal decree of 19 December 2017). */
export const AUTONOMY_FACTOR = 0.24957;

/** Brussels' additional centimes on the reduced state tax: [100/(100 − f)] × [99.5 − (100 − f)], rounded up to the thousandth. */
export function brusselsCentimes(f = AUTONOMY_FACTOR * 100): number {
  return Math.ceil((100 / (100 - f)) * (99.5 - (100 - f)) * 1000) / 1000 / 100;
}

const REGIONS: Record<string, { name: string; centimes: number }> = {
  "BE-BRU": { name: "Brussels-Capital", centimes: brusselsCentimes() }, // 32.591%
};
// Flanders and Wallonia are not read: their surcharge is assumed to restore exactly the federal-equivalent tax.
const DEFAULT_REGION = { name: "regional (assumed)", centimes: AUTONOMY_FACTOR / (1 - AUTONOMY_FACTOR) };

const MUNICIPAL: Record<string, number> = {
  "brussels-be": 0.049, // City of Brussels, council decision of 15 December 2025 for tax year 2026
};
const DEFAULT_MUNICIPAL = 0.049;

/** Annual special social security contribution of a person taxed alone, on net taxable income (law of 30 March 1994, art. 108). */
const SPECIAL_SSC: Bands = [
  [18_592.02, 0],
  [21_070.96, 0.05],
  [37_344, 0.013],
  [40_997.26, 0.04009],
  [60_181.95, 0.012996],
  [Infinity, 0],
];

export function specialContribution(taxable: number): number {
  return progressive(taxable, SPECIAL_SSC);
}

/**
 * Everything after social security: income tax with its surcharges, the fiscal work bonus and the special contribution,
 * from pay after contributions (Tax-Calc's code 1250) and the year's social work bonus.
 */
export function incomeTaxes(
  payAfterContributions: number,
  bonus: { a: number; b: number },
  y: IncomeYear,
  where: { region?: string; city?: string },
  tweak?: TaxTweak,
): TaxLine[] {
  const taxable = taxableIncome(payAfterContributions, y);
  const region = (where.region && REGIONS[where.region]) || DEFAULT_REGION;
  const municipalRate = (where.city ? MUNICIPAL[where.city] : undefined) ?? DEFAULT_MUNICIPAL;
  const state = incomeTax(taxable, tweak, (t) => stateTax(t, y));
  const lines: TaxLine[] = [];
  if (tweak?.flatRate !== undefined && tweak.flatRateScope === "all") {
    // The flat rate replaces federal, regional and municipal tax alike.
    lines.push({ label: "Income tax (your flat rate)", amount: state });
  } else {
    // The regional surcharge rests on the reduced state tax, the municipal one on federal and regional tax together.
    const reduced = state * (1 - AUTONOMY_FACTOR);
    const regional = reduced * region.centimes;
    lines.push(
      { label: "Federal income tax", amount: reduced },
      { label: `Regional surcharge (${region.name})`, amount: regional },
      { label: "Municipal surcharge", amount: (reduced + regional) * municipalRate },
    );
  }
  const credit = Math.min(bonus.a * y.workBonusCredit.a + bonus.b * y.workBonusCredit.b, y.workBonusCredit.cap);
  if (credit > 0) lines.push({ label: "Fiscal work bonus (refundable credit)", amount: -credit });
  lines.push({ label: "Special social security contribution", amount: specialContribution(taxable) });
  return lines;
}

export const belgium: TaxModel = {
  country: "BE",
  year: 2026,
  currency: "EUR",
  scope:
    "Single resident employee in Belgium (income 2026): social security with the work bonus, federal income tax with the tax-free sum and lump-sum expenses, Brussels regional and municipal surcharges, fiscal work bonus, special social security contribution.",
  sources: [
    { label: "SPF Finances: tax rates and the tax-free sum, income 2025 and 2026 (worked example)", url: "https://fin.belgium.be/fr/particuliers/declaration-impot/revenus/taux-imposition" },
    { label: "SPF Finances: lump-sum work expenses, 30% up to €6,070 (income 2026)", url: "https://fin.belgium.be/fr/particuliers/declaration-impot/revenus/revenus-professionnels" },
    { label: "Moniteur belge, 29 July 2026: law of 15 July 2026 reforming personal income tax (tax-free sum, fiscal work bonus)", url: "https://www.ejustice.just.fgov.be/cgi/article_body.pl?language=fr&caller=summary&pub_date=2026-07-29&numac=2026005724" },
    { label: "Moniteur belge, 12 August 2026: automatic indexation, tax year 2027 (tables I and VII)", url: "https://www.ejustice.just.fgov.be/cgi/article_body.pl?language=fr&caller=summary&pub_date=2026-08-12&numac=2026006085" },
    { label: "ONSS administrative instructions 2026/3: employee contributions 13.07%", url: "https://www.socialsecurity.be/employer/instructions/dmfa/fr/latest/instructions/socialsecuritycontributions/contributions.html" },
    { label: "ONSS administrative instructions 2026/1-2026/3: the work bonus", url: "https://www.socialsecurity.be/employer/instructions/dmfa/fr/latest/instructions/deductions/workers_reductions/workbonus.html" },
    { label: "Justel: law of 30 March 1994, art. 108 (special social security contribution)", url: "https://www.ejustice.just.fgov.be/cgi_loi/article.pl?language=fr&lg_txt=f&cn_search=1994033031" },
    { label: "Moniteur belge: royal decree of 19 December 2017, autonomy factor 24.957%", url: "https://www.ejustice.just.fgov.be/cgi/article_body.pl?language=fr&caller=summary&pub_date=2017-12-22&numac=2017032216" },
    { label: "Justel: Brussels ordinance of 15 December 2014 on the regional surcharge, art. 2", url: "https://www.ejustice.just.fgov.be/eli/ordonnance/2014/12/15/2015031063/justel" },
    { label: "City of Brussels: municipal surcharge 4.9% (council decision of 15 December 2025)", url: "https://www.bruxelles.be/sites/default/files/bxl/158%20FR%20IPP.pdf" },
    { label: "SPF Finances: Tax-Calc, the official simulator (tax year 2026)", url: "https://finances.belgium.be/fr/E-services/Tax-calc" },
  ],
  caveats: [
    "Income tax and the special contribution are the final annual amounts, not the monthly withholding.",
    "The gross is read as twelve equal monthly salaries. Belgian packages usually add a 13th month and double holiday pay, which are taxed and contributed on slightly differently.",
    "Brussels figures are exact; elsewhere the regional surcharge is assumed to restore exactly the federal-equivalent tax (Flanders and Wallonia not read) and the municipal rate is assumed to be Brussels' 4.9% (municipalities set their own).",
    "The municipal rate is the City of Brussels' rate for tax year 2026; its rate for income 2026 is voted in December 2026.",
    "SPF Finances' rates page still shows a tax-free sum of €11,180 for income 2026; the law of 15 July 2026 raised it to €11,550, which is used here.",
    "No dependants, no tax reductions (pension savings, gifts, home), no meal vouchers, company car or other benefits.",
    "Newcomers: the impatriate regime makes up to 35% on top of salary tax-free; switch it on in Money or set a taxable share.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const ss = socialSecurity(g);
    const lines: TaxLine[] = [
      { label: "Social security (employee, after the work bonus)", amount: ss.contributions },
      ...incomeTaxes(g - ss.contributions, ss.bonus, INCOME_2026, input, input.tweak),
    ];
    return finish(this, g, lines, tweakCaveats(input.tweak));
  },
};
