import { finish, incomeTax, progressive, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// Czechia, employee resident for tax, 2026.

const AVERAGE_WAGE = 48_967; // 2026 average wage for tax and social security limits
const HIGHER_RATE_FROM = 36 * AVERAGE_WAGE; // 1,762,812
const SOCIAL_CEILING = 48 * AVERAGE_WAGE; // 2,350,416
const TAXPAYER_CREDIT = 30_840; // § 35ba základní sleva na poplatníka

const SOCIAL = 0.071; // pension 6.5% + sickness 0.6%
const HEALTH = 0.135 / 3; // the employee pays a third of 13.5%

/** Personal income tax: 15%, and 23% on the part of the base above the threshold. */
export function twoRates(base: number, threshold = HIGHER_RATE_FROM): number {
  return progressive(base, [
    [threshold, 0.15],
    [Infinity, 0.23],
  ]);
}

export const czechia: TaxModel = {
  country: "CZ",
  year: 2026,
  currency: "CZK",
  scope: "Employee: personal income tax at 15%/23% with the taxpayer credit, social security and health insurance.",
  sources: [
    { label: "Finanční správa: employment income 2026 (rates, thresholds, credits, worked examples)", url: "https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/zamestnanci-zamestnavatele/obecne-informace" },
    { label: "ČSSZ: contribution rates (employee 7.1%)", url: "https://www.cssz.gov.cz/web/cz/vyse-a-sazba" },
    { label: "ČSSZ: maximum assessment base 2026", url: "https://www.cssz.gov.cz/web/cz/maximalni-vymerovaci-zaklad" },
    { label: "VZP: health insurance 13.5% of the assessment base", url: "https://www.vzp.cz/platci/informace/zamestnavatel/vymerovaci-zaklad-a-vypocet-pojistneho" },
    { label: "VZP: the employee's third of the premium", url: "https://www.vzp.cz/platci/informace/zamestnavatel/splatnost-a-dalsi-zasady-pro-platbu-pojistneho" },
  ],
  caveats: [
    "Annual liability; monthly advances use a monthly threshold (3 × average wage) and round up, so payslips differ slightly.",
    "No child benefits or spouse credit. Pension savings set as your pension share are deducted within the CZK 48,000 limit.",
    "Prague levies no local income tax.",
    "No special regime for newcomers; a taxable share or flat rate can still model a treaty arrangement.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const flat = input.tweak?.flatRate !== undefined;
    const tax = incomeTax(g, input.tweak, (t) => Math.max(0, twoRates(t) - (flat ? 0 : TAXPAYER_CREDIT)));
    return finish(
      this,
      g,
      [
        { label: "Social security (employee)", amount: Math.min(g, SOCIAL_CEILING) * SOCIAL },
        { label: "Health insurance (employee)", amount: g * HEALTH },
        { label: flat ? "Income tax (your flat rate)" : "Income tax, after the taxpayer credit", amount: tax },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
