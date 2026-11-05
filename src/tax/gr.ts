import { finish, incomeTax, progressive, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// Greece, single resident private-sector employee over 30 without children, 2026. No regional or municipal income tax.

// Art. 15 par. 1 ΚΦΕ as replaced by law 5246/2025 art. 3, from income 2026.
const SCALE: Bands = [
  [10_000, 0.09],
  [20_000, 0.2],
  [30_000, 0.26],
  [40_000, 0.34],
  [60_000, 0.39],
  [Infinity, 0.44],
];

// Art. 16 ΚΦΕ (law 4646/2019 art. 9): €777 off the tax without dependent children, less €20 per €1,000 of taxable pay above €12,000.
const REDUCTION = { amount: 777, from: 12_000, perEuro: 20 / 1_000 };

// EFKA package ΚΠΚ 101 (main pension, health, unemployment, auxiliary pension), employee share from 1 January 2025.
const EFKA_EMPLOYEE = 0.1337;
const CEILING_MONTH = 7_761.94; // insurable earnings ceiling from 1 January 2026
const PAYMENTS = 14; // twelve salaries, the Christmas bonus (one) and the Easter and holiday bonuses (half each)

export function contributions(gross: number): number {
  return Math.min(gross, CEILING_MONTH * PAYMENTS) * EFKA_EMPLOYEE;
}

export function reduction(taxable: number): number {
  return Math.max(0, REDUCTION.amount - Math.max(0, taxable - REDUCTION.from) * REDUCTION.perEuro);
}

/** Tax on taxable pay: the scale, less the art. 16 reduction, which never exceeds the tax. */
export function taxOn(taxable: number): number {
  return Math.max(0, progressive(taxable, SCALE) - reduction(taxable));
}

export const greece: TaxModel = {
  country: "GR",
  year: 2026,
  currency: "EUR",
  scope: "Single resident private-sector employee in Greece over 30 without children: income tax with the art. 16 reduction, EFKA employee contributions.",
  sources: [
    { label: "AADE circular Ο.3068/18-11-2025: law 5246/2025 art. 3, the 2026 income tax scale (art. 15 ΚΦΕ)", url: "https://www.aade.gr/egkyklioi-kai-apofaseis/o-3068-18-11-2025" },
    { label: "AADE e-library: law 4646/2019, art. 9 (art. 16 ΚΦΕ, the €777 reduction)", url: "http://elib.aade.gr/elib/view?d=/gr/act/2019/4646/" },
    { label: "AADE e-library: ΠΟΛ.1104/2014, taxable pay is gross less the employee's compulsory contributions", url: "http://elib.aade.gr/elib/view?d=/gr/ap/2014/1104/" },
    { label: "AADE: income categories and taxation in Greece (art. 16 reduction above €12,000)", url: "https://www.aade.gr/omogeneis-katoikoi-exoterikoy/eisodima/katigories-eisodimatos-kai-forologia-eisodimatos-stin-ellada" },
    { label: "e-EFKA circular 38/2024: contribution rates from 1 January 2025 (ΚΠΚ 101: employee 13.37%)", url: "https://www.e-efka.gov.gr/el/egkyklioi-kai-genika-eggrapha/egkyklios-38-24122024" },
    { label: "e-EFKA circular 4/2026: insurable earnings ceiling €7,761.94 a month from 1 January 2026", url: "https://www.e-efka.gov.gr/el/egkyklioi-kai-genika-eggrapha/egkyklios-42026" },
  ],
  caveats: [
    "Assumes age over 30: under 25 the first €20,000 is taxed at 0%, from 26 to 30 the €10,000-20,000 band at 9%. Dependent children lower the rates and raise the reduction; neither is modelled.",
    "The gross is read as fourteen equal payments (twelve salaries plus the Christmas, Easter and holiday bonuses), each capped at the monthly contribution ceiling.",
    "Contributions are the standard private-sector package (ΚΠΚ 101); heavy and unhealthy occupations and some funds pay more. No later EFKA circular changing it was found up to October 2026.",
    "The art. 16 reduction falls by €20 per €1,000 of taxable pay above €12,000, applied pro rata.",
    "Art. 15 par. 6 ΚΦΕ requires part of your income to be spent by card or other electronic payment, with a charge on any shortfall (extended to 2026 by law 5246/2025); assumed met.",
    "Newcomers: article 5C makes half of Greek pay tax-free for seven years; switch it on in Money or set a taxable share of 0.5.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const efka = contributions(g);
    const tax = incomeTax(g - efka, input.tweak, taxOn);
    return finish(
      this,
      g,
      [
        { label: "EFKA contributions (employee)", amount: efka },
        { label: "Income tax, after the art. 16 reduction", amount: tax },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
