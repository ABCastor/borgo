import { completenessOf, finish, incomeTax, progressive, tweakCaveats, type Bands, type Completeness, type TaxInput, type TaxModel } from "./common.ts";

// Spain (common regime), employee resident for tax, 2026. IRPF is split into a state half and a regional half,
// each with its own scale and personal minimum.

const STATE: Bands = [
  [12_450, 0.095],
  [20_200, 0.12],
  [35_200, 0.15],
  [60_000, 0.185],
  [300_000, 0.225],
  [Infinity, 0.245],
];
const STATE_MINIMUM = 5_550; // art. 57 LIRPF

interface Region {
  name: string;
  bands: Bands;
  minimum: number;
}

const REGIONS: Record<string, Region> = {
  "ES-MD": {
    name: "Madrid",
    bands: [
      [13_362.22, 0.085],
      [19_004.63, 0.107],
      [35_425.68, 0.128],
      [57_320.4, 0.174],
      [Infinity, 0.205],
    ],
    minimum: 5_956.65,
  },
  "ES-CT": {
    name: "Catalonia",
    bands: [
      [12_500, 0.095],
      [22_000, 0.125],
      [33_000, 0.16],
      [53_000, 0.19],
      [90_000, 0.215],
      [120_000, 0.235],
      [175_000, 0.245],
      [Infinity, 0.255],
    ],
    minimum: 5_550,
  },
  "ES-VC": {
    name: "Valencian Community",
    // 2026 scale, Ley 5/2026 art. 18; a slightly lower one applies from 2027
    bands: [
      [12_000, 0.088],
      [22_000, 0.117],
      [32_000, 0.146],
      [42_000, 0.17],
      [52_000, 0.194],
      [62_000, 0.219],
      [72_000, 0.244],
      [100_000, 0.261],
      [150_000, 0.2735],
      [200_000, 0.2835],
      [Infinity, 0.2935],
    ],
    minimum: 6_105,
  },
  "ES-AN": {
    name: "Andalusia",
    bands: [
      [13_000, 0.095],
      [21_100, 0.12],
      [35_200, 0.15],
      [60_000, 0.185],
      [Infinity, 0.225],
    ],
    minimum: 5_790,
  },
};
// Regions without a module here are assumed to mirror the state half.
const DEFAULT_REGION: Region = { name: "regional (assumed)", bands: STATE, minimum: STATE_MINIMUM };
/** The Basque Country and Navarre levy their own income tax (concierto and convenio económico): none of this applies. */
const FORAL: Record<string, string> = { "ES-PV": "Basque Country", "ES-NC": "Navarre" };


// Social security, general scheme, permanent contract: common contingencies 4.70%, unemployment 1.55%,
// vocational training 0.10%, intergenerational equity (MEI) 0.15%.
const SS_EMPLOYEE = 0.047 + 0.0155 + 0.001 + 0.0015;
const MAX_BASE = 5_101.2 * 12;
// Solidarity contribution on pay above the maximum base (2026 rates), in bands of the excess (up to 10%, 10-50%,
// above 50% of the base), shared like common contingencies (4.70 of 28.30).
const SOLIDARITY: Bands = [
  [MAX_BASE * 0.1, 0.0115],
  [MAX_BASE * 0.5, 0.0125],
  [Infinity, 0.0146],
];
const EMPLOYEE_SHARE_OF_COMMON = 4.7 / 28.3;

const OTHER_EXPENSES = 2_000; // art. 19.2.f LIRPF

/** Art. 20 LIRPF: reduction for low earned income, on net pay after contributions. */
export function workReduction(net: number): number {
  if (net <= 14_852) return 7_302;
  if (net <= 17_673.52) return 7_302 - 1.75 * (net - 14_852);
  if (net <= 19_747.5) return 2_364.34 - 1.14 * (net - 17_673.52);
  return 0;
}

/** DA 61 LIRPF as amended for 2026 (RDL 5/2026): credit for earners near the minimum wage, on gross pay. */
export function minimumWageCredit(gross: number): number {
  if (gross <= 17_094) return 590.89;
  if (gross < 20_048.45) return 590.89 - 0.2 * (gross - 17_094);
  return 0;
}

/** A half's tax: the scale on the base minus the scale on the part of the base covered by the personal minimum. */
export function half(base: number, bands: Bands, minimum: number): number {
  return Math.max(0, progressive(base, bands) - progressive(Math.min(base, minimum), bands));
}

export function socialSecurity(gross: number): number {
  return Math.min(gross, MAX_BASE) * SS_EMPLOYEE + progressive(Math.max(0, gross - MAX_BASE), SOLIDARITY) * EMPLOYEE_SHARE_OF_COMMON;
}

/** Taxable base for a wages-only employee: gross less contributions, the flat €2,000 and the art. 20 reduction. */
export function taxableBase(gross: number, ss: number): number {
  const net = gross - ss;
  return Math.max(0, net - Math.min(OTHER_EXPENSES, Math.max(0, net)) - workReduction(net));
}

export const spain: TaxModel = {
  country: "ES",
  year: 2026,
  currency: "EUR",
  scope:
    "Employee resident in Spain (common regime): IRPF state and regional halves (Madrid, Catalonia, Valencian Community, Andalusia), personal minimum, work-income reductions, minimum-wage credit, social security.",
  sources: [
    { label: "BOE: Ley 35/2006 del IRPF, consolidated (arts. 19, 20, 57, 63; DA 61 as amended by RDL 5/2026)", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764" },
    { label: "BOE: Comunidad de Madrid, Decreto Legislativo 1/2010, arts. 1-2 (scale and minimum)", url: "https://www.boe.es/buscar/act.php?id=BOCM-m-2010-90068" },
    { label: "BOE: Catalunya, Decreto Legislativo 1/2024 (Codi tributari, llibre sisè), arts. 611-1 and 611-2", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2024-6951" },
    { label: "BOE: Comunitat Valenciana, Ley 13/1997, arts. 2 and 2 bis (2026 scale from Ley 5/2026)", url: "https://www.boe.es/buscar/act.php?id=BOE-A-1998-8202" },
    { label: "BOE: Andalucía, Ley 5/2021 de Tributos Cedidos, arts. 23 and 23 bis", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2021-17915" },
    { label: "Seguridad Social: bases y tipos de cotización 2026", url: "https://www.seg-social.es/wps/portal/wss/internet/Trabajadores/CotizacionRecaudacionTrabajadores/36537" },
    { label: "BOE: Ley General de la Seguridad Social, DT 42 (solidarity) and DT 43 (MEI)", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2015-11724" },
    { label: "AEAT: Manual práctico de Renta 2025, worked example of the state and regional quotas", url: "https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c15-calculo-impuesto-determinacion-cuotas-integras/ejemplo-practico-calculo-cuotas-integras-autonomica.html" },
  ],
  caveats: [
    "Regional halves are exact for Madrid, Catalonia, the Valencian Community and Andalusia; other regions are assumed to mirror the state half. Basque Country and Navarre have their own systems and are not modelled.",
    "Social security assumes a permanent contract, contributions at actual pay up to the 2026 maximum base (€5,101.20 a month), pay spread evenly over the months.",
    "No regional credits (rent, age, children) and no family minimums. A personal pension plan contribution, set as your pension share, reduces the taxable base within the art. 51-52 limits.",
    "Newcomers: under the special regime (art. 93 LIRPF, the 'Beckham law') a flat-rate setting taxes the whole of gross pay at 24% up to €600,000 and 47% above, with no social security deduction, no work-income reduction, no personal minimum, no pension reduction and no regional half.",
  ],
  compute(input: TaxInput) {
    const g = input.gross;
    const foral = input.region ? FORAL[input.region] : undefined;
    const region = (input.region && REGIONS[input.region]) || DEFAULT_REGION;
    const ss = socialSecurity(g);
    const completeness: Completeness = foral
      ? { status: "unsupported", missing: [`${foral}'s own income tax`], approximations: [] }
      : completenessOf([], region === DEFAULT_REGION ? ["The regional half of IRPF uses the state scale; this region's own scale is not modelled."] : []);
    if (input.tweak?.flatRate !== undefined) {
      // Art. 93.2 LIRPF applies the non-resident income tax rules: the base is the whole of gross employment income,
      // with nothing deducted (https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#a93). The rate replaces every
      // layer; the es-beckham regime blends its 24% and 47% bands into one rate for the gross (src/tax/regimes.ts).
      const pay = g * (input.tweak.taxableShare ?? 1);
      const tax = Math.max(0, pay * input.tweak.flatRate);
      const lines = [
        { label: "Social security (employee)", amount: ss },
        { label: "Income tax (special regime, on gross pay)", amount: tax },
      ];
      const extra = input.tweak.pretaxDeduction ? ["Under the special regime a pension plan contribution does not reduce the tax."] : [];
      return finish(this, g, lines, [...extra, ...tweakCaveats(input.tweak)], completeness);
    }
    const base = taxableBase(g, ss);
    const state = incomeTax(base, input.tweak, (t) => half(t, STATE, STATE_MINIMUM));
    const regional = incomeTax(base, input.tweak, (t) => half(t, region.bands, region.minimum));
    const credit = Math.min(minimumWageCredit(g), state + regional);
    const lines = [
      { label: "Social security (employee)", amount: ss },
      { label: "IRPF state half", amount: state },
      { label: `IRPF regional half (${region.name})`, amount: regional },
    ];
    if (credit > 0) lines.push({ label: "Minimum-wage earner credit", amount: -credit });
    return finish(this, g, lines, tweakCaveats(input.tweak), completeness);
  },
};
