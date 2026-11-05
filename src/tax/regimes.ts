// Newcomer tax regimes: what a country offers people who move there to work, kept apart from the country modules.
// A regime is data: who qualifies (conditions a person's facts can check, or that the person confirms) and what it
// does to their pay (a tax-free share, or a flat rate). It reaches a country module only as the TaxTweak every module
// already accepts, and only when the person switches it on (IncomePlan.regimes): no regime ever counts by default. A
// regime switched on counts as established when every condition is met by the person's facts and answers, and as a
// scenario while some are still theirs to confirm; a fact that rules it out keeps it off. Figures describe 2026.

import type { Iso2, NewcomerFacts, TaxTweak } from "../core/types.ts";

export type Verdict = "met" | "not met" | "confirm";

/** A condition is machine-checkable where the facts allow, otherwise the person confirms it. Every condition has an id and a plain sentence. */
export type Condition = { id: string; text: string } & (
  | { kind: "notResidentFor"; years: number; /** "in at least `years` of the last `window` years": a shorter gap then needs the person to confirm. */ window?: number }
  | { kind: "minSalary"; /** Annual gross, in the regime's currency. */ amount: number }
  | { kind: "maxAge"; under: number }
  | { kind: "minorChild" }
  | { kind: "notCitizen" }
  | { kind: "citizenOf"; countries: Iso2[] }
  | { kind: "confirm" }
  | { kind: "anyOf"; options: Condition[] }
  | { kind: "allOf"; options: Condition[] }
);

/**
 * What a regime does to the pay it covers. Either a tax-free part of pay, worked out as
 *   exempt = share × (min(gross, exemptIncomeCap) − exemptAbove), then at most exemptMax, and never below keepTaxable of taxable pay,
 * or a flat rate in place of the income tax schedule.
 */
export interface RegimeEffect {
  exemptShare?: number;
  /** Pay above this does not count towards the exemption (Italy €600k, Netherlands €262k, Ireland €1m). */
  exemptIncomeCap?: number;
  /** Only pay above this counts towards the exemption (Ireland: 30% of pay between €125k and €1m). */
  exemptAbove?: number;
  /** The exempt amount never exceeds this (Poland PLN 85,528). */
  exemptMax?: number;
  /** At least this much pay stays taxable: the salary floor the tax-free part may not eat into (Netherlands, Belgium). */
  keepTaxable?: number;
  flatRate?: number;
  /** A higher flat rate above a threshold (Spain: 47% above €600k). Applied as one blended rate on the person's gross. */
  flatRateAbove?: { from: number; rate: number };
  /** What the flat rate replaces: the national schedule, or every income-tax layer. */
  flatRateScope?: "national" | "all";
}

export interface Regime {
  id: string;
  country: Iso2;
  name: string;
  /** One plain sentence. */
  summary: string;
  /** The year the figures describe. */
  asOf: number;
  currency: string;
  conditions: Condition[];
  /** How many years it lasts at most. */
  years: number;
  effect: RegimeEffect;
  sources: { label: string; url: string }[];
  caveats: string[];
}

/** EU and EEA states plus Switzerland, for conditions tied to European citizenship. */
const EU_EEA_CH: Iso2[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "CH",
];

const confirm = (id: string, text: string): Condition => ({ id, text, kind: "confirm" });

// ---------- Netherlands ----------

const NL_SOURCES = [
  { label: "Belastingdienst: Expat Scheme (30% facility) conditions", url: "https://www.belastingdienst.nl/wps/wcm/connect/en/individuals/content/coming-to-work-in-the-netherlands-30-percent-facility" },
  { label: "Belastingdienst: content of the expat scheme, 2026 maximum", url: "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/internationaal/personeel/u_bent_niet_in_nederland_gevestigd_loonheffingen_inhouden/als_u_loonheffingen_gaat_inhouden/extraterritoriale_kosten_en_de_30procentregeling/inhoud_van_de_regeling/inhoud_van_de_regeling" },
  { label: "Rijksoverheid: expat scheme becomes 27% from 2027", url: "https://www.rijksoverheid.nl/themas/werk/inkomstenbelasting/belastingvoordeel-buitenlandse-werknemers" },
];
const NL_COMMON: Condition[] = [
  confirm("nl-recruited-abroad", "Your employer recruited you from outside the Netherlands and runs Dutch payroll for you."),
  confirm("nl-150km", "For more than 16 of the 24 months before your first working day you lived over 150 km from the Dutch border (so not in Belgium, Luxembourg or nearby Germany, France or the UK)."),
];
const NL_CAVEATS = [
  "Up to 30% in 2025 and 2026; from 2027 at most 27% for people who started in 2024 or later, with a higher salary threshold for those who started from 2025.",
  "Your employer decides whether to pay the full 30%; the allowance can be lower. We assume the full allowance, carved out of the gross you entered.",
  "The five years shrink by any earlier time you worked or lived in the Netherlands in the last 25 years.",
  "The tax-free allowance is capped at €78,600 (30% of €262,000) for a full year.",
];
const NL_EFFECT = (floor: number): RegimeEffect => ({ exemptShare: 0.3, exemptIncomeCap: 262_000, keepTaxable: floor });

// ---------- Belgium ----------

const BE_SOURCES = [
  { label: "Moniteur belge: programme law of 27 December 2021, art. 13-14 (CIR 92 art. 32/1 and 32/2)", url: "https://www.ejustice.just.fgov.be/eli/loi/2021/12/27/2021043625/moniteur" },
  { label: "Moniteur belge: law of 18 December 2025, art. 15-18 (35%, €70,000, no cap, from 2025)", url: "https://www.ejustice.just.fgov.be/cgi/article_body.pl?language=fr&caller=summary&pub_date=2025-12-30&numac=2025009647" },
  { label: "SPF Finances: inpatriate researchers and taxpayers (forms)", url: "https://fin.belgium.be/en/private-individuals/international/living-and-working-belgium-abroad/inpatriate-researchers-taxpayers" },
];
const BE_COMMON: Condition[] = [
  { id: "be-not-resident", text: "You were not resident in Belgium in the 60 months before the month you started.", kind: "notResidentFor", years: 5 },
  confirm("be-150km", "In those 60 months you did not live within 150 km of the Belgian border, and you paid no Belgian non-resident tax on work income."),
  confirm("be-recruited-abroad", "You were recruited directly from abroad by a Belgian company or association, or a foreign company of your multinational group put you at the disposal of its Belgian entity."),
  confirm("be-apply", "Your employer applies within 3 months of your first day, with your signed certificate attached."),
];
const BE_CAVEATS = [
  "We read your gross as the whole package, the allowance included: up to 35/135 of it (35% of the salary on top) is tax-free.",
  "The allowance is also free of Belgian social security contributions; country models still charge them on the whole gross.",
  "Five years, extended by three if your employer asks within 3 months of the fifth year's end and the conditions still hold. Since 2025 there is no €90,000 cap.",
  "Moving, home set-up (up to €1,500) and private school fees can also be paid tax-free; not modelled.",
];

// ---------- Italy ----------

const IT_SOURCES = [
  { label: "D.Lgs. 209/2023 art. 5 (in force text, Normattiva)", url: "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2023-12-27;209~art5" },
];
const IT_COMMON: Condition[] = [
  {
    id: "it-not-resident",
    text: "You were not tax resident in Italy in the 3 tax years before the move (6 if you keep working for the same employer or group you worked for abroad, 7 if you had worked for it in Italy before).",
    kind: "notResidentFor",
    years: 3,
  },
  confirm("it-qualified", "You are highly qualified or specialised (a degree-level qualification, as for the EU Blue Card), or you have done research in artificial intelligence."),
  confirm("it-mainly-italy", "You work in Italy for most of each tax year."),
  confirm("it-stay-4", "You commit to stay tax resident in Italy for at least 4 years; leaving earlier means paying the benefit back with interest."),
];
const IT_CAVEATS = [
  "Only pay up to €600,000 a year is halved; INPS contributions are still due on all of it.",
  "The old 2019 regime's extra relief for moving to the South no longer exists for people moving from 2024.",
];

export const REGIMES: Regime[] = [
  {
    id: "nl-expat",
    country: "NL",
    name: "Expat scheme (30% ruling)",
    summary: "Your employer may pay up to 30% of your salary tax-free for up to five years, if you were recruited from abroad and earn above the expertise threshold.",
    asOf: 2026,
    currency: "EUR",
    conditions: [{ id: "nl-salary", text: "Your salary, not counting the tax-free part, is more than €48,013 a year.", kind: "minSalary", amount: 48_013 }, ...NL_COMMON],
    years: 5,
    effect: NL_EFFECT(48_013),
    sources: NL_SOURCES,
    caveats: NL_CAVEATS,
  },
  {
    id: "nl-expat-young-master",
    country: "NL",
    name: "Expat scheme (30% ruling), under 30 with a master's",
    summary: "The same expat scheme with a lower salary threshold for people under 30 with a Dutch or equivalent master's degree.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      { id: "nl-under-30", text: "You are under 30.", kind: "maxAge", under: 30 },
      confirm("nl-master", "You hold a Dutch academic master's degree or an equivalent foreign one."),
      { id: "nl-salary-young", text: "Your salary, not counting the tax-free part, is more than €36,497 a year.", kind: "minSalary", amount: 36_497 },
      ...NL_COMMON,
    ],
    years: 5,
    effect: NL_EFFECT(36_497),
    sources: NL_SOURCES,
    caveats: NL_CAVEATS,
  },
  {
    id: "nl-expat-research",
    country: "NL",
    name: "Expat scheme (30% ruling), researchers and doctors in training",
    summary: "The same expat scheme with no salary threshold for scientific researchers at designated institutions and doctors training as specialists.",
    asOf: 2026,
    currency: "EUR",
    conditions: [confirm("nl-researcher", "You do scientific research at a designated research institution, or you are a doctor training to become a specialist."), ...NL_COMMON],
    years: 5,
    effect: NL_EFFECT(0),
    sources: NL_SOURCES,
    caveats: NL_CAVEATS,
  },
  {
    id: "pt-ifici",
    country: "PT",
    name: "IFICI (\"NHR 2.0\")",
    summary: "Portuguese pay from an eligible research, innovation or highly qualified job is taxed at a flat 20% for ten years.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      { id: "pt-not-resident", text: "You were not tax resident in Portugal in any of the 5 years before.", kind: "notResidentFor", years: 5 },
      confirm(
        "pt-eligible-job",
        "Your job is on the IFICI list: higher-education teaching or scientific research, R&D or qualified jobs in companies with contractual investment benefits or recognised technology centres, highly qualified professions (Portaria 352/2024 annex) in industrial or exporting companies, certified start-ups, and a few others.",
      ),
      confirm("pt-qualification", "You have the qualification your path asks for: for the highly qualified professions, a doctorate, or a bachelor's or master's with three years of proven experience."),
      confirm("pt-no-nhr", "You never used the old NHR regime, IFICI or the Programa Regressar."),
      confirm("pt-register", "You register on the Portal das Finanças by 15 January of the year after you become resident."),
    ],
    years: 10,
    effect: { flatRate: 0.2, flatRateScope: "national" },
    sources: [
      { label: "Autoridade Tributária: IFICI information leaflet", url: "https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/Folhetos_informativos/Documents/incentivos_investigacao.pdf" },
      { label: "Portaria 352/2024/1 (eligible professions and entities)", url: "https://diariodarepublica.pt/dr/detalhe/portaria/352-2024-901014291" },
    ],
    caveats: [
      "Social security (11%) is still due on the whole salary.",
      "Most foreign income is also exempt under IFICI; this model covers Portuguese pay only.",
      "Using IFICI rules out IRS Jovem, the youth regime, for good.",
    ],
  },
  {
    id: "es-beckham",
    country: "ES",
    name: "Special regime for workers moving to Spain (Beckham law)",
    summary: "Spanish pay is taxed at a flat 24% up to €600,000 (47% above), instead of the state and regional schedules, for the year you move and the next five.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      { id: "es-not-resident", text: "You were not resident in Spain in the 5 tax years before the move.", kind: "notResidentFor", years: 5 },
      confirm(
        "es-reason",
        "You move because of a job with a Spanish employer (or one that posts you, or remote work on the international telework visa), to become director of a company, to run an approved innovative business, or as a highly qualified professional for a start-up or in R&D.",
      ),
      confirm("es-no-pe", "You earn nothing through a permanent establishment in Spain (outside the entrepreneur and start-up cases)."),
      confirm("es-apply", "You file form 149 within 6 months of starting work."),
    ],
    years: 6,
    effect: { flatRate: 0.24, flatRateAbove: { from: 600_000, rate: 0.47 }, flatRateScope: "all" },
    sources: [{ label: "BOE: Ley 35/2006 del IRPF, art. 93 (consolidated text, updated 7 Oct 2026)", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#a93" }],
    caveats: [
      "You are taxed under non-resident rules: no personal allowance, family reliefs or deductions.",
      "Social security is still due. Foreign income other than pay is mostly not taxed in Spain; wealth tax applies to Spanish assets only.",
      "Above €600,000 the 24%/47% split is applied as one blended rate on your gross.",
    ],
  },
  {
    id: "it-impatriati",
    country: "IT",
    name: "Impatriati (workers moving to Italy)",
    summary: "Half of your Italian pay, up to €600,000 a year, is taxed for the year you move and the next four.",
    asOf: 2026,
    currency: "EUR",
    conditions: IT_COMMON,
    years: 5,
    effect: { exemptShare: 0.5, exemptIncomeCap: 600_000 },
    sources: IT_SOURCES,
    caveats: IT_CAVEATS,
  },
  {
    id: "it-impatriati-child",
    country: "IT",
    name: "Impatriati with a child",
    summary: "If you move with a child under 18 (or have or adopt one during the regime), only 40% of your Italian pay, up to €600,000 a year, is taxed.",
    asOf: 2026,
    currency: "EUR",
    conditions: [...IT_COMMON, { id: "it-minor-child", text: "You move to Italy with a child under 18 who lives in Italy, or a child is born or adopted while the regime runs.", kind: "minorChild" }],
    years: 5,
    effect: { exemptShare: 0.6, exemptIncomeCap: 600_000 },
    sources: IT_SOURCES,
    caveats: [...IT_CAVEATS, "For a child born or adopted later, the 60% applies from that year to the end of the five."],
  },
  {
    id: "fr-impatries",
    country: "FR",
    name: "Impatriés (art. 155 B CGI)",
    summary: "If you are recruited from abroad, 30% of your pay can be left out of income tax until the end of the eighth year after you start.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      { id: "fr-not-resident", text: "You were not tax resident in France in the 5 calendar years before you took up the job.", kind: "notResidentFor", years: 5 },
      confirm("fr-recruited-abroad", "A French employer recruited you directly from abroad, or a foreign group sent you to its French company."),
      confirm("fr-comparable-pay", "The taxable rest of your pay is at least what colleagues in comparable roles earn."),
    ],
    years: 8,
    effect: { exemptShare: 0.3 },
    sources: [
      { label: "BOFiP: BOI-RSA-GEO-40-10-20 (flat 30% option, 50% cap)", url: "https://bofip.impots.gouv.fr/bofip/5677-PGP.html/identifiant=BOI-RSA-GEO-40-10-20-20250811" },
      { label: "BOFiP: BOI-RSA-GEO-40-10-10 (who qualifies)", url: "https://bofip.impots.gouv.fr/bofip/5680-PGP.html/identifiant=BOI-RSA-GEO-40-10-10-20170621" },
    ],
    caveats: [
      "Uses the flat 30% option; a larger impatriation bonus written into your contract can be exempt instead.",
      "Income tax only: CSG, CRDS and social contributions are due on all pay. Days worked abroad can add a further exemption (not modelled), within a 50% overall cap.",
    ],
  },
  {
    id: "be-impatriate",
    country: "BE",
    name: "Special regime for impatriate taxpayers",
    summary: "Your employer may pay up to 35% on top of your salary as tax-free expenses for five years, extendable by three, if you were recruited from abroad and earn more than €70,000.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      { id: "be-salary", text: "Your gross salary from the Belgian employer, not counting the allowance, is more than €70,000 a year.", kind: "minSalary", amount: 70_000 },
      ...BE_COMMON,
      confirm("be-not-owner", "If you are a company director, you did not found the company and hold less than 30% of its capital."),
    ],
    years: 8,
    effect: { exemptShare: 0.35 / 1.35, keepTaxable: 70_000 },
    sources: BE_SOURCES,
    caveats: [...BE_CAVEATS, "The €70,000 must still be met for the three-year extension; the law lets it be indexed every three years."],
  },
  {
    id: "be-impatriate-researcher",
    country: "BE",
    name: "Special regime for impatriate researchers",
    summary: "The same tax-free allowance of up to 35% for salaried researchers, with no salary threshold, for five years extendable by three.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      confirm(
        "be-researcher",
        "You are an employee spending at least 80% of your time on scientific research in an R&D programme, with a doctorate or a master's in exact or applied sciences, engineering, medicine, veterinary or pharmaceutical science, architecture or agricultural industrial science, or 10 years of relevant experience.",
      ),
      ...BE_COMMON,
    ],
    years: 8,
    effect: { exemptShare: 0.35 / 1.35 },
    sources: BE_SOURCES,
    caveats: BE_CAVEATS,
  },
  {
    id: "dk-researcher",
    country: "DK",
    name: "Researcher and key employee scheme",
    summary: "Your Danish salary is taxed at a flat 27% plus the 8% labour market contribution (32.84% in all) for up to seven years in your lifetime.",
    asOf: 2026,
    currency: "DKK",
    conditions: [
      {
        id: "dk-not-liable",
        text: "You have not been liable to tax in Denmark in the last 10 years, as a resident or on Danish pay (income from Danish property, dividends or royalties does not count).",
        kind: "notResidentFor",
        years: 10,
      },
      {
        id: "dk-path",
        text: "You earn a guaranteed DKK 65,400 a month or more (2026), or you are an approved researcher.",
        kind: "anyOf",
        options: [
          { id: "dk-salary", text: "A guaranteed monthly salary of at least DKK 65,400 plus ATP (DKK 784,800 a year), bonuses that are not fixed excluded.", kind: "minSalary", amount: 784_800 },
          confirm("dk-approved-researcher", "You are a researcher with at least a PhD, and your qualifications and position are approved (by the university or institute, otherwise by the Independent Research Fund Denmark within a month of starting)."),
        ],
      },
      confirm("dk-employer", "Your employer withholds Danish A-tax: a Danish public institution, fund or association, a company fully liable to Danish tax, or a foreign company with a Danish permanent establishment."),
      confirm("dk-not-management", "You are not, and were not in the 5 years before, part of the management of that business, directly or indirectly."),
      confirm("dk-move", "You may work and live in Denmark, and you move there no sooner than 1 month before your first working day."),
    ],
    years: 7,
    effect: { flatRate: 0.27, flatRateScope: "all" },
    sources: [
      { label: "Skattestyrelsen: tax scheme for researchers (conditions, 10-year rule, DKK 65,400 in 2026)", url: "https://skat.dk/en-us/businesses/employees-and-pay/non-danish-labour/tax-scheme-for-researchers" },
      { label: "Skattestyrelsen: forskerskatteordningen, in Danish (DKK 67,300 in 2027; not re-read in October 2026)", url: "https://skat.dk/erhverv/ansatte-og-loen/udenlandsk-arbejdskraft/forskerskatteordningen" },
    ],
    caveats: [
      "No deductions or allowances apply to the scheme pay; other income is taxed normally.",
      "The salary threshold must be met as a yearly average for as long as the scheme runs, and is indexed every year.",
      "The seven years are once in a lifetime and may be split into several periods.",
      "Never having lived in Denmark is not enough: working there with limited tax liability in the last 10 years also rules you out (short guest lectures excepted).",
    ],
  },
  {
    id: "se-expert",
    country: "SE",
    name: "Expert tax relief (expertskatt)",
    summary: "A quarter of your Swedish pay is tax-free for seven years if you earn more than 1.5 price base amounts a month or are an approved expert.",
    asOf: 2026,
    currency: "SEK",
    conditions: [
      { id: "se-not-citizen", text: "You are not a Swedish citizen.", kind: "notCitizen" },
      { id: "se-not-resident", text: "You did not live in Sweden at any time in the 5 calendar years before the year your work starts.", kind: "notResidentFor", years: 5 },
      {
        id: "se-path",
        text: "You earn more than SEK 88,800 a month (work starting in 2026), or the board approves you as an expert, researcher or key person.",
        kind: "anyOf",
        options: [
          { id: "se-salary", text: "Monthly pay of at least SEK 88,801 (SEK 1,065,612 a year).", kind: "minSalary", amount: 1_065_612 },
          confirm("se-approved-expert", "The Taxation of Research Workers Board accepts you as an expert, researcher or other key person."),
        ],
      },
      confirm("se-employer-apply", "Your employer is Swedish (or has a permanent establishment here), you intend to stay at most seven years, and the application goes in within 3 months of starting."),
    ],
    years: 7,
    effect: { exemptShare: 0.25 },
    sources: [
      { label: "Forskarskattenämnden: about tax relief", url: "https://forskarskattenamnden.se/andra-sprak/taxation-of-research-workers-board/about-tax-relief" },
      { label: "Forskarskattenämnden: remuneration rate (SEK 88,801 in 2026)", url: "https://forskarskattenamnden.se/andra-sprak/taxation-of-research-workers-board/conditions-for-tax-relief/remuneration-rate" },
      { label: "Regeringen: lagrådsremiss June 2026 (30% from 2027, proposed)", url: "https://www.regeringen.se/rattsliga-dokument/lagradsremiss/2026/06/skatteincitament-for-forskning-och-utveckling/" },
    ],
    caveats: [
      "A government bill proposes from 1 January 2027: 30% instead of 25%, Swedish citizens allowed, 7 instead of 5 years away. Not law when checked (October 2026).",
      "Employer social fees are also charged on 75% of pay only.",
    ],
  },
  {
    id: "fi-key-employee",
    country: "FI",
    name: "Key employee source tax",
    summary: "Your Finnish pay is taxed at a final 25%, instead of state, municipal and church tax, for up to 84 months.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      { id: "fi-not-resident", text: "You were not generally liable to tax in Finland in the 5 calendar years before the year this work starts, and become so when it starts.", kind: "notResidentFor", years: 5 },
      {
        id: "fi-path",
        text: "You earn at least €5,800 a month in a role that needs special expertise, or you teach at a university or do research in the public interest.",
        kind: "anyOf",
        options: [
          {
            id: "fi-salary-expertise",
            text: "At least €5,800 a month in cash pay in a role that needs special expertise.",
            kind: "allOf",
            options: [
              { id: "fi-salary", text: "Cash pay of at least €5,800 a month (€69,600 a year) for the whole period.", kind: "minSalary", amount: 69_600 },
              confirm("fi-expertise", "Your role requires special expertise."),
            ],
          },
          confirm("fi-teacher-researcher", "You teach at a Finnish university or college, or do scientific research in the public interest."),
        ],
      },
    ],
    years: 7,
    effect: { flatRate: 0.25, flatRateScope: "all" },
    sources: [
      { label: "Vero: taxation of key employees (updated for 2026)", url: "https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/106825/avainhenkiloiden-verotus4/" },
    ],
    caveats: [
      "The rate fell from 32% to 25% for pay from 1 January 2026.",
      "Finnish citizens can use it from 2026 too, for 60 months instead of 84.",
      "The 25% also replaces the employee's health insurance contribution; pension and unemployment contributions are still due.",
    ],
  },
  {
    id: "at-researcher",
    country: "AT",
    name: "Allowance for researchers moving to Austria (Zuzugsfreibetrag)",
    summary: "Researchers and scientists whose move is in Austria's public interest get 30% of their research pay tax-free for five years.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      {
        id: "at-not-resident",
        text: "If you lived in Austria before, more than five years passed between moving the centre of your life away and moving back.",
        kind: "notResidentFor",
        years: 5,
      },
      confirm(
        "at-research",
        "Your work is mainly scientific research (research and experimental development, not teaching) in Austria's public interest, and your high qualification is documented. Professors, habilitated researchers in their field at a university or research body, and industrial researchers paid at least the EU Blue Card salary from R&D premium expenses count automatically; otherwise the tax office decides.",
      ),
      confirm("at-move", "You move the centre of your life to an Austrian home from abroad (usually with your partner and minor children)."),
      confirm("at-apply", "You apply to the Finanzamt Österreich within 6 months of the move (form E103)."),
    ],
    years: 5,
    effect: { exemptShare: 0.3 },
    sources: [
      { label: "BMF: Zuzugsbegünstigung", url: "https://www.bmf.gv.at/themen/steuern/arbeitnehmerveranlagung/zuzugsbeguenstigung.html" },
      { label: "RIS: Zuzugsbegünstigungsverordnung 2016", url: "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20009641" },
    ],
    caveats: [
      "Only for researchers and scientists, by decision of the tax office; a doctorate alone or an entry-level post is usually not enough.",
      "With the allowance you cannot also deduct moving-related costs.",
    ],
  },
  {
    id: "gr-5c",
    country: "GR",
    name: "Article 5C: moving your tax residence to Greece",
    summary: "Half of your Greek pay is free of income tax for seven tax years if you move your tax residence to Greece to work there.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      { id: "gr-not-resident", text: "You were not tax resident in Greece in at least 5 of the 6 years before the move.", kind: "notResidentFor", years: 5, window: 6 },
      confirm("gr-from-country", "You move your tax residence from an EU or EEA state, or from a country with a tax cooperation agreement in force with Greece."),
      confirm("gr-job", "You work in Greece as an employee of a Greek company or entity, or of a foreign company's Greek permanent establishment (or you start your own business in Greece)."),
      confirm("gr-stay", "You declare that you will stay in Greece for at least 2 years."),
      confirm("gr-apply", "You apply on myAADE by the end of the year you start work (if you start by 2 July), or by the end of the next year, from which the regime then counts."),
    ],
    years: 7,
    effect: { exemptShare: 0.5 },
    sources: [
      { label: "Ministry of Finance: Income Tax Code (Law 4172/2013) consolidated to Law 5264/2025, art. 5C", url: "https://minfin.gov.gr/wp-content/uploads/2026/04/%CE%9A%CE%A9%CE%94%CE%99%CE%9A%CE%9F%CE%A0%CE%9F%CE%99%CE%97%CE%A3%CE%97-%CE%A4%CE%9F%CE%A5-%CE%9A%CE%A9%CE%94%CE%99%CE%9A%CE%91-%CE%A6%CE%9F%CE%A1%CE%9F%CE%9B%CE%9F%CE%93%CE%99%CE%91%CE%A3-%CE%95%CE%99%CE%A3%CE%9F%CE%94%CE%97%CE%9C%CE%91%CE%A4%CE%9F%CE%A3-%CE%9C%CE%95%CE%A7%CE%A1%CE%99-%CE%A4%CE%9F-%CE%9D-5264-2025.pdf" },
      { label: "AADE: FAQ on applying for article 5C (October 2025)", url: "https://www.aade.gr/sites/default/files/2025-10/FAQS_5G_KFE.pdf" },
    ],
    caveats: [
      "Income tax only: EFKA social contributions are due on all pay.",
      "Seven tax years at most, never extended; it stops from the year you no longer work in Greece or leave, unless you take a new Greek job within 12 months.",
      "Since Law 5222/2025 (July 2025) the job no longer has to be a newly created position.",
    ],
  },
  {
    id: "ie-sarp",
    country: "IE",
    name: "Special Assignee Relief Programme (SARP)",
    summary: "If your employer assigns you to Ireland, 30% of your pay between €125,000 and €1 million is free of income tax for up to five years.",
    asOf: 2026,
    currency: "EUR",
    conditions: [
      { id: "ie-not-resident", text: "You were not tax resident in Ireland in the 5 tax years before the year you arrive.", kind: "notResidentFor", years: 5 },
      { id: "ie-salary", text: "Your base salary is at least €125,000 a year (arrivals from 2026).", kind: "minSalary", amount: 125_000 },
      confirm("ie-assigned", "You worked full time for your employer (or its group) abroad for at least 6 months right before, and it sends you to Ireland for at least 12 months."),
      confirm("ie-certified", "Your employer certifies you to Revenue (form SARP 1A) within 90 days of arrival."),
    ],
    years: 5,
    effect: { exemptShare: 0.3, exemptAbove: 125_000, exemptIncomeCap: 1_000_000 },
    sources: [{ label: "Revenue: Tax and Duty Manual 34-00-10, SARP (March 2026)", url: "https://www.revenue.ie/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-34/34-00-10.pdf" }],
    caveats: ["Income tax only: USC and PRSI are due on all pay.", "Open to arrivals until the end of 2030. Bonuses and benefits do not count towards the €125,000 test."],
  },
  {
    id: "pl-return",
    country: "PL",
    name: "Return relief (ulga na powrót)",
    summary: "Up to PLN 85,528 of your pay a year is free of income tax for four years after you move to Poland.",
    asOf: 2026,
    currency: "PLN",
    conditions: [
      { id: "pl-not-resident", text: "You did not live in Poland in the 3 calendar years before the year you moved, and you moved after 31 December 2021.", kind: "notResidentFor", years: 3 },
      {
        id: "pl-ties",
        text: "You are a Polish, EU, EEA or Swiss citizen or hold the Karta Polaka, or you meet the residence-history route.",
        kind: "anyOf",
        options: [
          { id: "pl-citizen", text: "You are a citizen of Poland, another EU or EEA state, or Switzerland.", kind: "citizenOf", countries: EU_EEA_CH },
          confirm(
            "pl-karta-or-history",
            "You hold the Karta Polaka, or lived without a break for 3 years in the EU, EEA, Switzerland, Australia, Chile, Israel, Japan, Canada, Mexico, New Zealand, South Korea, the UK or the US, or lived in Poland for 5 years before that period.",
          ),
        ],
      },
      confirm("pl-evidence", "You can prove your earlier residence (a certificate of residence) and have never used this relief."),
    ],
    years: 4,
    effect: { exemptShare: 1, exemptMax: 85_528 },
    sources: [{ label: "podatki.gov.pl: ulga na powrót (updated 6 Oct 2026)", url: "https://www.podatki.gov.pl/ulgi-i-odliczenia/ulga-na-powrot-pit" }],
    caveats: ["The PLN 85,528 limit is shared with the other zero-PIT reliefs (under 26, families of 4+, working seniors).", "Social and health contributions are due on all pay."],
  },
];

/** Countries with no regime for newcomers' pay, said plainly, so the absence is a finding and not a gap. */
export const NO_WAGE_REGIME: Record<Iso2, string> = {
  DE: "No special regime for people moving to Germany: pay is taxed on the normal schedule.",
  CZ: "No regime for newcomers' pay in Czechia: the normal 15% and 23% rates apply.",
  HU: "No regime for newcomers' pay in Hungary; its exemptions (under 25, mothers of two or more) do not depend on moving.",
  EE: "No regime for newcomers' pay in Estonia: the normal flat income tax applies.",
  CH: "No lower rate in Switzerland. Executives and specialists posted there for up to five years may deduct some extra costs (moving, double housing, international school) under the Expatriates Ordinance; not modelled.",
  GB: "No regime for UK pay. The FIG regime (from April 2025) exempts foreign income and gains for 4 years after 10 years away, and Overseas Workday Relief can exempt pay for work done abroad; UK work is taxed normally.",
  US: "No federal or state regime for newcomers' pay.",
  CA: "No federal regime for newcomers' pay; Quebec has income tax holidays for some foreign researchers and experts (not modelled).",
  AU: "No regime for Australian pay: temporary residents are taxed normally on it, though most of their foreign income is exempt.",
  JP: "No regime for Japanese pay: non-permanent residents are taxed normally on it; only foreign income not paid into Japan is spared.",
  SG: "No regime for newcomers' pay: the Not Ordinarily Resident scheme ended after the 2020 year of assessment.",
  AE: "No personal income tax at all, so nothing to relieve.",
};

export function regimesFor(country: Iso2): Regime[] {
  return REGIMES.filter((r) => r.country === country);
}

export function regimeById(id: string): Regime | undefined {
  return REGIMES.find((r) => r.id === id);
}

// ---------- Eligibility ----------

/** The facts eligibility is checked against: a person's newcomer facts, passports, and gross pay in the regime's currency. */
export interface RegimeFacts extends NewcomerFacts {
  citizenships?: Iso2[];
  /** Annual gross pay, in the country's currency. */
  gross?: number;
}

export interface ConditionCheck {
  id: string;
  text: string;
  verdict: Verdict;
  /** Why, when a fact decided it. */
  why?: string;
  options?: ConditionCheck[];
}

export interface RegimeCheck {
  regime: Regime;
  /** "eligible": every condition met; "not eligible": one is not; "maybe": the rest is yours to confirm. */
  verdict: "eligible" | "not eligible" | "maybe";
  conditions: ConditionCheck[];
}

function combine(verdicts: Verdict[], rule: "any" | "all"): Verdict {
  if (rule === "any") return verdicts.includes("met") ? "met" : verdicts.includes("confirm") ? "confirm" : "not met";
  return verdicts.includes("not met") ? "not met" : verdicts.includes("confirm") ? "confirm" : "met";
}

export function checkCondition(c: Condition, country: Iso2, f: RegimeFacts, currency: string): ConditionCheck {
  const out = (verdict: Verdict, why?: string): ConditionCheck => ({ id: c.id, text: c.text, verdict, ...(why ? { why } : {}) });
  switch (c.kind) {
    case "notResidentFor": {
      const y = f.yearsSinceResident?.[country];
      if (y === undefined) return out("confirm");
      if (y === "never") return out("met", `never resident in ${country}`);
      if (y >= c.years) return out("met", `last resident ${y} years ago`);
      return out(c.window ? "confirm" : "not met", `last resident ${y} years ago`);
    }
    case "minSalary":
      if (f.gross === undefined) return out("confirm");
      return out(f.gross >= c.amount ? "met" : "not met", `gross ${Math.round(f.gross)} ${currency} against ${c.amount}`);
    case "maxAge":
      if (f.age === undefined) return out("confirm");
      return out(f.age < c.under ? "met" : "not met", `age ${f.age}`);
    case "minorChild": {
      // A child moving with you is a fact; a child born or adopted later is something you confirm.
      if (f.minorChildren !== undefined && f.minorChildren > 0) return out("met", `${f.minorChildren} minor child(ren)`);
      const a = f.confirmed?.[c.id];
      if (a !== undefined) return out(a ? "met" : "not met", "your answer");
      return f.minorChildren === 0 ? out("not met", "no minor children") : out("confirm");
    }
    case "notCitizen":
      if (!f.citizenships?.length) return out("confirm");
      return out(f.citizenships.includes(country) ? "not met" : "met", `passports: ${f.citizenships.join(", ")}`);
    case "citizenOf":
      if (!f.citizenships?.length) return out("confirm");
      return out(f.citizenships.some((x) => c.countries.includes(x)) ? "met" : "not met", `passports: ${f.citizenships.join(", ")}`);
    case "confirm": {
      const a = f.confirmed?.[c.id];
      return a === undefined ? out("confirm") : out(a ? "met" : "not met", "your answer");
    }
    case "anyOf":
    case "allOf": {
      const options = c.options.map((o) => checkCondition(o, country, f, currency));
      return { id: c.id, text: c.text, verdict: combine(options.map((o) => o.verdict), c.kind === "anyOf" ? "any" : "all"), options };
    }
  }
}

/** A regime the person switched on, and how far their facts and answers establish it. */
export interface RegimeChoice {
  regime: Regime;
  /**
   * "established": every condition is met by the person's facts and answers. "scenario": counted because the person
   * asked, with conditions still theirs to confirm; a what-if, never established eligibility. "ruled out": a fact or an
   * answer fails a condition, so it is not counted.
   */
  status: "established" | "scenario" | "ruled out";
  /** Conditions still to confirm, as plain sentences. */
  unconfirmed: string[];
  /** Conditions the facts fail, as plain sentences with why. */
  unmet: string[];
}

/** A condition check with a given verdict, as a sentence with the fact that decided it; a group is said as a whole. */
function sentences(c: ConditionCheck, verdict: Verdict): string[] {
  if (c.verdict !== verdict) return [];
  const why = c.why ?? c.options?.find((o) => o.verdict === verdict && o.why)?.why;
  return [c.text + (why ? ` (${why})` : "")];
}

/**
 * The regime the person switched on in this country ("none", or nothing, means none counts), checked against their
 * facts. Null when no regime is chosen or the id is not one of this country's.
 */
export function chosenRegime(country: Iso2, facts: RegimeFacts, choice: string | undefined): RegimeChoice | null {
  if (!choice || choice === "none") return null;
  const regime = regimeById(choice);
  if (!regime || regime.country !== country) return null;
  const check = checkRegime(regime, country, facts);
  const unmet = check.conditions.flatMap((c) => sentences(c, "not met"));
  const unconfirmed = check.conditions.flatMap((c) => sentences(c, "confirm"));
  const status = check.verdict === "not eligible" ? "ruled out" : check.verdict === "eligible" ? "established" : "scenario";
  return { regime, status, unconfirmed, unmet };
}

function checkRegime(regime: Regime, country: Iso2, facts: RegimeFacts): RegimeCheck {
  const conditions = regime.conditions.map((c) => checkCondition(c, country, facts, regime.currency));
  const all = combine(conditions.map((c) => c.verdict), "all");
  const verdict: RegimeCheck["verdict"] = all === "met" ? "eligible" : all === "not met" ? "not eligible" : "maybe";
  return { regime, verdict, conditions };
}

/** Every regime of a country, each with a verdict per condition, eligible ones first. */
export function eligibleRegimes(country: Iso2, facts: RegimeFacts): RegimeCheck[] {
  const order = { eligible: 0, maybe: 1, "not eligible": 2 } as const;
  return regimesFor(country)
    .map((regime) => checkRegime(regime, country, facts))
    .sort((a, b) => order[a.verdict] - order[b.verdict]);
}

// ---------- Effect ----------

/** The tax-free amount of a given annual gross under an exemption regime. */
export function exemptAmount(e: RegimeEffect, gross: number): number {
  if (!e.exemptShare || gross <= 0) return 0;
  const counted = Math.max(0, Math.min(gross, e.exemptIncomeCap ?? Infinity) - (e.exemptAbove ?? 0));
  const room = Math.max(0, gross - (e.keepTaxable ?? 0));
  return Math.min(counted * e.exemptShare, e.exemptMax ?? Infinity, room);
}

/**
 * The regime as the TaxTweak a country module accepts, for this gross (annual, the regime's currency): an exemption
 * becomes a taxable share, a flat rate stays a flat rate with its scope. Caps make the share depend on the gross.
 */
export function regimeTweak(regime: Regime, gross: number): TaxTweak {
  const e = regime.effect;
  const note = `Newcomer regime counted because you chose it: ${regime.name} (${regime.country}), for up to ${regime.years} years from the move. Check the conditions before relying on it.`;
  if (e.flatRate !== undefined) {
    const above = e.flatRateAbove;
    const rate = above && gross > above.from ? (e.flatRate * above.from + above.rate * (gross - above.from)) / gross : e.flatRate;
    return { flatRate: rate, flatRateScope: e.flatRateScope ?? "national", note };
  }
  const exempt = exemptAmount(e, gross);
  return { taxableShare: gross > 0 ? 1 - exempt / gross : 1, note: `${note} Tax-free part of this pay: ${Math.round(exempt)} ${regime.currency}.` };
}

/** The person's own tweak on top of a switched-on regime: their own fields win, notes are kept together. */
export function withRegime(own: TaxTweak | undefined, regime: Regime | undefined, gross: number): TaxTweak | undefined {
  if (!regime) return own;
  const base = regimeTweak(regime, gross);
  if (!own) return base;
  const merged: TaxTweak = { ...base, ...own };
  const notes = [base.note, own.note].filter(Boolean);
  if (notes.length) merged.note = notes.join(" ");
  return merged;
}
