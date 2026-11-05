import { completenessOf, finish, incomeTax, progressive, taxedShare, tweakCaveats, type Bands, type TaxInput, type TaxModel } from "./common.ts";

// Italy, employee resident for tax, 2026.

const IRPEF_2026: Bands = [
  [28_000, 0.23],
  [50_000, 0.33], // second rate cut from 35% to 33% by the 2026 budget law (L. 199/2025)
  [Infinity, 0.43],
];

const INPS_EMPLOYEE = 0.0919; // IVS employee share, private sector
const INPS_EXTRA = 0.01; // additional 1% above the yearly threshold
const INPS_EXTRA_THRESHOLD = 56_224; // INPS circular 6/2026: first annual pension bracket
const INPS_CEILING = 122_295; // 2026 annual ceiling for first compulsory coverage after 1995

// Regional surcharge (addizionale regionale), 2026, as registered with the Ministry of Finance (one page per region:
// https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/addregirpef/addregirpef.php?reg=13&anno=2026,
// reg=02 Basilicata, 05 Campania, 06 Emilia-Romagna, 08 Lazio, 10 Lombardia, 13 Piemonte, 17 Toscana). Bands are
// progressive on taxable income. Unknown regions use DEFAULT_REGIONAL.
interface RegionalRule {
  name: string;
  bands: Bands;
  /** Lazio: at or below this income the whole income is taxed at `flat` instead. */
  flatUpTo?: { income: number; rate: number };
  /** Lazio: a deduction off the surcharge for incomes in this range. */
  deduction?: { from: number; to: number; amount: number };
}
const REGIONAL: Record<string, RegionalRule> = {
  "IT-21": { name: "Piemonte", bands: [[15_000, 0.0162], [28_000, 0.0268], [50_000, 0.0331], [Infinity, 0.0333]] },
  "IT-77": { name: "Basilicata", bands: [[Infinity, 0.0123]] },
  "IT-72": { name: "Campania", bands: [[15_000, 0.0173], [28_000, 0.0296], [50_000, 0.032], [Infinity, 0.0333]] },
  "IT-45": { name: "Emilia-Romagna", bands: [[15_000, 0.0133], [28_000, 0.0193], [50_000, 0.0278], [Infinity, 0.0333]] },
  // L.R. Lazio 20/2025 art. 2: 1.73% on the whole income up to €28,000; €60 off between €28,001 and €30,000.
  "IT-62": { name: "Lazio", bands: [[15_000, 0.0173], [Infinity, 0.0333]], flatUpTo: { income: 28_000, rate: 0.0173 }, deduction: { from: 28_000, to: 30_000, amount: 60 } },
  "IT-25": { name: "Lombardia", bands: [[15_000, 0.0123], [28_000, 0.0158], [50_000, 0.0172], [Infinity, 0.0173]] },
  "IT-52": { name: "Toscana", bands: [[15_000, 0.0142], [28_000, 0.0143], [50_000, 0.0332], [Infinity, 0.0333]] },
};
const DEFAULT_REGIONAL: RegionalRule = { name: "typical rate", bands: [[Infinity, 0.0173]] }; // statutory base 1.23% + a common 0.5% increase

export function regionalSurcharge(income: number, rule: RegionalRule): number {
  if (rule.flatUpTo && income <= rule.flatUpTo.income) return income * rule.flatUpTo.rate;
  const tax = progressive(income, rule.bands);
  const d = rule.deduction && income > rule.deduction.from && income <= rule.deduction.to ? rule.deduction.amount : 0;
  return Math.max(0, tax - d);
}

// Municipal surcharge (addizionale comunale) by city id, from each council's latest resolution in the Ministry of
// Finance register (https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/nuova_addcomirpef/sceltaregione.htm,
// all years). None of these councils registered a new resolution for 2026, so the 2025 rates carry on. Income at or
// below `exemptUpTo` pays nothing; above it, the whole income is taxed. Unknown cities use DEFAULT_MUNICIPAL.
const MUNICIPAL: Record<string, { bands: Bands; exemptUpTo?: number }> = {
  // Torino, resolution 195 of 29 March 2022, confirmed for 2025 under L. 207/2024 art. 1 c. 751.
  "turin-it": { bands: [[28_000, 0.008], [50_000, 0.011], [Infinity, 0.012]], exemptUpTo: 11_790 },
  "rome-it": { bands: [[Infinity, 0.009]], exemptUpTo: 14_000 }, // resolution 186 of 19 December 2024
  "milan-it": { bands: [[Infinity, 0.008]], exemptUpTo: 23_000 },
  "naples-it": { bands: [[Infinity, 0.01]], exemptUpTo: 12_000 },
  "bologna-it": { bands: [[Infinity, 0.008]], exemptUpTo: 15_000 },
  "florence-it": { bands: [[Infinity, 0.002]], exemptUpTo: 25_000 },
};
const DEFAULT_MUNICIPAL: Bands = [[Infinity, 0.008]];

/** Trattamento integrativo (D.L. 3/2020 art. 1, as amended): €1,200 a year for a full-year employee up to €15,000 of income. */
const INTEGRATIVE = { amount: 1_200, upTo: 15_000, allowance: 75 };

/** Employment-income tax credit, art. 13 TUIR as amended from 2025. */
function detrazioneLavoro(income: number): number {
  if (income <= 15_000) return Math.max(1_955, 690);
  if (income <= 28_000) return 1_910 + (1_190 * (28_000 - income)) / 13_000;
  if (income <= 50_000) {
    const base = (1_910 * (50_000 - income)) / 22_000;
    return base + (income > 25_000 && income <= 35_000 ? 65 : 0);
  }
  return 0;
}

/**
 * The 2025 "cuneo fiscale" measures (L. 207/2024 art. 1 c. 4-9): a tax-free sum up to €20,000, an extra credit from
 * €20,000 to €40,000. `income` is the whole of employment income, the tax-free share of a newcomer or researcher regime
 * included (c. 9): it picks the percentage and the credit. The percentage is then paid on `taxable`, the taxed part of
 * employment income only (Agenzia delle Entrate, Circolare 4/E 2025, section 1.2 and its example 3).
 */
export function cuneo(income: number, taxable = income): { exemptSum: number; extraCredit: number } {
  if (income <= 8_500) return { exemptSum: taxable * 0.071, extraCredit: 0 };
  if (income <= 15_000) return { exemptSum: taxable * 0.053, extraCredit: 0 };
  if (income <= 20_000) return { exemptSum: taxable * 0.048, extraCredit: 0 };
  if (income <= 32_000) return { exemptSum: 0, extraCredit: 1_000 };
  if (income <= 40_000) return { exemptSum: 0, extraCredit: (1_000 * (40_000 - income)) / 8_000 };
  return { exemptSum: 0, extraCredit: 0 };
}

export const italy: TaxModel = {
  country: "IT",
  year: 2026,
  currency: "EUR",
  scope: "Employee resident in Italy, first compulsory pension completeness after 1995: IRPEF, INPS employee contributions, employment credit, cuneo fiscale, trattamento integrativo, regional and municipal surcharges.",
  sources: [
    { label: "Agenzia delle Entrate: IRPEF rates (2026 budget law)", url: "https://www.agenziaentrate.gov.it/portale/imposta-sul-reddito-delle-persone-fisiche-irpef-/aliquote-e-calcolo-dell-irpef" },
    { label: "TUIR art. 13 (employment credit)", url: "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.della.repubblica:1986-12-22;917" },
    { label: "Legge 207/2024 art. 1 c. 4-9 (cuneo fiscale)", url: "https://www.gazzettaufficiale.it/eli/id/2024/12/31/24G00229/sg" },
    { label: "D.L. 3/2020 art. 1 (trattamento integrativo), consolidated", url: "https://www.normattiva.it/eli/id/2020/02/05/20G00013/CONSOLIDATED" },
    { label: "MEF: regional surcharge rates 2026, by region", url: "https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/addregirpef/sceltaregione.htm" },
    { label: "MEF: municipal surcharge rates, by council", url: "https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/nuova_addcomirpef/sceltaregione.htm" },
    { label: "Regione Piemonte: addizionale regionale IRPEF (due only when net IRPEF is)", url: "https://www.regione.piemonte.it/web/temi/tributi/addizionali-regionali/addizionale-regionale-allirpef" },
    { label: "INPS: 2026 employee contribution limits, circular 6/2026", url: "https://www.inps.it/it/it/inps-comunica/notizie/dettaglio-news-page.news.2026.02.lavoratori-dipendenti-limite-minimo-di-retribuzione-giornaliera-2026.html" },
  ],
  caveats: [
    "Regional surcharges use the 2026 rates of Piemonte, Lombardia, Emilia-Romagna, Toscana, Lazio, Campania and Basilicata, and municipal surcharges those of Torino, Milano, Bologna, Firenze, Roma and Napoli; elsewhere a typical 1.73% regional and 0.8% municipal rate is assumed. Regional deductions for dependent children are not applied.",
    "INPS assumes the ordinary private-sector 9.19% employee rate and first compulsory coverage after 1995: the base is capped at €122,295, with an extra 1% above €56,224. Earlier completeness normally has no annual ceiling; completeness history and sector-specific rates are not inputs.",
    "No dependants, no deductible expenses other than a supplementary pension contribution, no family credits. The trattamento integrativo assumes a full year of work.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const pensionable = Math.min(g, INPS_CEILING);
    const inps = pensionable * INPS_EMPLOYEE + Math.max(0, pensionable - INPS_EXTRA_THRESHOLD) * INPS_EXTRA;
    const work = g - inps; // reddito di lavoro dipendente
    const flat = input.tweak?.flatRate !== undefined;
    // Reddito complessivo leaves out the tax-free share of a newcomer regime; the pension deduction (oneri deducibili)
    // then comes off it to give taxable income (src/tax/common.ts taxedBase), which IRPEF and the surcharges are levied on.
    const complessivo = work * (input.tweak?.taxableShare ?? 1);
    const lorda = incomeTax(work, input.tweak, (t) => progressive(t, IRPEF_2026));
    // The cuneo fiscale counts the tax-free share of the impatriati and researcher regimes as income (L. 207/2024
    // art. 1 c. 9, https://www.gazzettaufficiale.it/eli/id/2024/12/31/24G00229/sg), so its thresholds read the whole of
    // pay; the sum is then paid on the taxed part only (Circolare 4/E 2025, section 1.2).
    const c = cuneo(work, complessivo);
    const detrazione = flat ? 0 : detrazioneLavoro(complessivo);
    const irpef = Math.max(0, lorda - detrazione - (flat ? 0 : c.extraCredit));
    // Trattamento integrativo: up to €15,000 of income, when gross tax exceeds the employment credit less €75
    // (D.L. 3/2020 art. 1 c. 1, https://www.normattiva.it/eli/id/2020/02/05/20G00013/CONSOLIDATED). Above €15,000 it
    // needs credits larger than the tax, which a single employee with no other credits does not have. Its income test
    // counts the tax-free share of the researcher and 2015 impatriati regimes (D.L. 3/2020 art. 3 c. 2), so it reads
    // the whole of employment income, like the cuneo.
    const integrativeWould = !flat && complessivo <= INTEGRATIVE.upTo && lorda > detrazione - INTEGRATIVE.allowance;
    const integrative = integrativeWould && work <= INTEGRATIVE.upTo ? INTEGRATIVE.amount : 0;
    // The surcharges are due only when net IRPEF is (Regione Piemonte, addizionale regionale: "è dovuta se, per lo
    // stesso anno, risulta dovuta l'IRPEF, al netto delle detrazioni"; D.Lgs. 360/1998 art. 1 c. 4 for the municipal one).
    const due = irpef > 0;
    const regionRule = (input.region && REGIONAL[input.region]) || DEFAULT_REGIONAL;
    const regionalBase = taxedShare(work, input.tweak);
    const regional = due ? regionalSurcharge(regionalBase, regionRule) : 0;
    const known = input.city ? MUNICIPAL[input.city] : undefined;
    const mun = known ?? { bands: DEFAULT_MUNICIPAL };
    const municipal = !due || (mun.exemptUpTo !== undefined && regionalBase <= mun.exemptUpTo) ? 0 : progressive(regionalBase, mun.bands);
    const lines = [
      { label: "INPS contributions (employee)", amount: inps },
      { label: flat ? "IRPEF income tax (your flat rate)" : "IRPEF income tax, after credits", amount: irpef },
      { label: `Regional surcharge (${regionRule.name})`, amount: regional },
      { label: "Municipal surcharge", amount: municipal },
    ];
    if (c.exemptSum > 0) lines.push({ label: "Cuneo fiscale tax-free sum (received)", amount: -c.exemptSum });
    if (integrative > 0) lines.push({ label: "Trattamento integrativo (received)", amount: -integrative });
    const approximations = [
      // Art. 3 c. 2 names the researcher (D.L. 78/2010) and 2015 impatriati (D.Lgs. 147/2015) regimes, not the 2024 one
      // (D.Lgs. 209/2023 art. 5): for that one the whole of pay is read too, which can leave out €1,200.
      ...(integrativeWould && !integrative ? ["The trattamento integrativo is not counted: its income test is read on the whole of pay, the tax-free share included, as the law says for the researcher and 2015 impatriati regimes; for the 2024 impatriati regime the law does not say, and it may be due."] : []),
      ...(regionRule === DEFAULT_REGIONAL ? ["The regional surcharge uses a typical 1.73%; this region's own rates are not modelled."] : []),
      ...(known ? [] : ["The municipal surcharge uses a typical 0.8% with no exemption; this council's own rate is not modelled."]),
    ];
    return finish(this, g, lines, tweakCaveats(input.tweak), completenessOf([], approximations));
  },
};
