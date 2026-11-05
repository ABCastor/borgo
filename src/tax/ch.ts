import { completenessOf, finish, incomeTax, progressive, taxedBase, tweakCaveats, type Bands, type TaxInput, type TaxLine, type TaxModel } from "./common.ts";

// Switzerland, single employee without children or church membership, tax year 2026: federal direct tax, cantonal
// and communal income tax for Zurich and Geneva, AHV/IV/EO and unemployment contributions.

/** A tariff row: from this income, tax at that income, and the rate on each franc above it. */
type Row = readonly [from: number, taxAtFrom: number, rate: number];

function fromRows(income: number, rows: readonly Row[]): number {
  let row = rows[0]!;
  for (const r of rows) if (income >= r[0]) row = r;
  return row[1] + (income - row[0]) * row[2];
}

// Federal direct tax 2026, single persons (art. 36 DBG, indexed), as exported by the ESTV.
const FEDERAL: readonly Row[] = [
  [0, 0, 0],
  [15_200, 0, 0.0077],
  [33_200, 138.6, 0.0088],
  [43_500, 229.2, 0.0264],
  [58_000, 612, 0.0297],
  [76_200, 1_152.5, 0.0594],
  [82_100, 1_502.95, 0.066],
  [108_900, 3_271.75, 0.088],
  [141_500, 6_140.55, 0.11],
  [185_100, 10_936.55, 0.132],
];
const FEDERAL_FLAT_FROM = 794_000; // from here 11.5% of the whole income

export function federalTax(taxable: number): number {
  const x = Math.floor(taxable / 100) * 100;
  return x >= FEDERAL_FLAT_FROM ? x * 0.115 : fromRows(x, FEDERAL);
}

interface Canton {
  name: string;
  /** Simple (base) tax on cantonal taxable income. */
  simple(taxable: number): number;
  /** Cantonal tax from the simple tax. */
  canton(simple: number): number;
  /** Communal multiplier by city id, applied to the simple tax. */
  cities: Record<string, { name: string; multiplier: number }>;
  workExpenses: { rate: number; min: number; max: number };
  /** Insurance premiums the canton lets every employee deduct (see caveats). */
  insurance: number;
  personalTax: number;
}

// Zurich, single tariff (§ 35 StG ZH) in bracket widths, 2026.
const ZURICH_BANDS: Bands = (() => {
  const widths = [7_000, 5_000, 4_800, 8_000, 9_700, 11_200, 13_100, 17_600, 34_000, 33_700, 53_300, 69_300];
  const rates = [0, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12];
  let upper = 0;
  const bands: [number, number][] = widths.map((w, i) => [(upper += w), rates[i]!]);
  bands.push([Infinity, 0.13]);
  return bands;
})();

// Geneva, base tax (art. 41 LIPP), 2026 indexed scale.
const GENEVA: readonly Row[] = [
  [0, 0, 0],
  [18_700, 0, 0.073],
  [22_530, 279.6, 0.082],
  [24_784, 464.4, 0.091],
  [27_036, 669.35, 0.1],
  [29_290, 894.75, 0.109],
  [34_922, 1_508.65, 0.113],
  [39_428, 2_017.8, 0.123],
  [43_935, 2_572.2, 0.128],
  [48_441, 3_148.95, 0.132],
  [77_730, 7_015.1, 0.142],
  [127_297, 14_053.6, 0.15],
  [171_231, 20_643.7, 0.156],
  [193_762, 24_158.55, 0.158],
  [277_125, 37_329.9, 0.16],
  [295_150, 40_213.9, 0.168],
  [415_688, 60_464.3, 0.176],
  [651_131, 101_902.25, 0.18],
];

const CANTONS: Record<string, Canton> = {
  "CH-ZH": {
    name: "Zurich",
    simple: (t) => progressive(Math.floor(t / 100) * 100, ZURICH_BANDS),
    canton: (s) => s * 0.95,
    cities: { "zurich-ch": { name: "Zurich", multiplier: 1.19 } },
    workExpenses: { rate: 0.03, min: 2_000, max: 4_000 },
    insurance: 2_900, // single person in an occupational pension plan
    personalTax: 24,
  },
  "CH-GE": {
    name: "Geneva",
    simple: (t) => fromRows(t, GENEVA),
    // Base tax less 12%, times 147.5% (base plus 47.5 cantonal centimes), plus 1 centime on the full base
    canton: (s) => s * 0.88 * 1.475 + s * 0.01,
    cities: { "geneva-ch": { name: "Geneva", multiplier: 0.4549 } },
    workExpenses: { rate: 0.03, min: 641, max: 1_817 },
    insurance: 4_560, // health premiums are deductible as paid; see caveats
    personalTax: 25,
  },
};

const FEDERAL_WORK_EXPENSES = { rate: 0.03, min: 2_000, max: 4_000 };
const FEDERAL_INSURANCE = 1_800; // single person in an occupational pension plan

const AHV_IV_EO = 0.053;
const UNEMPLOYMENT = 0.011;
const UNEMPLOYMENT_CEILING = 148_200;

const clampExpenses = (net: number, e: { rate: number; min: number; max: number }) => Math.min(Math.max(net * e.rate, e.min), e.max);

export function contributions(gross: number): number {
  return gross * AHV_IV_EO + Math.min(gross, UNEMPLOYMENT_CEILING) * UNEMPLOYMENT;
}

/**
 * Occupational pension (BVG) at the statutory minimum, 2026: BVV 2 art. 5 (in force since 1 January 2025, unchanged for
 * 2026; the BSV's 2026 pillar 3a maximum of CHF 7,258 is 8% of the same CHF 90,720 upper limit). Pay above the entry
 * threshold is insured from the coordination deduction to the upper limit, at least the minimum coordinated salary.
 */
export const BVG = { entry: 22_680, coordination: 26_460, upper: 90_720, minCoordinated: 3_780 };
/** BVG art. 16 age credits, a share of the coordinated salary, by age band (25-34, 35-44, 45-54, 55 to 65). */
const BVG_CREDITS: readonly [from: number, rate: number][] = [[25, 0.07], [35, 0.1], [45, 0.15], [55, 0.18]];
/** The age band assumed when no age is given: 35 to 44. */
const BVG_DEFAULT_AGE = 40;
/** Employee non-occupational accident (NBU) premium: an assumed 1% of pay up to the UVG maximum insured earnings. */
export const NBU = { rate: 0.01, ceiling: 148_200 };

/** The coordinated salary BVG insures at the minimum: zero at or below the entry threshold. */
export function coordinatedSalary(gross: number): number {
  if (gross <= BVG.entry) return 0;
  return Math.max(BVG.minCoordinated, Math.min(gross, BVG.upper) - BVG.coordination);
}

/** The employee's half of the statutory age credit (BVG art. 16 and art. 66: the employer pays at least half). */
export function bvgEmployee(gross: number, age: number | undefined): number {
  const a = age ?? BVG_DEFAULT_AGE;
  if (a < 25 || a >= 65) return 0;
  const rate = BVG_CREDITS.reduce((r, [from, x]) => (a >= from ? x : r), 0);
  return (coordinatedSalary(gross) * rate) / 2;
}

export function nbuPremium(gross: number): number {
  return Math.min(gross, NBU.ceiling) * NBU.rate;
}

/** Taxable incomes from gross; `payroll` is the other employee deductions from pay (BVG, NBU), which come off wages too. */
export function taxableIncomes(gross: number, canton?: Canton, payroll = 0) {
  const net = gross - contributions(gross) - payroll;
  const federal = Math.max(0, net - clampExpenses(net, FEDERAL_WORK_EXPENSES) - FEDERAL_INSURANCE);
  const cantonal = canton ? Math.max(0, net - clampExpenses(net, canton.workExpenses) - canton.insurance) : 0;
  return { net, federal, cantonal };
}

export function cantonalTaxes(cantonId: string, cityId: string | undefined, taxable: number) {
  const c = CANTONS[cantonId]!;
  const simple = c.simple(taxable);
  const own = cityId ? c.cities[cityId] : undefined;
  const city = own ?? Object.values(c.cities)[0]!;
  return { canton: c.canton(simple), city: simple * city.multiplier, personal: c.personalTax, cityName: city.name, cantonName: c.name, ownMunicipality: !!own };
}

export const switzerland: TaxModel = {
  country: "CH",
  year: 2026,
  currency: "CHF",
  scope:
    "Single employee, no children, no church tax: federal direct tax, cantonal and communal income tax for Zurich and Geneva, personal tax, AHV/IV/EO and unemployment contributions, occupational pension (BVG) at the statutory minimum and an assumed accident (NBU) premium.",
  sources: [
    { label: "ESTV tax calculator 2026: tariffs, multipliers and deductions export (federal, Zurich, Geneva)", url: "https://swisstaxcalculator.estv.admin.ch/#/taxdata/tax-scales" },
    { label: "Geneva: LIPP art. 41 (income tax scale) and art. 67 (indexation)", url: "https://silgeneve.ch/legis/data/rsg_d3_08.htm" },
    { label: "AHV/IV: Merkblatt 2.01, contributions on wages (2026)", url: "https://www.ahv-iv.ch/p/2.01.d" },
    { label: "AHV/IV: Merkblatt 2.08, unemployment insurance contributions", url: "https://www.ahv-iv.ch/p/2.08.d" },
  ],
  caveats: [
    "Occupational pension (BVG) is the statutory minimum: the employee's half of the age credit (7%, 10%, 15% or 18% of the coordinated salary between CHF 26,460 and CHF 90,720, by age; 10% without an age). Real plans often insure more and add risk premiums, so the employee share is usually higher; it lowers take-home pay and taxable income alike.",
    "Non-occupational accident insurance (NBU) is an assumed 1% of pay up to CHF 148,200; the employer's insurer sets the real rate, often between 0.4% and 1.5%.",
    "Geneva lets you deduct health insurance premiums as paid; we assume CHF 4,560 a year (the ESTV calculator's default). Mandatory health insurance itself is a cost of living, not a tax, and is not in these lines.",
    "Geneva's cantonal tax reproduces the ESTV calculator: the base tax less 12%, times 147.5%, plus one centime on the full base. Communal tax applies the city's centimes to the base tax.",
    "Cantons other than Zurich and Geneva: only the federal tax and contributions are included, so the figure is partial (cantonal and communal tax, most of the income tax, are left out). Pillar 3a contributions set as your pension share are deducted.",
    "Foreign nationals without a C permit usually pay tax at source (Quellensteuer) by monthly tables, reconciled to these rates above CHF 120,000; the Expatriates Ordinance allows extra deductions, which a taxable share below 1 can approximate.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const canton = input.region ? CANTONS[input.region] : undefined;
    const bvg = bvgEmployee(g, input.age);
    const nbu = nbuPremium(g);
    const t = taxableIncomes(g, canton, bvg + nbu);
    const lines: TaxLine[] = [
      { label: "AHV/IV/EO contributions", amount: g * AHV_IV_EO },
      { label: "Unemployment insurance", amount: Math.min(g, UNEMPLOYMENT_CEILING) * UNEMPLOYMENT },
      { label: "Occupational pension (BVG), statutory minimum", amount: bvg },
      { label: "Non-occupational accident insurance (NBU), assumed 1%", amount: nbu },
    ];
    // Both are stand-ins for the employer's own plan and insurer, so the figure is approximate, never complete.
    const approximations: string[] = [
      `Occupational pension (BVG) is the statutory minimum${input.age === undefined ? " for an age of 35 to 44 (no age given)" : ""}; your employer's plan may take more.`,
      "Non-occupational accident insurance (NBU) is an assumed 1% of pay; your employer's insurer sets the real rate.",
    ];
    const extra: string[] = [];
    if (input.tweak?.flatRate !== undefined) {
      lines.push({ label: "Income tax (your flat rate)", amount: incomeTax(t.federal, input.tweak, () => 0) });
      return finish(this, g, lines, tweakCaveats(input.tweak), completenessOf([], [...approximations, "A flat rate stands in for every Swiss income tax."]));
    }
    lines.push({ label: "Federal direct tax", amount: incomeTax(t.federal, input.tweak, federalTax) });
    const omitted: string[] = [];
    if (canton && input.region) {
      const c = cantonalTaxes(input.region, input.city, taxedBase(t.cantonal, input.tweak));
      lines.push({ label: `Cantonal income tax (${c.cantonName})`, amount: c.canton });
      lines.push({ label: `Communal income tax (${c.cityName})`, amount: c.city });
      lines.push({ label: "Personal tax", amount: c.personal });
      if (!c.ownMunicipality) approximations.push(`Communal tax uses ${c.cityName}'s multiplier; ${input.city ? `the multiplier of ${input.city}` : "this municipality's own"} is not modelled.`);
    } else {
      extra.push("Cantonal and communal income tax are not included for this location.");
      omitted.push(`cantonal and communal income tax (${input.region ?? "no canton given"})`);
    }
    return finish(this, g, lines, [...extra, ...tweakCaveats(input.tweak)], completenessOf(omitted, approximations));
  },
};
