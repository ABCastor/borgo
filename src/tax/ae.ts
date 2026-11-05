import { finish, incomeTax, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// United Arab Emirates, expatriate employee, 2026. No personal income tax.

// Involuntary Loss of Employment insurance, compulsory for employees: the premium depends on basic salary.
const ILOE_THRESHOLD = 16_000; // AED per month
const ILOE_PREMIUM = { low: 5, high: 10 }; // AED per month, the maximum for the basic package

export const unitedArabEmirates: TaxModel = {
  country: "AE",
  year: 2026,
  currency: "AED",
  scope: "Expatriate employee: no income tax; the compulsory unemployment insurance (ILOE) premium is the only deduction.",
  sources: [
    { label: "UAE government portal: taxation (no income tax on individuals)", url: "https://u.ae/en/information-and-services/finance-and-investment/taxation" },
    { label: "UAE government portal: unemployment insurance scheme", url: "https://u.ae/en/information-and-services/jobs/Workplace-regulations/insurance/unemployment-insurance-scheme" },
    { label: "UAE government portal: end-of-service benefits in the private sector", url: "https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/end-of-service-benefits-for-employees-in-the-private-sector" },
  ],
  caveats: [
    "The UAE levies no income tax on individuals; 5% VAT applies to most spending instead.",
    "Assumes an expatriate. Emirati employees fall under the pension and social security law and pay pension contributions, which are not modelled.",
    "The employer's end-of-service gratuity is a lump sum on leaving, not part of yearly take-home pay.",
    "The unemployment insurance band uses the whole salary; it is set on basic salary, which is often lower, so the AED 10 band may apply less often than shown.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const iloe = g > 0 ? 12 * (g / 12 > ILOE_THRESHOLD ? ILOE_PREMIUM.high : ILOE_PREMIUM.low) : 0;
    return finish(
      this,
      g,
      [
        // Zero unless the person sets a flat rate (for example their home country's tax).
        { label: "Income tax", amount: incomeTax(g, input.tweak, () => 0) },
        { label: "Unemployment insurance (ILOE)", amount: iloe },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
