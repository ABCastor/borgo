import { finish, incomeTax, progressive, taxedBase, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// Netherlands, employee under state pension age, wages only, 2026. Box 1 rates include the national insurance
// premiums (AOW, Anw, Wlz) in the first band; employee insurance and the Zvw health contribution are paid by the employer.

const BOX1_2026: Bands = [
  [38_883, 0.3575], // 8.10% tax + 27.65% national insurance
  [78_426, 0.3756],
  [Infinity, 0.495],
];

/** Algemene heffingskorting 2026, on total income. */
export function generalCredit(income: number): number {
  if (income <= 29_736) return 3_115;
  if (income <= 78_426) return 3_115 - 0.06398 * (income - 29_736);
  return 0;
}

/** Arbeidskorting 2026, on income from work. */
export function labourCredit(work: number): number {
  if (work <= 11_965) return 0.08324 * work;
  if (work <= 25_845) return 996 + 0.31009 * (work - 11_965);
  if (work <= 45_592) return 5_300 + 0.0195 * (work - 25_845);
  if (work <= 132_920) return 5_685 - 0.0651 * (work - 45_592);
  return 0;
}

export const netherlands: TaxModel = {
  country: "NL",
  year: 2026,
  currency: "EUR",
  scope:
    "Employee under state pension age: box 1 income tax and national insurance premiums, general tax credit and labour tax credit.",
  sources: [
    { label: "Belastingdienst: box 1 rates 2026 (with worked example)", url: "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/inkomstenbelasting/heffingskortingen_boxen_tarieven/boxen_en_tarieven/box_1/box_1" },
    { label: "Belastingdienst: algemene heffingskorting 2026", url: "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/inkomstenbelasting/heffingskortingen_boxen_tarieven/heffingskortingen/algemene_heffingskorting/tabel-algemene-heffingskorting-2026" },
    { label: "Belastingdienst: arbeidskorting 2026", url: "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/inkomstenbelasting/heffingskortingen_boxen_tarieven/heffingskortingen/arbeidskorting/tabel-arbeidskorting-2026" },
  ],
  caveats: [
    "Employee workplace pension contributions are not included unless entered as a pension share. Eligible employee premiums reduce taxable wages, and so the income both credits are worked out on; the scheme determines the contribution and franchise.",
    "Holiday allowance (8%) is assumed to be inside the gross figure you enter.",
    "No municipal income tax in Amsterdam or Rotterdam; municipal levies on housing are not income taxes.",
    "Credits are not paid out beyond the tax due (single person, no fiscal partner).",
    "Newcomers: the 30% ruling pays 30% of salary tax-free in 2026 (27% from 2027), within a salary cap; choose the regime (nl-expat) to see it as a scenario.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const flat = input.tweak?.flatRate !== undefined;
    const before = incomeTax(g, input.tweak, (t) => progressive(t, BOX1_2026));
    // Both credits are worked out on taxable wages: the tax-free part of a newcomer allowance and a workplace pension
    // premium are not income (https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/inkomstenbelasting/heffingskortingen_boxen_tarieven/heffingskortingen/algemene_heffingskorting/tabel-algemene-heffingskorting-2026).
    const taxable = taxedBase(g, input.tweak);
    const credits = flat ? 0 : Math.min(before, generalCredit(taxable) + labourCredit(taxable));
    return finish(
      this,
      g,
      [{ label: "Income tax and national insurance (box 1), after credits", amount: before - credits }],
      tweakCaveats(input.tweak),
    );
  },
};
