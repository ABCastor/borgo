// Pension contributions: what each country lets an employee put into a pension before income tax, or credits back.
// A person sets a share of gross; the rule here decides how much of it lowers income tax, through the same TaxTweak
// every country module already honours (`pretaxDeduction`), or as a tax credit line. The contribution itself leaves
// take-home pay either way: it is the person's own money, kept in the pension, so it is shown as its own line.
// Contribution limits are 2026 unless a caveat says otherwise.

import type { Iso2 } from "../core/types.ts";
import { taxableIncome as frenchProfessionalIncome } from "./fr.ts";
import { socialSecurity as spanishSocialSecurity } from "./es.ts";

export interface PensionRelief {
  /** The plan people usually mean, in a few words. */
  plan: string;
  /**
   * "deduction": the deductible part comes off every income-tax base (not social contributions);
   * "credit": a share of the contribution comes off the tax; "none": no relief for employees;
   * "not-modelled": relief exists but is not modelled yet, so the contribution is counted without it.
   */
  kind: "deduction" | "credit" | "none" | "not-modelled";
  /** The most that counts for relief, a year in local currency, from gross pay and age (when known). */
  cap?: (gross: number, age: number | undefined, opts: { foreigner?: boolean }) => number;
  /** For a credit: the share of the counted contribution taken off the tax. */
  rate?: number;
  /** Contributions below this annual amount do not qualify (equal monthly payments). */
  qualifyingFloor?: number;
  /** Income-tax line prefixes against which a non-refundable credit can be used. */
  creditTaxes?: string[];
  /** A tax transfer into the pension account is not spendable take-home pay. */
  creditToPension?: boolean;
  /** One plain sentence: the rule, and what is assumed. */
  note: string;
  source?: { label: string; url: string };
}

export const PENSION_RELIEF: Record<Iso2, PensionRelief> = {
  US: {
    plan: "401(k)",
    kind: "deduction",
    cap: (_g, age) => 24_500 + (age === undefined ? 0 : age >= 60 && age <= 63 ? 11_250 : age >= 50 ? 8_000 : 0),
    note: "A traditional 401(k) contribution comes off federal and state income tax, not Social Security or Medicare: up to $24,500, plus $8,000 from age 50 ($11,250 at 60 to 63). From 2026, catch-up contributions of people who earned over $150,000 the year before must go in after tax; that is not modelled.",
    source: { label: "IRS: 401(k) and IRA limits for 2026", url: "https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500" },
  },
  GB: {
    plan: "workplace or personal pension",
    kind: "deduction",
    cap: (g) => Math.min(g, g > 260_000 ? Math.max(10_000, 60_000 - (g - 260_000) / 2) : 60_000),
    note: "Pension contributions get income tax relief, not National Insurance relief (salary sacrifice, which saves NI too, is not modelled), up to the £60,000 annual allowance, tapered above £260,000.",
    source: { label: "GOV.UK: tax on your private pension contributions", url: "https://www.gov.uk/tax-on-your-private-pension/pension-tax-relief" },
  },
  CA: {
    plan: "RRSP",
    kind: "deduction",
    cap: (g) => Math.min(0.18 * g, 33_810),
    note: "RRSP contributions are deducted from federal and provincial taxable income, up to 18% of earned income (this year's pay stands in for last year's) and $33,810; unused room from earlier years is not counted.",
    source: { label: "CRA: MP, DB, RRSP, DPSP, ALDA, TFSA limits", url: "https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html" },
  },
  DE: {
    plan: "occupational pension (Entgeltumwandlung)",
    kind: "deduction",
    cap: () => 0.08 * 101_400,
    note: "Pay converted into an occupational pension is free of income tax up to 8% of the pension insurance ceiling (€8,112); the social insurance saving on the first 4% is not modelled.",
    source: { label: "Gesetze im Internet: § 3 Nr. 63 EStG", url: "https://www.gesetze-im-internet.de/estg/__3.html" },
  },
  FR: {
    plan: "PER (plan d'épargne retraite)",
    kind: "deduction",
    cap: (g, age) => age !== undefined && (age < 18 || age >= 70) ? 0 : Math.max(4_710, Math.min(0.1 * frenchProfessionalIncome(g), 37_680)),
    note: "PER contributions from age 18 and before age 70 are deducted up to 10% of the previous year's professional income net of compulsory contributions and professional expenses (at least €4,710, at most €37,680). This year's modelled net professional income stands in for last year's; unused allowances and employer pension payments are not counted. Without an age, an adult under 70 is assumed.",
    source: { label: "Service Public: PER, 2026 deduction and age limit", url: "https://www.service-public.gouv.fr/particuliers/vosdroits/F34982" },
  },
  ES: {
    plan: "plan de pensiones",
    kind: "deduction",
    cap: (g) => Math.min(1_500, 0.3 * Math.max(0, g - spanishSocialSecurity(g) - 2_000)),
    note: "Personal pension plan contributions reduce the taxable base up to the lower of €1,500 and 30% of net employment income (gross less employee social security and the €2,000 work expense allowance here). Employer-linked plans can increase the monetary limit by up to €8,500 under conditions; not modelled.",
    source: { label: "BOE: Ley 35/2006 del IRPF, art. 51 and 52", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764" },
  },
  IT: {
    plan: "fondo pensione",
    kind: "deduction",
    cap: () => 5_300,
    note: "Contributions to a supplementary pension fund are deducted from total income, for IRPEF and the surcharges, up to €5,300 for tax period 2026. The limit includes employer contributions, assumed zero here, and excludes TFR.",
    source: { label: "Normattiva: D.Lgs. 252/2005, art. 8(4), 2026 limit", url: "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2005-12-05;252~art8" },
  },
  IE: {
    plan: "occupational pension or PRSA",
    kind: "deduction",
    cap: (g, age) => Math.min(g, 115_000) * (age === undefined || age < 30 ? 0.15 : age < 40 ? 0.2 : age < 50 ? 0.25 : age < 55 ? 0.3 : age < 60 ? 0.35 : 0.4),
    note: "Pension contributions get income tax relief (not USC or PRSI) up to a share of earnings capped at €115,000 that rises with age: 15% under 30, 20% at 30, 25% at 40, 30% at 50, 35% at 55, 40% from 60. Without an age, the under-30 limit is used.",
    source: { label: "Revenue: tax relief for pension contributions", url: "https://www.revenue.ie/en/jobs-and-pensions/pension/relief/tax-relief-limits.aspx" },
  },
  NL: {
    plan: "workplace pension",
    kind: "deduction",
    note: "Your eligible share of a workplace pension premium is taken from pay before box 1 tax. This assumes the entered amount is permitted by your scheme; scheme-specific fiscal limits and separate personal annuity contribution room are not calculated.",
    source: { label: "Belastingdienst: workplace pension premiums are deducted from wages before tax", url: "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/werk_en_inkomen/lijfrente/aftrekken-lijfrentepremies/aftrekken-lijfrentepremies" },
  },
  JP: {
    plan: "iDeCo",
    kind: "deduction",
    cap: () => 276_000,
    note: "iDeCo contributions are deducted from income for income tax and resident tax, up to ¥23,000 a month for an employee without a company pension plan (higher limits from December 2026 are not applied).",
    source: { label: "iDeCo official site (National Pension Fund Association)", url: "https://www.ideco-koushiki.jp/start/entry.html" },
  },
  CH: {
    plan: "pillar 3a",
    kind: "deduction",
    cap: () => 7_258,
    note: "Pillar 3a contributions are deducted from federal, cantonal and communal taxable income up to CHF 7,258 for an employee in an occupational pension plan.",
    source: { label: "BSV: pillar 3a contributions", url: "https://www.bsv.admin.ch/fr/votre-cotisation-au-3e-pilier" },
  },
  CZ: {
    plan: "pension savings (penzijní spoření)",
    kind: "deduction",
    cap: () => 48_000,
    qualifyingFloor: 12 * 1_700,
    note: "For a non-retired employee paying equally each month into third-pillar pension savings, only the monthly payment above CZK 1,700 is deductible, up to CZK 48,000 a year shared with other eligible retirement products. Other products (such as DIP) and retired participants have different qualifying rules and are not modelled.",
    source: { label: "Finanční správa: pension deductions, 2026 employee FAQ", url: "https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/zamestnanci-zamestnavatele/dotazy-a-odpovedi/2026/aktualni-dotazy-a-odpovedi-k-dani-z" },
  },
  EE: {
    plan: "third pillar",
    kind: "deduction",
    cap: (g) => Math.min(0.15 * g, 6_000),
    note: "Third-pillar contributions are deducted from income up to 15% of it and €6,000 a year; the mandatory second pillar is not this.",
    source: { label: "EMTA: supplementary funded pension contributions, Income Tax Act § 28", url: "https://www.emta.ee/en/private-client/taxes-and-payment/tax-incentives/contributions-supplementary-funded-pension" },
  },
  SG: {
    plan: "SRS",
    kind: "deduction",
    cap: (_g, _a, o) => (o.foreigner ? 35_700 : 15_300),
    note: "Supplementary Retirement Scheme contributions are a tax relief up to S$15,300 for citizens and permanent residents (S$35,700 for foreigners).",
    source: { label: "IRAS: SRS contributions and tax relief", url: "https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/special-tax-schemes/srs-contributions" },
  },
  PT: {
    plan: "PPR",
    kind: "credit",
    rate: 0.2,
    creditTaxes: ["IRS income tax"],
    cap: (_g, age) => (age === undefined || age > 50 ? 300 : age < 35 ? 400 : 350) / 0.2,
    note: "Before retirement, a PPR gives an IRS credit of 20% of contributions, at most €400 under 35, €350 from 35 to 50 and €300 over 50, limited to IRS due. Age means age on 1 January; without an age, the lowest limit is used. Retirement status and other deductions sharing the overall IRS limit are not modelled.",
    source: { label: "Portal das Finanças: EBF art. 21", url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/bf_rep/Pages/ebf-artigo-21-ordm-.aspx" },
  },
  HU: {
    plan: "voluntary pension fund",
    kind: "credit",
    rate: 0.2,
    creditTaxes: ["Personal income tax"],
    creditToPension: true,
    cap: () => 750_000,
    note: "Payments into a voluntary pension fund allow 20%, at most HUF 150,000 a year and limited to remaining personal income tax, to be transferred into the pension account by NAV. This is pension saving, not cash take-home. The limit is shared with other voluntary mutual funds, assumed absent here.",
    source: { label: "NAV: voluntary pension fund tax transfers", url: "https://nav.gov.hu/sajtoszoba/hirek/Erdemes_kihasznalni_az_onkentes_penztari_befizetesek_utan_jaro_adokedvezmenyt" },
  },
  NO: {
    plan: "IPS (individual pension savings)",
    kind: "credit",
    rate: 0.22,
    creditTaxes: ["Tax on ordinary income", "Income tax (your flat rate)"],
    cap: () => 25_000,
    note: "The tax-favoured individual pension savings scheme permits up to NOK 25,000 in 2026. Payments reduce ordinary income taxed at 22%, represented here by a credit limited to ordinary income tax due; bracket tax and national insurance are not reduced. Old IPS has a separate NOK 15,000 limit; unused deductions and special regional tax rates are not modelled.",
    source: { label: "Skatteetaten: 2026 IPS deduction limits", url: "https://www.skatteetaten.no/en/rates/maximum-annual-deduction-for-payments-to-an-individual-pension-scheme/" },
  },
  SE: { plan: "private pension savings", kind: "none", note: "An employee with occupational pension rights gets no deduction for private pension savings. Employees entirely without those rights can qualify; that exception and salary exchange into an employer pension are not modelled.", source: { label: "Skatteverket: pension savings deductions", url: "https://www.skatteverket.se/privat/skatter/arbeteochinkomst/avdragforprivatpersoner/np.4.5fc8c94513259a4ba1d800042822.html" } },
  AE: { plan: "pension savings", kind: "none", note: "There is no income tax, so a contribution brings no tax relief.", source: { label: "UAE government: taxation", url: "https://u.ae/en/information-and-services/finance-and-investment/taxation" } },
  AU: { plan: "salary sacrifice into super", kind: "not-modelled", note: "Concessional super contributions are generally taxed at 15% in the fund, with additional tax possible for high incomes. The cap includes employer contributions; this relief and fund tax are not modelled.", source: { label: "ATO: concessional and non-concessional contributions", url: "https://www.ato.gov.au/individuals-and-families/super-for-individuals-and-families/super/growing-and-keeping-track-of-your-super/caps-limits-and-tax-on-super-contributions/understanding-concessional-and-non-concessional-contributions" } },
  AT: { plan: "pension savings", kind: "not-modelled", note: "Austrian pension savings relief (the state premium on Zukunftsvorsorge) is not modelled.", source: { label: "BMF: old-age provision and Zukunftsvorsorge", url: "https://www.bmf.gv.at/themen/finanzmarkt/altersvorsorge.html" } },
  BE: { plan: "pension savings (épargne-pension)", kind: "not-modelled", note: "Belgium's 25% or 30% tax reduction for pension savings is not modelled.", source: { label: "SPF Finances: pension savings", url: "https://fin.belgium.be/fr/particuliers/avantages-fiscaux/epargne-pension" } },
  DK: { plan: "ratepension", kind: "not-modelled", note: "Danish pension contributions are deductible within limits; not modelled.", source: { label: "Skat: deductions for pension payments", url: "https://skat.dk/borger/pension-og-efterloen/fradrag-for-indbetalinger-til-pension" } },
  FI: { plan: "voluntary pension insurance", kind: "not-modelled", note: "Eligible voluntary pension insurance and long-term savings payments are deductible from capital income up to €5,000. If capital income is insufficient, a special 30% deficit credit can reduce earned-income tax. Neither relief is modelled.", source: { label: "Vero: deductions from capital income", url: "https://www.vero.fi/en/individuals/deductions/what-can-I-deduct/deductions-from-capital-incom/" } },
  GR: { plan: "occupational pension", kind: "not-modelled", note: "Greek relief for occupational pension contributions is not modelled.", source: { label: "AADE: occupational pension provisions, law 5078/2023", url: "https://www.aade.gr/sites/default/files/2024-01/o_3003_2023.pdf" } },
  PL: { plan: "IKZE", kind: "not-modelled", note: "Polish IKZE contributions are deductible within a yearly limit; not modelled. PPK is not deducted either.", source: { label: "Polish tax authority: IKZE relief", url: "https://podatki.gov.pl/ulgi-i-odliczenia/ulga-na-ikze-pit" } },
};

/** What a contribution is worth in tax terms: the part deducted before tax, or the credit. */
export function pensionRelief(country: Iso2, contribution: number, gross: number, age: number | undefined, opts: { foreigner?: boolean } = {}): { deducted: number; credit: number; rule: PensionRelief | undefined } {
  const rule = PENSION_RELIEF[country];
  if (!rule || contribution <= 0) return { deducted: 0, credit: 0, rule };
  const qualifying = Math.max(0, contribution - (rule.qualifyingFloor ?? 0));
  const counted = Math.min(qualifying, rule.cap ? rule.cap(gross, age, opts) : qualifying);
  if (rule.kind === "deduction") return { deducted: counted, credit: 0, rule };
  if (rule.kind === "credit") return { deducted: 0, credit: counted * (rule.rate ?? 0), rule };
  return { deducted: 0, credit: 0, rule };
}

/**
 * How a pension share is treated in a country, for every face to say the same: "modelled" (the relief is worked out:
 * its base and cap are in PENSION_RELIEF and audited in docs/pension-leave-audit.md), "no relief" (the law gives an
 * employee none), "not modelled" (relief exists or may exist and is not worked out: the share is counted as saving,
 * with no tax relief).
 */
export type PensionStatus = "modelled" | "no relief" | "not modelled";

export function pensionStatus(country: Iso2): { country: Iso2; plan: string; status: PensionStatus; text: string } {
  const rule = PENSION_RELIEF[country];
  const status: PensionStatus = !rule || rule.kind === "not-modelled" ? "not modelled" : rule.kind === "none" ? "no relief" : "modelled";
  const plan = rule?.plan ?? "pension";
  const text =
    status === "modelled" ? `${plan}: tax relief modelled` : status === "no relief" ? `${plan}: no tax relief for an employee here, counted as saving` : `${plan}: not modelled, counted as saving with no tax relief`;
  return { country, plan, status, text };
}

/** Every country with a pension rule, and how its pension share is treated. */
export function pensionPlans(): ReturnType<typeof pensionStatus>[] {
  return Object.keys(PENSION_RELIEF).sort().map(pensionStatus);
}
