import { completenessOf, finish, incomeTax, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// Finland, employee aged 18-64, wages only, 2026.

/** Laki vuoden 2026 tuloveroasteikosta (1140/2025): [from, tax at from, rate above]. */
const STATE_2026: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.1264],
  [22_000, 2_780.8, 0.19],
  [32_600, 4_794.8, 0.3025],
  [40_100, 7_063.55, 0.3325],
  [52_100, 11_053.55, 0.375],
];

export function stateTax(taxable: number): number {
  let row = STATE_2026[0]!;
  for (const r of STATE_2026) if (taxable >= r[0]) row = r;
  return row[1] + (taxable - row[0]) * row[2];
}

const MUNICIPAL: Record<string, { name: string; rate: number }> = {
  "helsinki-fi": { name: "Helsinki", rate: 0.053 },
};
const AVERAGE_MUNICIPAL = { name: "average municipality", rate: 0.076 };

const PENSION = 0.073; // TyEL employee contribution
const UNEMPLOYMENT = 0.0089;
const DAILY_ALLOWANCE = { rate: 0.0088, from: 17_255 }; // sairausvakuutuksen päivärahamaksu
const MEDICAL_CARE = 0.011; // sairaanhoitomaksu, on municipal taxable income
const INCOME_EXPENSES = 750; // tulonhankkimisvähennys
const BASIC_DEDUCTION = { amount: 4_265, taper: 0.18 }; // perusvähennys
const WORK_CREDIT = { rate: 0.18, max: 3_430, from: 35_000, to: 50_550, taper: 0.02 }; // työtulovähennys
const YLE = { rate: 0.025, from: 15_150, max: 160 };

export function basicDeduction(income: number): number {
  if (income <= BASIC_DEDUCTION.amount) return income;
  return Math.max(0, BASIC_DEDUCTION.amount - BASIC_DEDUCTION.taper * (income - BASIC_DEDUCTION.amount));
}

export function workCredit(wages: number, netIncome: number): number {
  const reduction = WORK_CREDIT.taper * Math.min(Math.max(0, netIncome - WORK_CREDIT.from), WORK_CREDIT.to - WORK_CREDIT.from);
  return Math.max(0, Math.min(WORK_CREDIT.max, wages * WORK_CREDIT.rate) - reduction);
}

export const finland: TaxModel = {
  country: "FI",
  year: 2026,
  currency: "EUR",
  scope:
    "Employee aged 18-64, no church membership: state income tax, municipal tax (Helsinki's rate), health insurance contributions, earned income credit, employee pension and unemployment contributions, Yle tax.",
  sources: [
    { label: "Finlex: Laki vuoden 2026 tuloveroasteikosta (1140/2025)", url: "https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute/2025/1140/fin@" },
    { label: "Finlex: Laki tuloverolain muuttamisesta (1141/2025), §§ 106 and 125", url: "https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute/2025/1141/fin@" },
    { label: "Finlex: Valtioneuvoston asetus sairausvakuutusmaksujen maksuprosenteista vuonna 2026 (1026/2025)", url: "https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute/2025/1026/fin@" },
    { label: "Verohallinto: ennakonpidätyksen laskentaperusteet 2026 (pension 7.30%, unemployment 0.89%, deductions)", url: "https://www.vero.fi/syventavat-vero-ohjeet/paatokset/47363/verohallinnon-paatos-ennakonpidatysprosenttien-laskentaperusteista-palkkatuloa-varten-ja-ennakonkannossa-maarattavan-ennakkoveron-laskentaperusteista-vuodelle-2026/" },
    { label: "Verohallinto: kuntien tuloveroprosentit 2026 (Helsinki 5.30%)", url: "https://www.vero.fi/syventavat-vero-ohjeet/paatokset/47465/kuntien-ja-seurakuntien-tuloveroprosentit-vuonna-2026/" },
  ],
  caveats: [
    "The basic deduction is applied to the one earned-income base that the Tax Administration's 2026 rules use for both state and municipal tax.",
    "Church tax (about 1-2% for members) is not included. Cities other than Helsinki use the 2026 average municipal rate (7.60%).",
    "No commuting, union fee or household credits.",
    "Newcomers: key employees can pay a final 25% source tax on pay (fi-key-employee) instead of state, municipal and church tax, the employee's health insurance contributions and the Yle tax; pension and unemployment contributions are still due.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const m = (input.city && MUNICIPAL[input.city]) || AVERAGE_MUNICIPAL;
    const pension = g * PENSION;
    const unemployment = g * UNEMPLOYMENT;
    const net = g - Math.min(INCOME_EXPENSES, g);
    const lines = [
      { label: "Employee pension contribution", amount: pension },
      { label: "Unemployment insurance", amount: unemployment },
    ];
    const completeness = completenessOf([], m === AVERAGE_MUNICIPAL ? ["Municipal tax uses the 2026 average rate (7.60%); this municipality's own rate is not modelled."] : []);
    if (input.tweak?.flatRate !== undefined) {
      // Key employee source tax: no insured person's health insurance contribution on top of it (Vero, avainhenkilöiden
      // verotus, 3.2: https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/106825/avainhenkiloiden-verotus4/), and
      // no Yle tax, which is levied on earned income taxed under the Income Tax Act (Laki yleisradioverosta 484/2012 § 2,
      // https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute/2012/484/fin@).
      lines.push({ label: "Income tax (your flat rate)", amount: incomeTax(g, input.tweak, () => 0) });
      return finish(this, g, lines, tweakCaveats(input.tweak), completeness);
    }
    const daily = g >= DAILY_ALLOWANCE.from ? g * DAILY_ALLOWANCE.rate : 0;
    lines.push({ label: "Health insurance daily allowance contribution", amount: daily });
    const after = Math.max(0, net - pension - unemployment - daily) * (input.tweak?.taxableShare ?? 1) - (input.tweak?.pretaxDeduction ?? 0);
    const taxable = Math.max(0, Math.max(0, after) - basicDeduction(Math.max(0, after)));
    const state = stateTax(taxable);
    const municipal = taxable * m.rate;
    const medical = taxable * MEDICAL_CARE;
    // The credit comes off state tax first, then off municipal tax and the medical care contribution.
    const credit = Math.min(state + municipal + medical, workCredit(g, net));
    lines.push({ label: "State income tax", amount: state });
    lines.push({ label: `Municipal tax (${m.name})`, amount: municipal });
    lines.push({ label: "Health insurance medical care contribution", amount: medical });
    lines.push({ label: "Earned income credit", amount: -credit });
    lines.push({ label: "Yle tax", amount: Math.min(YLE.max, Math.max(0, net - YLE.from) * YLE.rate) });
    return finish(this, g, lines, tweakCaveats(input.tweak), completeness);
  },
};
