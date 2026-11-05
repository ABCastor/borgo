import { finish, incomeTax, progressive, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// Ireland, single PAYE employee, 2026.

const STANDARD_RATE_BAND = 44_000; // single, no qualifying children
const CREDITS = 2_000 + 2_000; // personal + employee (PAYE)
const USC_EXEMPT_UP_TO = 13_000;
// PRSI class A: 4.2% to 30 September 2026, 4.35% from 1 October 2026; the year's blended rate.
const PRSI_2026 = 0.042 * (9 / 12) + 0.0435 * (3 / 12);
const PRSI_WEEKLY_FLOOR = 352;

export const ireland: TaxModel = {
  country: "IE",
  year: 2026,
  currency: "EUR",
  scope: "Single PAYE employee: income tax with personal and employee credits, USC, PRSI class A.",
  sources: [
    { label: "Revenue: tax rates, bands and reliefs 2026", url: "https://www.revenue.ie/en/personal-tax-credits-reliefs-and-exemptions/tax-relief-charts/index.aspx" },
    { label: "Citizens Information: Universal Social Charge", url: "https://www.citizensinformation.ie/en/money-and-tax/tax/income-tax/universal-social-charge/" },
    { label: "Department of Social Protection: PRSI contribution rates and user guide, 2026", url: "https://assets.gov.ie/static/documents/cb168977/PRSI_C20260116_Contribution_Rates_and_User_Guide_-_SW_14_-_English_Version_-_January_2026_.pdf-web.pdf" },
  ],
  caveats: ["PRSI is blended across the October 2026 rise (4.2% to 4.35%).", "SARP for assignees is a newcomer regime: switch it on in Money if you qualify. Pension contributions set as your pension share get income tax relief within the age-related limits; no couple's band."],
  compute(input: TaxInput) {
    const g = input.gross;
    const tax = incomeTax(g, input.tweak, (t) =>
      Math.max(0, progressive(t, [[STANDARD_RATE_BAND, 0.2], [Infinity, 0.4]]) - CREDITS),
    );
    const usc =
      g <= USC_EXEMPT_UP_TO
        ? 0
        : progressive(g, [
            [12_012, 0.005],
            [28_700, 0.02],
            [70_044, 0.03],
            [Infinity, 0.08],
          ]);
    const weekly = g / 52;
    // DSP 2026 guide: maximum €12 weekly credit at €352.01, tapering by one sixth to €424.
    const prsiCredit = weekly > PRSI_WEEKLY_FLOOR && weekly <= 424 ? Math.max(0, 12 - (weekly - 352.01) / 6) : 0;
    const prsi = weekly > PRSI_WEEKLY_FLOOR ? Math.max(0, g * PRSI_2026 - 52 * prsiCredit) : 0;
    return finish(
      this,
      g,
      [
        { label: "Income tax, after credits", amount: tax },
        { label: "Universal Social Charge", amount: usc },
        { label: "PRSI (employee)", amount: prsi },
      ],
      tweakCaveats(input.tweak),
    );
  },
};
