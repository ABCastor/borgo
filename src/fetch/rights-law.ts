// Laws some people weigh when choosing a place, as plain legal facts with the statute that sets each one. Facts, not
// scores: which way a fact counts, and whether it counts at all, is the person's own stance (src/core/criteria.ts).
// Indices on these laws (Equaldex, ILGA World, the Center for Reproductive Rights map, WHO's abortion policy database)
// do not allow their data to be stored or redistributed, so each fact here is taken from the law itself.
// A US state sets its own abortion law; elsewhere the country does. `checked` is the date the fact was last compared
// with the source linked (the statute, or an official page that states it); an entry without it is stated from the statute
// cited, because that source could not be read (docs/positions-audit.md lists them).
import type { City, Iso2, Observation } from "../core/types.ts";
import type { Fetcher } from "./context.ts";

// ---------- Abortion ----------

/** Steps named in ABORTION_LEVELS (src/core/criteria.ts). 0 not at all or only to save the woman's life; 1 also for her health, or after rape or incest; 2 also on broad social or economic grounds; 3 on request, under 10 weeks only; 4 on request, to 10 weeks or later. */
export type AbortionLevel = 0 | 1 | 2 | 3 | 4;

interface LawFact<L> {
  level: L;
  /** What the law says, in a few words, with the limit where there is one. */
  text: string;
  law: string;
  url: string;
  checked?: string;
}

/** The date the entries marked `checked` were read in the source linked. */
const C = "2026-11-05";

export const ABORTION: Record<string, LawFact<AbortionLevel>> = {
  IT: { level: 4, text: "in the first 90 days when the woman states that continuing would seriously endanger her physical or mental health, given her health, economic, social or family circumstances, how conception occurred, or a fetal anomaly", law: "Legge 22 maggio 1978, n. 194, art. 4", url: "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1978-05-22;194~art4", checked: C },
  GB: { level: 2, text: "to 24 weeks when two doctors judge that continuing carries a greater risk than ending it to the woman's physical or mental health or her existing children's; later only for her life, grave permanent injury or serious fetal anomaly. Since 29 April 2026 a woman commits no offence in England and Wales for acts concerning her own pregnancy", law: "Abortion Act 1967, s. 1 (England, Wales and Scotland); Crime and Policing Act 2026, s. 241", url: "https://www.legislation.gov.uk/ukpga/1967/87/section/1", checked: C },
  "GB-NIR": { level: 4, text: "on request to 12 weeks", law: "Abortion (Northern Ireland) (No. 2) Regulations 2020, reg. 3", url: "https://www.legislation.gov.uk/uksi/2020/503/regulation/3", checked: C },
  IE: { level: 4, text: "on request to 12 weeks, 3 days after a doctor certifies the pregnancy", law: "Health (Regulation of Termination of Pregnancy) Act 2018, s. 12", url: "https://www.irishstatutebook.ie/eli/2018/act/31/section/12/enacted/en/html", checked: C },
  FR: { level: 4, text: "on request to the end of the 14th week of pregnancy (16 weeks after the last period), with no waiting period", law: "Code de la santé publique, art. L2212-1", url: "https://www.service-public.gouv.fr/particuliers/vosdroits/F1551", checked: C },
  DE: { level: 4, text: "not punished to 12 weeks after conception, on request, after counselling at least 3 days before", law: "Strafgesetzbuch § 218a Abs. 1", url: "https://www.gesetze-im-internet.de/stgb/__218a.html", checked: C },
  NL: { level: 4, text: "until the fetus could survive outside the womb, when the woman's situation of need makes it unavoidable; the law requires the decision to be taken with care", law: "Wet afbreking zwangerschap, art. 5", url: "https://wetten.overheid.nl/BWBR0003396/", checked: C },
  BE: { level: 4, text: "on request to 12 weeks, at least 6 days after the first consultation", law: "Loi du 15 octobre 2018 relative à l'interruption volontaire de grossesse, art. 2", url: "https://www.ejustice.just.fgov.be/cgi_loi/change_lg.pl?language=fr&la=F&cn=2018101503&table_name=loi", checked: C },
  DK: { level: 4, text: "on request to the end of week 18", law: "Sundhedsloven § 92, as amended by Act no. 404 of 29 April 2025, in force 1 June 2025", url: "https://www.retsinformation.dk/eli/lta/2025/404", checked: C },
  SE: { level: 4, text: "on request to the end of week 18", law: "Abortlag (1974:595), 1 §", url: "https://rkrattsbaser.gov.se/sfst?bet=1974:595", checked: C },
  NO: { level: 4, text: "on request to the end of week 18", law: "Abortloven (lov 20. desember 2024 nr. 96), § 3, in force 1 June 2025", url: "https://lovdata.no/dokument/NL/lov/2024-12-20-96", checked: C },
  FI: { level: 4, text: "on request to the end of week 12", law: "Laki raskauden keskeyttämisestä (239/1970), 1 §, as amended by 1097/2022", url: "https://www.finlex.fi/fi/laki/ajantasa/1970/19700239", checked: C },
  CH: { level: 4, text: "on written request to 12 weeks after the last period, the woman stating that she is in distress", law: "Strafgesetzbuch Art. 119 Abs. 2", url: "https://www.fedlex.admin.ch/eli/cc/54/757_781_799/de#art_119", checked: C },
  AT: { level: 4, text: "not punished in the first three months, after a consultation with a doctor", law: "Strafgesetzbuch § 97 Abs. 1 Z 1", url: "https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10002296&Paragraf=97", checked: C },
  CZ: { level: 4, text: "on request to 12 weeks; a foreign woman needs long-term residence in the EU for this, though not for medical grounds", law: "Zákon č. 66/1986 Sb., o umělém přerušení těhotenství, § 4; Ministry of Health guidance", url: "https://mzd.gov.cz/vykladove-stanovisko-mz-provedeni-umeleho-preruseni-tehotenstvi-na-zadost-cizinek-ukrajina/", checked: C },
  PL: { level: 1, text: "only when the pregnancy threatens the woman's life or health, mental health included, or when it may result from a crime", law: "Ustawa z dnia 7 stycznia 1993 r., art. 4a, after the Constitutional Tribunal's judgment K 1/20 of 22 October 2020; Ministry of Health guidance of 2024", url: "https://www.gov.pl/web/zdrowie/wytyczne-dla-lekarzy-i-podmiotow-leczniczych-ws-dostepu-do-procedury-przerwania-ciazy", checked: C },
  HU: { level: 4, text: "to 12 weeks when the woman is in serious crisis (physical or mental shock, or social hardship), which she certifies by signing her request", law: "1992. évi LXXIX. törvény a magzati élet védelméről, 5., 6. és 12. §", url: "https://net.jogtar.hu/jogszabaly?docid=99200079.tv", checked: C },
  PT: { level: 4, text: "on request to 10 weeks (10 weeks and 6 days after the last period), after a wait of at least 3 days", law: "Lei n.º 16/2007; Código Penal, art. 142.º", url: "https://www.sns24.gov.pt/tema/saude-da-mulher/interrupcao-voluntaria-da-gravidez/", checked: C },
  ES: { level: 4, text: "on request to 14 weeks", law: "Ley Orgánica 2/2010, art. 14, as amended by Ley Orgánica 1/2023", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2010-3514", checked: C },
  GR: { level: 4, text: "on request to 12 weeks", law: "Νόμος 1609/1986, άρθρο 304 Ποινικού Κώδικα", url: "https://www.kodiko.gr/nomologia/document_navigation/146879/nomos-1609-1986" },
  EE: { level: 4, text: "on request before 12 weeks", law: "Raseduse katkestamise ja steriliseerimise seadus, § 6", url: "https://www.riigiteataja.ee/akt/RKSS", checked: C },
  CA: { level: 4, text: "no criminal law restricts it since the Supreme Court struck the provision down; provinces regulate care", law: "R v Morgentaler, [1988] 1 SCR 30", url: "https://scc-csc.lexum.com/scc-csc/scc-csc/en/item/288/index.do" },
  AU: { level: 4, text: "on request in every state and territory, to a limit that differs by state (16 to 24 weeks)", law: "State laws, for example Abortion Law Reform Act 2019 (NSW), Abortion Law Reform Act 2008 (Vic)", url: "https://legislation.nsw.gov.au/view/html/inforce/current/act-2019-011" },
  SG: { level: 4, text: "on request to 24 weeks after the last period, for citizens, work-pass holders, the wives of either, and women resident for at least 4 months", law: "Termination of Pregnancy Act 1974, ss. 3 and 4", url: "https://sso.agc.gov.sg/Act/TPA1974", checked: C },
  JP: { level: 2, text: "before 22 weeks when continuing or giving birth would seriously harm the woman's health for physical or economic reasons, or after rape; with her and her spouse's consent, hers alone where there is no spouse able to consent", law: "母体保護法 (Maternal Health Act), art. 14; Ministry of Health notice on the 22-week limit", url: "https://www.mhlw.go.jp/web/t_doc?dataId=80120000&dataType=0&pageNo=1", checked: C },
  "US-CA": { level: 4, text: "on request until viability; a right in the state constitution since 2022", law: "California Constitution art. I, s. 1.1; Health and Safety Code s. 123466", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=123466.&lawCode=HSC" },
  "US-NY": { level: 4, text: "on request to 24 weeks, later to protect her life or health", law: "Public Health Law s. 2599-bb (Reproductive Health Act 2019)", url: "https://www.nysenate.gov/legislation/laws/PBH/2599-BB" },
  "US-MA": { level: 4, text: "on request to 24 weeks", law: "General Laws c. 112, s. 12M", url: "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXVI/Chapter112/Section12M" },
  "US-WA": { level: 4, text: "on request until viability, later to protect her life or health", law: "RCW 9.02.110", url: "https://app.leg.wa.gov/rcw/default.aspx?cite=9.02.110", checked: C },
  "US-IL": { level: 4, text: "on request until viability", law: "Reproductive Health Act, 775 ILCS 55", url: "https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=3974" },
  "US-CO": { level: 4, text: "a fundamental right in state law, which sets no gestational limit", law: "Reproductive Health Equity Act, C.R.S. 25-6-401 to 25-6-406", url: "https://leg.colorado.gov/bills/hb22-1279", checked: C },
  "US-TX": { level: 0, text: "prohibited from fertilisation, except when a physician judges that a life-threatening physical condition puts the woman at risk of death or of substantial impairment of a major bodily function", law: "Health and Safety Code s. 170A.002, as amended by S.B. 31 (2025)", url: "https://capitol.texas.gov/tlodocs/89R/billtext/html/SB00031F.htm", checked: C },
  "US-FL": { level: 3, text: "on request to 6 weeks; to 15 weeks after rape, incest or trafficking; later only to save her life or avert a serious risk of substantial and irreversible physical impairment, or for a fatal fetal abnormality before the third trimester", law: "Florida Statutes s. 390.0111", url: "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0300-0399/0390/Sections/0390.0111.html", checked: C },
};

// ---------- Same-sex couples ----------

/** 0 criminalised, 1 legal but no recognition, 2 civil union or registered partnership, 3 marriage. */
export type CouplesLevel = 0 | 1 | 2 | 3;

/** How the law lets a same-sex couple form a union: `law` names it, `note` adds what the step alone does not say. */
export const COUPLES: Record<Iso2, { standing: CouplesLevel; law: string; url?: string; checked?: string; note?: string }> = {
  IT: { standing: 2, law: "Civil unions: Legge 20 maggio 2016, n. 76 (Cirinnà)", url: "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2016-05-20;76" },
  GB: { standing: 3, law: "Marriage: Marriage (Same Sex Couples) Act 2013; Marriage and Civil Partnership (Scotland) Act 2014; Northern Ireland from 13 January 2020 (S.I. 2019/1514, reg. 3)", url: "https://www.legislation.gov.uk/ukpga/2013/30/section/1", checked: C },
  IE: { standing: 3, law: "Marriage: Constitution, Art. 41.4 (34th Amendment, 2015)", url: "https://www.irishstatutebook.ie/eli/cons/en/html", checked: C },
  FR: { standing: 3, law: "Marriage: Loi n° 2013-404 du 17 mai 2013", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000027414540" },
  DE: { standing: 3, law: "Marriage: Bürgerliches Gesetzbuch § 1353, since 2017", url: "https://www.gesetze-im-internet.de/bgb/__1353.html", checked: C },
  NL: { standing: 3, law: "Marriage: Burgerlijk Wetboek Boek 1, art. 30, since 1 April 2001", url: "https://wetten.overheid.nl/BWBR0002656/" },
  BE: { standing: 3, law: "Marriage: Code civil, art. 143, since 1 June 2003", url: "https://www.ejustice.just.fgov.be/cgi_loi/change_lg.pl?language=fr&la=F&cn=1804032130&table_name=loi", checked: C },
  DK: { standing: 3, law: "Marriage: Lov nr. 532 af 12. juni 2012", url: "https://www.retsinformation.dk/eli/lta/2012/532" },
  SE: { standing: 3, law: "Marriage: Äktenskapsbalk (1987:230), 1 kap. 1 §, since 1 May 2009", url: "https://rkrattsbaser.gov.se/sfst?bet=1987:230", checked: C },
  NO: { standing: 3, law: "Marriage: Ekteskapsloven § 1, since 1 January 2009", url: "https://lovdata.no/dokument/NL/lov/1991-07-04-47", checked: C },
  FI: { standing: 3, law: "Marriage: Avioliittolaki as amended, in force 1 March 2017", url: "https://www.finlex.fi/fi/laki/ajantasa/1929/19290234" },
  CH: { standing: 3, law: "Marriage: Zivilgesetzbuch Art. 94, since 1 July 2022 (Ehe für alle)", url: "https://www.fedlex.admin.ch/eli/cc/24/233_245_233/de#art_94", checked: C },
  AT: { standing: 3, law: "Marriage: ABGB § 44, after the Constitutional Court's ruling G 258/2017, since 1 January 2019", url: "https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622&Paragraf=44", checked: C },
  CZ: { standing: 2, law: "Partnership: Civil Code as amended by Act 123/2024 Coll., since 1 January 2025", url: "https://mv.gov.cz/partnerstvi", checked: C, note: "a partnership to which most marriage rules apply, with exceptions; registered partnerships formed before 2025 continue" },
  PL: { standing: 1, law: "No marriage or partnership in Polish law", url: "https://www.sejm.gov.pl/Sejm10.nsf/PrzebiegProc.xsp?nr=2110", checked: C, note: "a 'closest person' bill passed by Parliament in 2026 was vetoed by the President on 17 July 2026, and the Sejm did not override the veto on 17 September 2026. Under the EU Court of Justice's judgment in C-713/23 (25 November 2025), Poland must recognise a same-sex marriage its citizens lawfully concluded in another EU country" },
  HU: { standing: 2, law: "Registered partnership: Act XXIX of 2009, § 1; the Fundamental Law, Art. L, defines marriage as between a man and a woman", url: "https://net.jogtar.hu/jogszabaly?docid=a0900029.tv", checked: C },
  PT: { standing: 3, law: "Marriage: Lei n.º 9/2010", url: "https://diariodarepublica.pt/dr/detalhe/lei/9-2010-332190" },
  ES: { standing: 3, law: "Marriage: Ley 13/2005", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2005-11364", checked: C },
  GR: { standing: 3, law: "Marriage: Law 5089/2024" },
  EE: { standing: 3, law: "Marriage: Family Law Act amendment, in force 1 January 2024", url: "https://www.riigiteataja.ee/akt/PKS" },
  US: { standing: 3, law: "Marriage: Obergefell v. Hodges, 576 U.S. 644 (2015); Respect for Marriage Act 2022", url: "https://www.supremecourt.gov/opinions/14pdf/14-556_3204.pdf" },
  CA: { standing: 3, law: "Marriage: Civil Marriage Act, S.C. 2005, c. 33, s. 2", url: "https://laws-lois.justice.gc.ca/eng/acts/c-31.5/page-1.html", checked: C },
  SG: { standing: 1, law: "No recognition: a marriage between persons of the same sex is void (Women's Charter 1961, s. 12); the Constitution, Art. 156, lets Parliament define marriage", url: "https://sso.agc.gov.sg/Act/WC1961", checked: C, note: "Penal Code s. 377A, on sex between men, was repealed in 2022" },
  JP: { standing: 1, law: "No marriage or partnership for same-sex couples in national law", url: "https://elaws.e-gov.go.jp/document?lawid=129AC0000000089", note: "partnership certificates issued by Tokyo and many municipalities are not a marriage or partnership under national law" },
  AU: { standing: 3, law: "Marriage: Marriage Act 1961, s. 5, as amended by the Marriage Amendment (Definition and Religious Freedoms) Act 2017", url: "https://www.legislation.gov.au/C1961A00012/latest/text" },
  NZ: { standing: 3, law: "Marriage: Marriage (Definition of Marriage) Amendment Act 2013", url: "https://www.legislation.govt.nz/act/public/2013/0020/latest/whole.html" },
};

/** The fact for a place: its region's own entry where one exists, else its country's. */
function lookup<T>(table: Record<string, T>, city: City): { key: string; fact: T } | null {
  if (city.region && table[city.region]) return { key: city.region, fact: table[city.region]! };
  return table[city.country] ? { key: city.country, fact: table[city.country]! } : null;
}

export const abortionLaw: Fetcher = {
  source: "abortion-law",
  version: 1,
  runtimes: ["browser", "node"],
  // In the United States each state sets the law: a state not in the table has no figure, never the country's.
  covers: (c) => (c.country === "US" ? !!(c.region && ABORTION[c.region]) : !!lookup(ABORTION, c)),
  async fetch(city, ctx) {
    const hit = lookup(ABORTION, city);
    if (!hit) return [];
    const f = hit.fact;
    const read = f.checked ? `checked against the source linked on ${f.checked}` : "stated from the law cited";
    return [{ metric: "abortion_law", value: f.level, period: f.checked ?? "2026", level: hit.key.includes("-") ? "region" : "country", source: "abortion-law", retrieved: ctx.now().toISOString(), url: f.url, fetcher: "abortion-law@1", note: `${f.text[0]!.toUpperCase()}${f.text.slice(1)} (${f.law}; ${read})` } satisfies Observation];
  },
};

/** The last full review of the couples table; entries with `checked` were read again on that date. */
export const COUPLES_REVIEWED = C;

export const couplesLaw: Fetcher = {
  source: "couples-law",
  version: 2,
  runtimes: ["browser", "node"],
  covers: (c) => c.country in COUPLES,
  async fetch(city, ctx) {
    const l = COUPLES[city.country];
    if (!l) return [];
    const read = l.checked ? `checked against the source linked on ${l.checked}` : "stated from the law cited";
    return [{ metric: "same_sex_couples", value: l.standing, period: (l.checked ?? COUPLES_REVIEWED).slice(0, 4), level: "country", source: "couples-law", retrieved: ctx.now().toISOString(), ...(l.url ? { url: l.url } : {}), fetcher: "couples-law@2", note: `${l.law}${l.note ? `; ${l.note}` : ""} (${read})` }];
  },
};
