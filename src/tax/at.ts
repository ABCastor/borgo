import { finish, incomeTax, progressive, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// Austria, salaried employee (Angestellter), 2026. Pay is assumed to arrive as the usual 14 equal instalments:
// 12 regular months taxed on the § 33 tariff, plus the 13th and 14th salaries taxed at the fixed § 67 rates.

const TARIF_2026: Bands = [
  [13_539, 0],
  [21_992, 0.2],
  [36_458, 0.3],
  [70_365, 0.4],
  [104_859, 0.48],
  [1_000_000, 0.5],
  [Infinity, 0.55],
];
// § 67 (1): 13th and 14th salaries, after their own contributions. Above €83,333 the excess is taxed like regular
// pay on the § 33 tariff (§ 67 (2) and (10); https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004570&Paragraf=67).
const SPECIAL_RATES: Bands = [
  [620, 0],
  [25_000, 0.06],
  [50_000, 0.27],
  [83_333, 0.3575],
];
const SPECIAL_FIXED_UP_TO = 83_333;
const SPECIAL_EXEMPT_SIXTH = 2_615; // no fixed-rate tax when the annual sixth is this or less

const WORK_EXPENSES = 132; // § 16 (3) Werbungskostenpauschale
const TRAFFIC_CREDIT = 496; // § 33 (5) Z 1 Verkehrsabsetzbetrag
// § 33 (5) Z 3: a supplement for low incomes, phased out between these incomes.
const SUPPLEMENT = { amount: 804, from: 19_761, to: 30_259 };

// Employee social insurance: health 3.87%, pension 10.25%, unemployment 2.95% (less for low pay) on all pay;
// chamber and housing levies on regular pay only, 1.25% in Vienna (its housing levy rose in 2026), 1% elsewhere.
const HEALTH_PENSION = 0.0387 + 0.1025;
const MONTHLY_CEILING = 6_930;
const SPECIAL_CEILING = 2 * MONTHLY_CEILING;
const LEVIES: Record<string, number> = { "vienna-at": 0.0125 };
const DEFAULT_LEVIES = 0.01;

/** Unemployment insurance employee rate by monthly pay (AlVG § 2a, 2026 thresholds). */
export function unemploymentRate(monthly: number): number {
  if (monthly <= 2_225) return 0;
  if (monthly <= 2_427) return 0.01;
  if (monthly <= 2_630) return 0.02;
  return 0.0295;
}

export function split(gross: number, city?: string) {
  const monthly = gross / 14;
  const levies = (city ? LEVIES[city] : undefined) ?? DEFAULT_LEVIES;
  const base = HEALTH_PENSION + unemploymentRate(monthly);
  const regularSv = 12 * Math.min(monthly, MONTHLY_CEILING) * (base + levies);
  const specialSv = Math.min(2 * monthly, SPECIAL_CEILING) * base;
  return { monthly, regular: 12 * monthly, special: 2 * monthly, regularSv, specialSv };
}

function supplement(income: number): number {
  if (income <= SUPPLEMENT.from) return SUPPLEMENT.amount;
  if (income >= SUPPLEMENT.to) return 0;
  return (SUPPLEMENT.amount * (SUPPLEMENT.to - income)) / (SUPPLEMENT.to - SUPPLEMENT.from);
}

/**
 * Tax on regular pay: the tariff less the traffic credit and its low-income supplement. Below zero, part of the
 * contributions comes back (SV-Rückerstattung: 55% of them, up to the credits).
 */
export function regularTax(income: number, contributions: number): number {
  const credits = TRAFFIC_CREDIT + supplement(income);
  const tax = progressive(income, TARIF_2026) - credits;
  if (tax >= 0) return tax;
  return -Math.min(0.55 * contributions, credits, -tax);
}

/** The fixed-rate tax on the 13th and 14th salaries, up to €83,333 of them after contributions. */
export function specialTax(special: number, specialSv: number): number {
  if (special <= SPECIAL_EXEMPT_SIXTH) return 0;
  return progressive(Math.min(special - specialSv, SPECIAL_FIXED_UP_TO), SPECIAL_RATES);
}

/** The part of the 13th and 14th salaries, after contributions, that is taxed on the tariff with regular pay. */
export function specialExcess(special: number, specialSv: number): number {
  return Math.max(0, special - specialSv - SPECIAL_FIXED_UP_TO);
}

export const austria: TaxModel = {
  country: "AT",
  year: 2026,
  currency: "EUR",
  scope:
    "Salaried employee paid in 14 instalments: income tax on regular pay with the traffic credit, fixed-rate tax on the 13th and 14th salaries, social insurance and chamber and housing levies.",
  sources: [
    { label: "RIS: § 33 EStG 1988 (2026 tariff and credits)", url: "https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004570&Paragraf=33" },
    { label: "RIS: § 67 EStG 1988 (13th and 14th salaries)", url: "https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004570&Paragraf=67" },
    { label: "RIS: § 16 EStG 1988 (work expenses allowance)", url: "https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004570&Paragraf=16" },
    { label: "RIS: § 51 ASVG (health and pension contribution rates)", url: "https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10008147&Paragraf=51" },
    { label: "BMF Brutto-Netto-Rechner 2026 (unemployment thresholds, Vienna levies)", url: "https://www.bmf.gv.at/services/berechnungsprogramme.html" },
    { label: "ÖGK: social insurance values 2026 (€6,930 monthly and €13,860 special-pay ceiling)", url: "https://www.gesundheitskasse.at/cdscontent/load?contentid=10008.784766&version=1703772249" },
  ],
  caveats: [
    "Assumes 14 equal instalments (the norm under collective agreements); enter the full annual gross including the 13th and 14th salaries.",
    "Social insurance is capped at €6,930 per regular month and €13,860 for yearly special payments. Unemployment contributions have reduced rates at low pay; Vienna's chamber and housing levies total 1.25%.",
    "Wage-earner (Arbeiter) contributions, commuter allowances, Familienbonus and church contributions are not modelled.",
    "Newcomers: the Zuzugsbegünstigung (§ 103 EStG) can exempt 30% of pay for five years for incoming researchers and experts; set a taxable share of 0.7.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const s = split(g, input.city);
    const regularBase = Math.max(0, s.regular - s.regularSv - WORK_EXPENSES);
    const lines = [{ label: "Social insurance (employee)", amount: s.regularSv + s.specialSv }];
    if (input.tweak?.flatRate !== undefined) {
      const tax = incomeTax(regularBase + s.special - s.specialSv, input.tweak, () => 0);
      lines.push({ label: "Income tax (your flat rate)", amount: tax });
    } else {
      const share = input.tweak?.taxableShare ?? 1;
      const excess = specialExcess(s.special * share, s.specialSv * share);
      lines.push({ label: "Income tax on regular pay", amount: regularTax(regularBase * share + excess, s.regularSv) });
      lines.push({ label: "Tax on 13th and 14th salaries", amount: specialTax(s.special * share, s.specialSv * share) });
    }
    return finish(this, g, lines, tweakCaveats(input.tweak));
  },
};
