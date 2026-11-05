import { finish, incomeTax, tweakCaveats, type TaxInput, type TaxModel } from "./common.ts";

// Sweden, employee under 66, income year 2026.

const PBB = 59_200; // prisbasbelopp 2026
const STATE_THRESHOLD = 643_000; // skiktgräns, on taxable income
const STATE_RATE = 0.2;
const PENSION_FEE = { rate: 0.07, max: 47_100 }; // allmän pensionsavgift, credited back against income tax
const PUBLIC_SERVICE = { rate: 0.01, max: 1_184 };

interface Municipality {
  name: string;
  rate: number; // municipal plus regional income tax
  burial: number; // begravningsavgift
}
const MUNICIPALITIES: Record<string, Municipality> = {
  "stockholm-se": { name: "Stockholm", rate: 0.3055, burial: 0.0007 },
};
const AVERAGE: Municipality = { name: "average municipality", rate: 0.3238, burial: 0.00292 };

/** IL 63 kap. 3 §, rounded up to the next hundred kronor. */
export function grundavdrag(income: number): number {
  const x = income / PBB;
  let pbb: number;
  if (x <= 0.99) pbb = 0.423;
  else if (x <= 2.72) pbb = 0.423 + 0.2 * (x - 0.99);
  else if (x <= 3.11) pbb = 0.77;
  else if (x <= 7.88) pbb = 0.77 - 0.1 * (x - 3.11);
  else pbb = 0.293;
  return Math.min(income, Math.ceil((pbb * PBB) / 100) * 100);
}

/** IL 67 kap. 47 §: 0.75% of taxable earned income between 40,000 and 240,000, so at most 1,500. */
export function earnedIncomeReduction(taxable: number): number {
  return Math.min(1_500, Math.max(0, taxable - 40_000) * 0.0075);
}

/** IL 67 kap. 7 § (2026 wording), the earned income tax credit for people under 66. */
export function jobbskatteavdrag(work: number, basicDeduction: number, municipalRate: number): number {
  const x = work / PBB;
  let pbb: number;
  if (x <= 0.91) pbb = x;
  else if (x <= 3.24) pbb = 0.91 + 0.3874 * (x - 0.91);
  else if (x <= 8.08) pbb = 1.813 + 0.251 * (x - 3.24);
  else pbb = 3.027;
  return Math.max(0, pbb * PBB - basicDeduction) * municipalRate;
}

export const sweden: TaxModel = {
  country: "SE",
  year: 2026,
  currency: "SEK",
  scope:
    "Employee under 66: municipal and regional income tax (Stockholm's rate), state income tax, basic deduction, earned income tax credit and reduction, general pension fee and its credit, burial and public service fees.",
  sources: [
    { label: "Skatteverket: belopp och procent, inkomstår 2026", url: "https://www.skatteverket.se/privat/skatter/beloppochprocent/2026.4.1522bf3f19aea8075ba21.html" },
    { label: "Riksdagen: Lag (1994:1744) §§ 3–4 (pension fee base, rounding and low-income exemption)", url: "https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-19941744-om-allman-pensionsavgift_sfs-1994-1744/" },
    { label: "Riksdagen: Inkomstskattelag (1999:1229), 63 kap. 3 §, 67 kap. 2, 7 and 47 §§ (Lag 2025:1376)", url: "https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/inkomstskattelag-19991229_sfs-1999-1229/" },
    { label: "SCB: kommunala skattesatser 2026 (Stockholm 30.55%)", url: "https://www.statistikdatabasen.scb.se/pxweb/sv/ssd/START__OE__OE0101/Kommunalskatter2000/" },
  ],
  caveats: [
    "Church of Sweden membership fee (about 1%) is not included; the burial fee is.",
    "Cities other than Stockholm use the 2026 national average municipal rate (32.38%) and burial fee (0.292%).",
    "No interest deductions or ROT/RUT credits.",
    "Newcomers: the expert tax relief (expertskatt) exempts 25% of pay for up to seven years for qualifying experts; set a taxable share of 0.75.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const m = (input.city && MUNICIPALITIES[input.city]) || AVERAGE;
    const share = input.tweak?.taxableShare ?? 1;
    const income = Math.floor((g * share) / 100) * 100;
    const basic = grundavdrag(income);
    const taxable = Math.max(0, income - basic);
    // Lag (1994:1744) §§ 3–4: base rounded down to SEK 100; fee to nearest SEK 100, ties down.
    const pensionBase = Math.floor(g / 100) * 100;
    const pensionFee = g < Math.ceil(0.423 * PBB) ? 0 : Math.min(Math.ceil((Math.round(pensionBase * PENSION_FEE.rate) - 50) / 100) * 100, PENSION_FEE.max);
    const lines = [{ label: "General pension fee", amount: pensionFee }];
    if (input.tweak?.flatRate !== undefined) {
      lines.push({ label: "Income tax (your flat rate)", amount: incomeTax(g, input.tweak, () => 0) });
    } else {
      const municipal = taxable * m.rate;
      const state = Math.max(0, taxable - STATE_THRESHOLD) * STATE_RATE;
      // 67 kap. 2 §: the pension fee credit comes first; the later two count only against municipal tax.
      const pensionCredit = Math.min(pensionFee, municipal + state);
      let municipalLeft = municipal - Math.max(0, pensionCredit - state);
      const jobCredit = Math.min(municipalLeft, jobbskatteavdrag(income, basic, m.rate));
      municipalLeft -= jobCredit;
      const incomeCredit = Math.min(municipalLeft, earnedIncomeReduction(taxable));
      lines.push({ label: `Municipal and regional income tax (${m.name})`, amount: municipal });
      lines.push({ label: "State income tax", amount: state });
      lines.push({ label: "Pension fee credit", amount: -pensionCredit });
      lines.push({ label: "Earned income tax credit", amount: -jobCredit });
      lines.push({ label: "Tax reduction for earned income", amount: -incomeCredit });
    }
    lines.push({ label: "Burial fee", amount: taxable * m.burial });
    lines.push({ label: "Public service fee", amount: Math.min(taxable * PUBLIC_SERVICE.rate, PUBLIC_SERVICE.max) });
    return finish(this, g, lines, tweakCaveats(input.tweak));
  },
};
