import { finish, incomeTax, progressive, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// Norway, employee aged 17-69 outside Troms and Finnmark, 2026. Municipal and county tax are inside the 22% on
// ordinary income, so Oslo needs no separate line.

const ORDINARY_RATE = 0.22;
const PERSONAL_ALLOWANCE = 114_540; // personfradrag, class 1
const STANDARD_DEDUCTION = { rate: 0.46, max: 95_700 }; // minstefradrag on wages
const BRACKET_TAX: Bands = [
  [226_100, 0],
  [318_300, 0.017],
  [725_050, 0.04],
  [980_100, 0.137],
  [1_467_200, 0.168],
  [Infinity, 0.178],
];
const SOCIAL_SECURITY = { rate: 0.076, floor: 99_650, phaseIn: 0.25 }; // trygdeavgift

/** National insurance contribution: 7.6%, never more than 25% of income above the lower limit. */
export function trygdeavgift(personal: number): number {
  return Math.max(0, Math.min(personal * SOCIAL_SECURITY.rate, (personal - SOCIAL_SECURITY.floor) * SOCIAL_SECURITY.phaseIn));
}

export function ordinaryIncome(gross: number): number {
  const deduction = Math.min(gross * STANDARD_DEDUCTION.rate, STANDARD_DEDUCTION.max);
  return Math.max(0, gross - deduction - PERSONAL_ALLOWANCE);
}

export const norway: TaxModel = {
  country: "NO",
  year: 2026,
  currency: "NOK",
  scope: "Employee aged 17-69 outside Troms and Finnmark: 22% tax on ordinary income, bracket tax and national insurance contribution.",
  sources: [
    { label: "Skatteetaten: tax on ordinary income 2026", url: "https://www.skatteetaten.no/satser/alminnelig-inntekt/" },
    { label: "Skatteetaten: bracket tax (trinnskatt) 2026", url: "https://www.skatteetaten.no/satser/trinnskatt/" },
    { label: "Skatteetaten: national insurance contribution (trygdeavgift) 2026", url: "https://www.skatteetaten.no/satser/trygdeavgift/" },
    { label: "Skatteetaten: standard deduction (minstefradrag) 2026", url: "https://www.skatteetaten.no/satser/minstefradrag/" },
    { label: "Skatteetaten: personal allowance (personfradrag) 2026", url: "https://www.skatteetaten.no/satser/personfradrag/" },
  ],
  caveats: [
    "Standard deduction only; actual expenses and interest on loans are not deducted. IPS pension savings set as your pension share get their 22% relief.",
    "Troms and Finnmark residents pay 18.5% on ordinary income and lower bracket tax; not modelled.",
    "Newcomers: the PAYE scheme for foreign workers (a flat withholding rate on gross pay for the first years, within an income cap) is not applied; set a flat rate to model it; the PAYE rate already includes national insurance, which this model still lists, so use the PAYE rate less 7.6 points (rate not checked here).",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const flat = input.tweak?.flatRate !== undefined;
    const lines = [{ label: "National insurance contribution", amount: trygdeavgift(g) }];
    if (flat) {
      lines.push({ label: "Income tax (your flat rate)", amount: incomeTax(g, input.tweak, () => 0) });
    } else {
      const share = input.tweak?.taxableShare ?? 1;
      lines.push({ label: "Tax on ordinary income", amount: ordinaryIncome(g * share) * ORDINARY_RATE });
      lines.push({ label: "Bracket tax", amount: progressive(g * share, BRACKET_TAX) });
    }
    return finish(this, g, lines, tweakCaveats(input.tweak));
  },
};
