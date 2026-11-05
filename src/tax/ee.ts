import { finish, incomeTax, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// Estonia, employee under pensionable age, 2026. From 2026 the basic exemption no longer shrinks with income.

const INCOME_TAX = 0.22;
const BASIC_EXEMPTION = 8_400; // €700 a month
const UNEMPLOYMENT = 0.016; // employee premium
const FUNDED_PENSION = 0.02; // second pillar, default rate

export const estonia: TaxModel = {
  country: "EE",
  year: 2026,
  currency: "EUR",
  scope: "Employee under pensionable age: 22% income tax after the basic exemption, unemployment insurance and the default 2% funded pension contribution.",
  sources: [{ label: "Estonian Tax and Customs Board: tax rates 2026", url: "https://www.emta.ee/en/private-client/taxes-and-payment/declaration-income/tax-rates" }],
  caveats: [
    "Includes the second-pillar funded pension at the default 2% (members can choose 4% or 6%, and some have left the pillar); both contributions reduce taxable income.",
    "Social tax (33%) is paid by the employer on top of the gross and is not deducted here.",
    "No municipal income tax: Tallinn's share comes out of the 22%.",
    "No special regime for newcomers; a taxable share or flat rate can still model a treaty arrangement.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const unemployment = g * UNEMPLOYMENT;
    const pension = g * FUNDED_PENSION;
    const base = Math.max(0, g - unemployment - pension);
    const flat = input.tweak?.flatRate !== undefined;
    const tax = incomeTax(base, input.tweak, (t) => Math.max(0, t - BASIC_EXEMPTION) * INCOME_TAX);
    return finish(
      this,
      g,
      [
        { label: "Unemployment insurance (employee)", amount: unemployment },
        { label: "Funded pension (second pillar)", amount: pension },
        { label: flat ? "Income tax (your flat rate)" : "Income tax", amount: tax },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
