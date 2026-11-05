import { finish, incomeTax, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// Denmark, employee aged 18+ and not near state pension age, no church membership, 2026 (after the tax reform
// that added the middle and additional top brackets).

const AM_BIDRAG = 0.08; // labour market contribution, on gross pay
const PERSONAL_ALLOWANCE = 54_100;
const BOTTOM = 0.1201;
const MIDDLE = { rate: 0.075, from: 641_200 };
const TOP = { rate: 0.075, from: 777_900 };
const TOP_TOP = { rate: 0.05, from: 2_592_700 };
const CEILING = 0.4457; // tax ceiling on personal income for bottom, middle and municipal tax
const EMPLOYMENT_ALLOWANCE = { rate: 0.1275, max: 63_300 };
const JOB_ALLOWANCE = { rate: 0.045, from: 235_200, max: 3_100 };

const MUNICIPALITIES: Record<string, { name: string; rate: number }> = {
  "copenhagen-dk": { name: "Copenhagen", rate: 0.2339 },
};

export function workAllowances(gross: number): number {
  const employment = Math.min(gross * EMPLOYMENT_ALLOWANCE.rate, EMPLOYMENT_ALLOWANCE.max);
  const job = Math.min(Math.max(0, gross - JOB_ALLOWANCE.from) * JOB_ALLOWANCE.rate, JOB_ALLOWANCE.max);
  return employment + job;
}

export const denmark: TaxModel = {
  country: "DK",
  year: 2026,
  currency: "DKK",
  scope:
    "Employee, no church membership: labour market contribution, bottom, middle, top and additional top state tax, municipal tax (Copenhagen's rate), personal, employment and job allowances.",
  sources: [
    { label: "Skattestyrelsen: tax rates and amounts 2026 (skat.dk)", url: "https://skat.dk/en-us/help/tax-rates" },
    { label: "Skattestyrelsen: employment and job allowances 2026", url: "https://skat.dk/en-us/individuals/deductions-and-allowances/deductions-and-allowances-when-working/employment-and-job-allowances" },
    { label: "Skatteministeriet: kommuneskattesatser 2026 (Copenhagen 23.39%)", url: "https://svmn.dk/media/0oia30i5/kommuneskattesatser_2026.xlsx" },
  ],
  caveats: [
    "No ATP pension contribution (a small fixed monthly amount for full-time employees) and no labour market pension, which is usually agreed by collective agreement.",
    "Church tax (0.80% in Copenhagen for members of the Folkekirke) is not included.",
    "Cities other than Copenhagen use Copenhagen's municipal rate. The 44.57% tax ceiling is applied to municipal, bottom and middle tax (trimming the middle rate where they exceed it), not to the top brackets; this reading of the ceiling is ours.",
    "Newcomers: the researcher and key employee scheme (forskerskatteordningen) taxes pay at a flat rate plus the labour market contribution for up to seven years; set a flat rate to model it (rate not checked here).",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const m = (input.city && MUNICIPALITIES[input.city]) || { name: "Copenhagen rate", rate: 0.2339 };
    const am = g * AM_BIDRAG;
    const personal = g - am;
    const lines = [{ label: "Labour market contribution (AM-bidrag)", amount: am }];
    if (input.tweak?.flatRate !== undefined) {
      lines.push({ label: "Income tax (your flat rate)", amount: incomeTax(personal, input.tweak, () => 0) });
    } else {
      const p = personal * (input.tweak?.taxableShare ?? 1);
      const taxable = Math.max(0, p - workAllowances(g));
      const middleRate = Math.max(0, Math.min(MIDDLE.rate, CEILING - BOTTOM - m.rate));
      lines.push({ label: `Municipal tax (${m.name})`, amount: Math.max(0, taxable - PERSONAL_ALLOWANCE) * m.rate });
      lines.push({ label: "Bottom-bracket state tax", amount: Math.max(0, p - PERSONAL_ALLOWANCE) * BOTTOM });
      lines.push({
        label: "Middle, top and additional top state tax",
        amount:
          Math.max(0, p - MIDDLE.from) * middleRate +
          Math.max(0, p - TOP.from) * TOP.rate +
          Math.max(0, p - TOP_TOP.from) * TOP_TOP.rate,
      });
    }
    return finish(this, g, lines, tweakCaveats(input.tweak));
  },
};
