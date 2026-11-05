import { completenessOf, finish, incomeTax, progressive, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// France, single private-sector employee (non-cadre), one tax share. Contributions are 2026; the income tax scale is
// the one voted in the 2026 finance law (on 2025 income): the scale for 2026 income comes with the 2027 law.

const BAREME: Bands = [
  [11_600, 0],
  [29_579, 0.11],
  [84_577, 0.3],
  [181_917, 0.41],
  [Infinity, 0.45],
];
const WORK_DEDUCTION = { rate: 0.1, min: 509, max: 14_555 }; // 10% flat professional expenses
const DECOTE = { threshold: 1_982, base: 897, rate: 0.4525 }; // single person
const DECOTE_COUPLE = { threshold: 3_277, base: 1_483, rate: 0.4525 };
// Contribution exceptionnelle sur les hauts revenus, single person, on the reference income.
const CEHR: Bands = [
  [250_000, 0],
  [500_000, 0.03],
  [Infinity, 0.04],
];

const PASS = 48_060; // plafond annuel de la sécurité sociale 2026
// Employee contributions: old-age insurance, AGIRC-ARRCO complementary pension with CEG and CET.
const CONTRIBUTIONS: Bands = [
  [PASS, 0.069 + 0.004 + 0.0315 + 0.0086],
  [8 * PASS, 0.004 + 0.0864 + 0.0108],
  [Infinity, 0.004],
];
const CET = 0.0014; // on all pay up to 8 PASS, only once pay exceeds one PASS
const CSG_DEDUCTIBLE = 0.068;
const CSG_CRDS_OTHER = 0.024 + 0.005;
const CSG_BASE_SHARE = 0.9825; // the 1.75% allowance applies up to 4 PASS

export function contributions(gross: number): number {
  return progressive(gross, CONTRIBUTIONS) + (gross > PASS ? Math.min(gross, 8 * PASS) * CET : 0);
}

export function csgBase(gross: number): number {
  return Math.min(gross, 4 * PASS) * CSG_BASE_SHARE + Math.max(0, gross - 4 * PASS);
}

/** Net taxable salary less the 10% professional expenses deduction. */
export function taxableIncome(gross: number): number {
  const netImposable = gross - contributions(gross) - csgBase(gross) * CSG_DEDUCTIBLE;
  const deduction = Math.min(Math.max(netImposable * WORK_DEDUCTION.rate, WORK_DEDUCTION.min), WORK_DEDUCTION.max);
  return Math.max(0, netImposable - deduction);
}

/** A married or PACS couple's tax: two shares (the quotient familial), the couple's décote and CEHR thresholds. */
export function coupleTaxOn(income: number): number {
  const brut = 2 * progressive(income / 2, BAREME);
  const decote = brut < DECOTE_COUPLE.threshold ? Math.max(0, DECOTE_COUPLE.base - DECOTE_COUPLE.rate * brut) : 0;
  return Math.max(0, brut - decote) + progressive(income, [[500_000, 0], [1_000_000, 0.03], [Infinity, 0.04]]);
}

export function incomeTaxOn(income: number): number {
  const brut = progressive(income, BAREME);
  const decote = brut < DECOTE.threshold ? Math.max(0, DECOTE.base - DECOTE.rate * brut) : 0;
  return Math.max(0, brut - decote) + progressive(income, CEHR);
}

export const france: TaxModel = {
  country: "FR",
  year: 2026,
  currency: "EUR",
  scope:
    "Single private-sector employee, one tax share: income tax with the 10% expenses deduction, décote and high-income surcharge; old-age, AGIRC-ARRCO, CSG and CRDS contributions.",
  sources: [
    { label: "Service-Public.fr: barème de l'impôt sur le revenu (loi de finances 2026)", url: "https://www.service-public.fr/particuliers/vosdroits/F1419" },
    { label: "impots.gouv.fr: brochure pratique 2026, calcul de l'impôt (décote)", url: "https://www.impots.gouv.fr/www2/fichiers/documentation/brochure/ir_2026/pdf_som/21-calcul_impot_369a382.pdf" },
    { label: "impots.gouv.fr: brochure pratique 2026, aide-mémoire (10% deduction limits)", url: "https://www.impots.gouv.fr/www2/fichiers/documentation/brochure/ir_2026/pdf_som/aide_memoire.pdf" },
    { label: "Urssaf: taux de cotisations secteur privé 2026", url: "https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/taux-cotisations-secteur-prive.html" },
    { label: "Urssaf: plafond de la sécurité sociale 2026", url: "https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/plafonds-securite-sociale.html" },
    { label: "Urssaf mon-entreprise: official salary simulator (AGIRC-ARRCO, CEG and CET rates)", url: "https://mon-entreprise.urssaf.fr/simulateurs/salaire-brut-net" },
  ],
  caveats: [
    "The income tax scale, 10% deduction limits and décote are those of the 2026 finance law (2025 income); the 2026-income values arrive with the 2027 law and are usually indexed about 1%.",
    "Non-cadre employee: no APEC contribution; no mandatory health cover (mutuelle) or provident scheme, which typically cost an employee €15-60 a month and add the employer's share to the CSG base.",
    "The contribution différentielle sur les hauts revenus (minimum 20% average rate above €250,000) is not modelled.",
    "Same rules in Paris and Lyon; Alsace-Moselle adds 1.3% health contribution (not applied).",
    "Newcomers: the impatriate regime (CGI art. 155 B) can exempt the impatriation bonus, by default 30% of total pay; set a taxable share of 0.7 to approximate it.",
  ],
  joint: {
    kind: "required",
    base: (input) => taxableIncome(input.gross),
    tax: coupleTaxOn,
    replaces: ["Income tax"],
    label: "Income tax, joint (two shares)",
    note: "Married and PACS couples are taxed together on two shares (quotient familial); children's half shares are not modelled.",
  },
  compute(input: TaxInput) {
    const g = input.gross;
    const csg = csgBase(g) * (CSG_DEDUCTIBLE + CSG_CRDS_OTHER);
    const tax = incomeTax(taxableIncome(g), input.tweak, incomeTaxOn);
    return finish(
      this,
      g,
      [
        { label: "Social contributions (employee)", amount: contributions(g) },
        { label: "CSG and CRDS", amount: csg },
        { label: "Income tax", amount: tax },
      ],
      tweakCaveats(input.tweak),
      completenessOf(
        g > 250_000 ? ["the contribution différentielle sur les hauts revenus (a 20% minimum average rate above €250,000)"] : [],
        ["The income tax scale is the 2026 finance law's, for 2025 income; the scale for 2026 income comes with the 2027 law."],
      ),
    );
  },
};
