import { finish, incomeTax, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// Hungary, employee aged 25 or over without children, 2026. Wages pay a flat personal income tax and the
// social security contribution on the same gross; neither reduces the other.

const PIT = 0.15;
const SOCIAL_SECURITY = 0.185; // társadalombiztosítási járulék

export const hungary: TaxModel = {
  country: "HU",
  year: 2026,
  currency: "HUF",
  scope: "Employee aged 25 or over, no children: 15% personal income tax and the 18.5% social security contribution.",
  sources: [
    { label: "NAV: personal income tax rates (15% since 2016)", url: "https://nav.gov.hu/ugyfeliranytu/adokulcsok_jarulekmertekek/Adotablak" },
    { label: "EURES: Hungary working conditions (18.5% employee social security)", url: "https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-hungary_en" },
  ],
  caveats: [
    "No family tax allowance and no exemptions for people under 25 or for mothers with children, which can remove the income tax entirely.",
    "The employer's social contribution tax (13%) comes on top of the gross and is not deducted here.",
    "Budapest levies no local income tax.",
    "No special regime for newcomers; a taxable share or flat rate can still model a treaty arrangement.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    return finish(
      this,
      g,
      [
        { label: "Social security contribution", amount: g * SOCIAL_SECURITY },
        { label: "Personal income tax", amount: incomeTax(g, input.tweak, (t) => t * PIT) },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
