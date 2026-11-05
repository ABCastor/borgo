# Pension and statutory leave source audit

## Scope and verdicts

**126 audit entries across 26 countries: 103 match within their stated scope, 18 have wrong values, descriptions or behaviour, and 5 are not fully verified.** An entry is a country pension-relief rule, a country pension-bearing payroll rule, a country annual-leave rule, or an OECD country/parent metric. Several rules contain multiple statutory constants; these are rule-group counts, not a claim of 126 independently verified atomic numbers. Repeated city observations count once.

The 48 OECD entries match the live official workbook, but describe **April 2025 policies**, not current 2026 statutory rights. The publisher's live PF2.1 document says **Updated: May 2026**, with 2024 earnings inputs. No 2026 full-rate equivalents are invented. So the parental figures are **not certified as current-year law**.

“Wrong” marks an entry whose encoded value, description or behaviour differed from the official rule; the code and data follow the official rule in the table, or state the exception they do not model. “Match” is limited to the employee/scheme assumptions stated, not a certification of every possible taxpayer or employment contract. “Not fully verified” (shown as “not verifiable” in the tables) means a specific unresolved source or coverage gap, not that the figure is necessarily wrong or impossible to verify. Unread source material is explicitly distinguished from inaccessible material.

## Pension relief: 26 country entries

All amounts are yearly local currency unless stated otherwise. Sources describe rules applicable in 2026; standing statutes and current official guidance need not have a 2026 publication date.

| Country | Repository figure/rule | Official figure/rule and current scope | Year | Verdict | Source |
|---|---|---|---|---|---|
| AE | No income tax relief | No individual income tax; expatriate assumption | 2026 | match | [official](https://u.ae/en/information-and-services/finance-and-investment/taxation) |
| AT | Zukunftsvorsorge relief not modelled | State premium exists; model explicitly omits it | 2026 | match | [official](https://www.bmf.gv.at/themen/finanzmarkt/altersvorsorge.html) |
| AU | Generally 15% fund tax; relief not modelled | Generally 15%; additional high-income tax possible. No modelled deduction or fund tax | 2026 | match | [official](https://www.ato.gov.au/individuals-and-families/super-for-individuals-and-families/super/growing-and-keeping-track-of-your-super/caps-limits-and-tax-on-super-contributions/understanding-concessional-and-non-concessional-contributions) |
| BE | 25%/30% reduction; not modelled | Official page is a JavaScript/support-ID block; no current limits certified | 2026 | not verifiable | [official](https://fin.belgium.be/fr/particuliers/avantages-fiscaux/epargne-pension) |
| CA | 18% of earnings, CAD 33,810 | CAD 33,810; 18% of prior-year earned income. Current pay is an explicit proxy; carry-forward and pension adjustment absent | 2026 | match | [official](https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html) |
| CH | CHF 7,258 | CHF 7,258 for employees with occupational pension membership; catch-up room is outside the model | 2026 | match | [official](https://www.bsv.admin.ch/fr/votre-cotisation-au-3e-pilier) |
| CZ | Full payment deductible up to CZK 48,000; CZK 12,000/month caveat | For non-retired third-pillar participants only monthly payments above CZK 1,700 qualify; CZK 48,000 shared annual deduction. Equal monthly payments assumed | 2026 | wrong | [official](https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/zamestnanci-zamestnavatele/dotazy-a-odpovedi/2026/aktualni-dotazy-a-odpovedi-k-dani-z) |
| DE | 8% × EUR 101,400 = EUR 8,112 | 8% of general pension insurance ceiling; EUR 8,112. Employer payments use the same allowance; assumed absent | 2026 | match | [official](https://www.gesetze-im-internet.de/estg/__3.html) |
| DK | Deductibility within limits; not modelled | Ratepension contributions deductible within DKK 68,700 in 2026, shared with employer contributions; explicit model omission | 2026 | match | [official](https://skat.dk/borger/pension-og-efterloen/fradrag-for-indbetalinger-til-pension) |
| EE | 15%, max EUR 6,000 | 15% of qualifying taxable income, max EUR 6,000; separate from mandatory second pillar | 2026 | match | [official](https://www.emta.ee/en/private-client/taxes-and-payment/tax-incentives/contributions-supplementary-funded-pension) |
| ES | Min(EUR 1,500, 30% of gross) | Min(EUR 1,500, 30% of net employment/business income); salary model uses gross less social security and EUR 2,000 work expenses | 2026 | wrong | [official](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764) |
| FI | Deductible only from capital income; not modelled | Up to EUR 5,000; insufficient capital income permits a special 30% deficit credit against earned-income tax. Both remain explicitly unmodelled | 2026 | wrong | [official](https://www.vero.fi/en/individuals/deductions/what-can-I-deduct/deductions-from-capital-incom/) |
| FR | 10% × 90% of gross, EUR 4,710–37,680; no age cutoff | 10% of prior-year net professional income, same min/max; payments from age 70 not deductible; minors cannot make voluntary payments. Modelled net professional income is an explicit prior-year proxy | 2026 | wrong | [official](https://www.service-public.gouv.fr/particuliers/vosdroits/F34982) |
| GB | GBP 60,000; taper above GBP 260,000; floor GBP 10,000 | Same allowance; both GBP 200,000 threshold-income and GBP 260,000 adjusted-income tests apply. Model assumes salary only, no employer pension payments or carry-forward | 2026 | match | [official](https://www.gov.uk/tax-on-your-private-pension/pension-tax-relief) |
| GR | Occupational relief exists but not modelled | AADE official law PDF cannot be read sufficiently to certify current conditions; no relief computed | 2026 | not verifiable | [official](https://www.aade.gr/sites/default/files/2024-01/o_3003_2023.pdf) |
| HU | 20%, max HUF 150,000; cash refund capped against all taxes | 20%, max HUF 150,000, from remaining PIT and transferred to the fund; not cash take-home | 2026 | wrong | [official](https://nav.gov.hu/sajtoszoba/hirek/Erdemes_kihasznalni_az_onkentes_penztari_befizetesek_utan_jaro_adokedvezmenyt) |
| IE | 15/20/25/30/35/40% age shares; EUR 115,000 earnings cap | Revenue confirms each share: under 30 / 30–39 / 40–49 / 50–54 / 55–59 / 60+; EUR 115,000 earnings cap | 2026 | match | [official](https://www.revenue.ie/en/jobs-and-pensions/pension/relief/tax-relief-limits.aspx) |
| IT | EUR 5,164.57 | EUR 5,300 for tax period 2026; includes employer contributions, excludes TFR | 2026 | wrong | [official](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2005-12-05;252~art8) |
| JP | JPY 23,000/month = 276,000; December reform excluded | JPY 23,000/month for employee without company pension before December 2026. JPY 62,000/month from December; transition explicitly outside the calculation | 2026 | match | [official](https://www.ideco-koushiki.jp/start/entry.html) |
| NL | Eligible workplace premium deducted; no generic cap | Eligible employee premium comes off wages before tax. Scheme-specific fiscal limits and personal annuity room cannot be calculated from gross alone | 2026 | match | [official](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/werk_en_inkomen/lijfrente/aftrekken-lijfrentepremies/aftrekken-lijfrentepremies) |
| NO | NOK 15,000; 22% credit offsetting all taxes | Tax-favoured scheme NOK 25,000, deducted from ordinary income only; old IPS retains NOK 15,000. Credit approximation limited to ordinary income tax | 2026 | wrong | [official](https://www.skatteetaten.no/en/rates/maximum-annual-deduction-for-payments-to-an-individual-pension-scheme/) |
| PL | IKZE deductible within annual limit; not modelled | Employee IKZE limit PLN 11,304 for 2026; explicit model omission | 2026 | match | [official](https://podatki.gov.pl/ulgi-i-odliczenia/ulga-na-ikze-pit) |
| PT | 20%; EUR 400/350/300 by age; credit capped against all taxes | Same age caps, age on 1 January, credit limited to IRS due, no deduction after retirement. Retirement status and aggregate deduction limits outside model | 2026 | wrong | [official](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/bf_rep/Pages/ebf-artigo-21-ordm-.aspx) |
| SE | No employee private-pension relief | No deduction for employees with occupational rights; exception for employees entirely without those rights. Exception and salary exchange not modelled | 2026 | wrong | [official](https://www.skatteverket.se/privat/skatter/arbeteochinkomst/avdragforprivatpersoner/np.4.5fc8c94513259a4ba1d800042822.html) |
| SG | SGD 15,300 citizen/PR or 35,700 foreigner | IRAS confirms both; overall personal relief cap SGD 80,000. Existing CPF/foreigner proxy remains an open item | 2026 | match | [official](https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/special-tax-schemes/srs-contributions) |
| US | USD 24,500; catch-up 8,000 at 50+, 11,250 at 60–63 | IRS confirms all limits. 2026 mandatory Roth catch-up above USD 150,000 prior-year employer wages remains explicitly unmodelled because prior wages are absent | 2026 | match | [official](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500) |

Additional pension source details:

- US: [IRS Notice 2025-67](https://www.irs.gov/pub/irs-drop/n-25-67.pdf) specifies the USD 150,000 prior-year wage threshold for mandatory Roth catch-ups. The model cannot infer prior-year employer wages from current gross.
- GB: [HMRC annual allowance](https://www.gov.uk/tax-on-your-private-pension/annual-allowance) and [taper calculation](https://www.gov.uk/guidance/pension-schemes-work-out-your-tapered-annual-allowance). Employer contributions, prior-year carry-forward and flexible-access restrictions are not inputs.
- DE: §3 no.63 EStG supplies the 8%; [DRV values](https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html) supply the 2026 pension ceiling. Employer payments share the allowance; employee social-insurance savings on salary conversion are explicitly not modelled.
- JP: [MHLW December 2026 reform](https://www.mhlw.go.jp/web_magazine/column/20261020.html) confirms the monthly 23,000-to-62,000 transition. The existing calculation remains the pre-December case, not a certified full-transition-year tax deduction. Monthly payment timing and the December transition remain an open calculation item.
- IT: D.Lgs.252/2005 art.8(4) explicitly raises the deduction to EUR 5,300 for tax period 2026; its amendment note gives July 2026 applicability. The old COVIP FAQ still displays 5,164.57 and is marked as under revision. The operative consolidated statute controls.

## Annual paid leave: 26 country entries

Five-day-week figures are comparable baselines with the service and accrual conditions in each observation. They are not a guarantee that every new starter can take that many paid days immediately. Calendar-day conversions preserve the source unit and expose the conversion rather than inventing a statutory workday count.

| Country | Repository baseline | Official rule | Year | Verdict | Source read |
|---|---|---|---|---|---|
| AE | 22 | 30 calendar days after 1 year; 30 × 5/7 equivalent, not a statutory 22 workdays | 2026 | wrong | [official](https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/Types-of-leaves) |
| AT | 25 | 5 weeks / 25 five-day-week days; 6 weeks after 25 years | 2026 | match | [official](https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-austria_en) |
| AU | 20 | 4 weeks / 20 days for non-casual employees; shiftworker exceptions | 2026 | match | [official](https://www.fairwork.gov.au/leave/annual-leave) |
| BE | 20 | 4 weeks / 20 days after full prior-year accrual | 2026 | match | [official](https://www.onva.fgov.be/fr/ouvriers/duree-de-vacances/calcul-des-jours-de-vacances) |
| CA | 10 | Federal 2 weeks after 1 year, 3 after 5, 4 after 10; not uniform provincial law | 2026 | match | [official](https://www.canada.ca/en/employment-social-development/corporate/portfolio/labour/bulletin/march-2026.html) |
| CH | 20; age-under-20 uplift absent | 4 weeks / 20 days; 5 weeks / 25 days under 20 (age adjustment required) | 2026 | wrong | [official](https://www.ch.ch/en/work/working-hours/vacation--public-holidays-and-absences-from-work/) |
| CZ | 20 | Private-sector 4 weeks / 20 days | 2026 | match | [official](https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-czechia_en) |
| DE | 20 | 24 days on six-day count = 20 on five-day week | 2026 | match | [official](https://www.gesetze-im-internet.de/burlg/__3.html) |
| DK | 25 | 5 weeks / 25 days; accrual 2.08 days/month | 2026 | match | [official](https://www.retsinformation.dk/eli/lta/2018/60) |
| EE | 20 | 28 calendar days = 20 five-day-week equivalent; public holidays excluded | 2026 | match | [official](https://www.tooelu.ee/en/26/types-holidays) |
| ES | 22 | 30 calendar days; 30 × 5/7 equivalent, not a statutory 22 workdays | 2026 | wrong | [official](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430) |
| FI | 25 | 2 days/full month before 1 year = 24 six-day-count / 20 equivalent; 2.5 thereafter = 25 equivalent | 2026 | wrong | [official](https://www.finlex.fi/fi/laki/ajantasa/2005/20050162) |
| FR | 25 | 30 six-day-count days / 5 weeks / 25 five-day-week days | 2026 | match | [official](https://www.service-public.gouv.fr/particuliers/vosdroits/F2258) |
| GB | 20 | 5.6 weeks / 28 days; bank holidays may be included, not automatically additional | 2026 | wrong | [official](https://www.gov.uk/holiday-entitlement-rights) |
| GR | 20 | 20 days first year, rising to 21 and 22; additional long-service rights | 2026 | match | [official](https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-greece_en) |
| HU | 20 | 20 working days plus age bands: 1/2/3 at 25/28/31, +1 every 2 years to 10 at 45 | 2026 | match | [official](https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-hungary_en) |
| IE | 20 | 4 working weeks / 20 five-day-week days | 2026 | match | [official](https://www.workplacerelations.ie/en/what_you_should_know/leave/annual-leave/) |
| IT | 20 | 4 weeks / 20 five-day-week days | 2026 | match | [official](https://www.lavoro.gov.it/sportello-unico-digitale/termini-e-condizioni-di-impiego/ferie-annuali) |
| JP | 10 | 10 days after 6 months and 80% attendance, rising to 20 with service | 2026 | match | [official](https://www.mhlw.go.jp/content/001762303.pdf) |
| NL | 20 | 4 times weekly working hours / 20 full-time five-day-week days | 2026 | match | [official](https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-netherlands_en) |
| NO | 21 | 25 six-day-count days (4 weeks + 1 day) / 21 five-day-week days; 6 extra six-day-count days from age 60 | 2026 | match | [official](https://lovdata.no/dokument/NL/lov/1988-04-29-21) |
| PL | 20 | 20 days below 10 years qualifying service; 26 thereafter; up to 8 education years count | 2026 | match | [official](https://www.gov.pl/web/family/the-duration-of-annual-leave) |
| PT | 22 | 22 working days | 2026 | match | [official](https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-portugal_en) |
| SE | 25 | 25 days, paid entitlement depends on accrual | 2026 | match | [official](https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-sweden_en) |
| SG | 7 | 7 days first service year, +1/year up to 14; qualifying service at least 3 months | 2026 | match | [official](https://www.mom.gov.sg/employment-practices/leave/annual-leave/eligibility-and-entitlement) |
| US | 0; description asserted no state requires vacation | No general FLSA vacation requirement; government contracts and state/local paid-leave obligations are exceptions | 2026 | wrong | [official](https://www.dol.gov/general/topic/workhours/vacation_leave) |

Norway's age-60 uplift is five five-day-week days, not five calendar days. Switzerland's age-under-20 uplift is five days. Hungary's age bands use the year the relevant age is reached. Contracts, youth/disability/family entitlements, service progression and collective agreements can give more; only the named age adjustments are computed. UK public-holiday dates remain visible but are not added a second time to the statutory leave valuation. UAE public holidays falling inside annual leave may count within its calendar-day entitlement, so a summed calendar valuation is only an approximation.

Official fallback coverage:

- [ONVA's leave calculation](https://www.onva.fgov.be/fr/ouvriers/duree-de-vacances/calcul-des-jours-de-vacances) and [Polish ministry guidance](https://www.gov.pl/web/family/the-duration-of-annual-leave) are readable through the browser despite OmniRead TLS failures.
- [Estonia's Labour Inspectorate](https://www.tooelu.ee/en/26/types-holidays) supplies the current 28-calendar-day rule; the initially cited Riigi Teataja link exposes only a shell.
- Portugal's DR consolidated page exposes no usable body; official EURES guidance supplies the 22-working-day text. Hungary's NJT connection fails, but official EURES supplies the baseline and complete age sequence. The readable commercial Jogtar copy is not used as the official evidence.
- Italy's Labour Ministry and Ireland's Workplace Relations Commission provide usable text when statute-table extraction is incomplete. Japan's e-Gov representation is blank; the current MHLW PDF supplies the annual-leave conditions.
- UAE legislation exposes an empty representation. The UAE government's current types-of-leave page supplies the same art.29 entitlement and holiday-overlap rule. Fair Work and CRA pages are readable with OmniRead despite direct-fetch access errors.

## Pension-bearing payroll: 26 country entries

This section checks pension-related rates, ceilings and conditions, not every non-pension tax constant in these modules. A named omission is not a statutory contribution of zero.

| Country | Repository figure/rule | Official figure or verification limit | Year | Verdict | Source |
|---|---|---|---|---|---|
| AE | No pension contribution for assumed expatriate; nationals excluded | Expatriate scope, not a statement of zero contributions for Emirati employees | 2026 | match | [official](https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/end-of-service-benefits-for-employees-in-the-private-sector) |
| AT | Employee pension 10.25%; EUR 6,930 regular-month / 13,860 special-pay ceilings | RIS §51 confirms 10.25%; ÖGK 2026 PDF confirms both ceilings | 2026 | match | [official](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10008147&Paragraf=51) |
| AU | No voluntary super relief computed | Explicit omission, not a statutory zero; concessional fund tax is generally 15% | 2026 | match | [official](https://www.ato.gov.au/individuals-and-families/super-for-individuals-and-families/super/growing-and-keeping-track-of-your-super/caps-limits-and-tax-on-super-contributions/understanding-concessional-and-non-concessional-contributions) |
| BE | Pension 7.5%; combined employee social insurance 13.07%, uncapped | ONSS employee table: 7.50 + 3.55 + 1.15 + 0.87 = 13.07% | 2026 | match | [official](https://www.socialsecurity.be/employer/instructions/dmfa/fr/latest/instructions/socialsecuritycontributions/contributions.html) |
| CA | CPP 4.95% + 1%; QPP 5.30% + 1%; CAD 3,500 exemption; 74,600/85,000 bands; CPP2/QPP2 4% | CRA CPP table and Revenu Québec 2026 principal changes confirm all pension amounts and split | 2026 | match | [official](https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/employers-principal-changes-for-2026/) |
| CH | AHV/IV/EO employee 5.3%, uncapped; occupational BVG excluded | Current AHV leaflet: 8.7 + 1.4 + 0.5 = 10.6%, employee half 5.3%; BVG remains an explicit gap | 2026 | match | [official](https://www.ahv-iv.ch/p/2.01.e) |
| CZ | Pension 6.5% + sickness 0.6%; CZK 2,350,416 ceiling | ČSSZ confirms 7.1% employee total and 48 × 48,967 assessment ceiling | 2026 | match | [official](https://www.cssz.gov.cz/web/cz/maximalni-vymerovaci-zaklad) |
| DE | 9.3% employee pension; EUR 101,400 annual ceiling | DRV 18.6% total / 2, monthly ceiling EUR 8,450 | 2026 | match | [official](https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html) |
| DK | No fixed ATP or collectively agreed workplace pension deducted | Skat confirms ATP mandatory and deductible; omission is named, not presented as zero legal liability | 2026 | match | [official](https://skat.dk/borger/pension-og-efterloen/fradrag-for-indbetalinger-til-pension) |
| EE | 2% funded pillar default; 4%/6% alternatives described; 1.6% employee unemployment | EMTA 2026 tax rates confirms default and choices; second pillar deductible from income-tax base | 2026 | match | [official](https://www.emta.ee/en/private-client/taxes-and-payment/declaration-income/tax-rates) |
| ES | Common contingencies 4.7%, employee MEI 0.15%; EUR 5,101.20 monthly maximum | Seguridad Social 2026 table confirms rates and maximum; solidarity component remains as separately cited statute | 2026 | match | [official](https://www.seg-social.es/wps/portal/wss/internet/Trabajadores/CotizacionRecaudacionTrabajadores/36537) |
| FI | Employee TyEL 7.30%, deducted before income tax | Vero 2026 withholding decision confirms rate and deduction | 2026 | match | [official](https://www.vero.fi/syventavat-vero-ohjeet/paatokset/47363/verohallinnon-paatos-ennakonpidatysprosenttien-laskentaperusteista-palkkatuloa-varten-ja-ennakonkannossa-maarattavan-ennakkoveron-laskentaperusteista-vuodelle-2026/) |
| FR | Old-age 6.9% up to PASS, 0.4% uncapped; AGIRC 3.15/8.64%, CEG .86/1.08%, CET .14%; PASS 48,060 | Service Public F2302 confirms all rates, EUR 4,005 monthly PASS and 8-PASS ceiling | 2026 | match | [official](https://www.service-public.gouv.fr/particuliers/vosdroits/F2302) |
| GB | NI 8% from GBP 12,570 to 50,270, 2% thereafter | 2026–27 HMRC employer table confirms thresholds and category-A rates | 2026 | match | [official](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027) |
| GR | EFKA employee 13.37%; EUR 7,761.94 monthly ceiling, 14 payments | Official circular landing pages readable, but full attached current tables not sufficiently checked | 2026 | not verifiable | [official](https://www.e-efka.gov.gr/el/egkyklioi-kai-genika-eggrapha/egkyklios-42026) |
| HU | Employee social insurance 18.5%, uncapped | Live official EURES guidance states an 18.5% deduction from employee gross income. The misdirected NAV health-service-contribution citation is replaced | 2026 | match | [official](https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-hungary_en) |
| IE | 4.2% for 9 months, 4.35% for 3; zero through EUR 352/week; no taper credit | DSP guide: same rates plus EUR 12 weekly credit at 352.01, reduced by 1/6 to 424; equal weekly pay assumed | 2026 | wrong | [official](https://assets.gov.ie/static/documents/cb168977/PRSI_C20260116_Contribution_Rates_and_User_Guide_-_SW_14_-_English_Version_-_January_2026_.pdf-web.pdf) |
| IT | 9.19% employee pension plus 1% above EUR 56,224, no ceiling | Post-1995 first coverage has EUR 122,295 ceiling; current scope explicitly assumes that cohort. Pre-1996 coverage normally uncapped and not selectable | 2026 | wrong | [official](https://www.inps.it/it/it/inps-comunica/notizie/dettaglio-news-page.news.2026.02.lavoratori-dipendenti-limite-minimo-di-retribuzione-giornaliera-2026.html) |
| JP | 18.3% total / 2; JPY 88,000 floor, 650,000 ceiling; standard-monthly grades | Kyokai Kenpo Tokyo March 2026 official PDF confirms pension column and grades; model assumes twelve equal salaries, no bonuses | 2026 | match | [official](https://www.kyoukaikenpo.or.jp/assets/R8_13tokyo.pdf) |
| NL | No workplace premium until separately entered | Eligible premium comes off taxable pay; scheme membership, franchise and actual permitted premium required for a personal result | 2026 | match | [official](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/werk_en_inkomen/lijfrente/aftrekken-lijfrentepremies/aftrekken-lijfrentepremies) |
| NO | National insurance 7.6%; NOK 99,650 floor and 25% phase-in | Official 2026 page confirms 7.6%; lower-limit/phase-in conditions not independently certified | 2026 | not verifiable | [official](https://www.skatteetaten.no/satser/trygdeavgift/) |
| PL | Employee pension 9.76%, disability 1.5%; PLN 282,600 annual ceiling | ZUS confirms 2026 ceiling (MP 2025.1206); full statutory employee split not independently checked | 2026 | not verifiable | [official](https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/wskazniki/roczna-podstawa-wymiaru-skladek-na-ubezpieczenia-emerytalne-i-rentowe-od-1999-r) |
| PT | General employee social insurance 11%, uncapped | Official EURES working-conditions guidance confirms general 11% of gross wage | 2026 | match | [official](https://eures.europa.eu/living-and-working/living-and-working-conditions/living-and-working-conditions-portugal_en) |
| SE | 7%, max SEK 47,100; no low-income exemption, direct rounding of gross | Lag 1994:1744 §§3–4: no fee below 42.3% PBB (SEK 25,042); income floor-rounded to 100, fee rounded to 100 with ties down; same 7%/47,100 cap | 2026 | wrong | [official](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-19941744-om-allman-pensionsavgift_sfs-1994-1744/) |
| SG | Employee CPF 20%, monthly OW ceiling SGD 8,000; AW annual ceiling 102,000; graduated small-wage rule | CPF Board and IRAS confirm 2026 rate and ceilings. Citizen/PR year/foreigner distinction must be explicit in a future field; current proxy unchanged | 2026 | match | [official](https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/central-provident-fund(cpf)-relief-for-employees) |
| US | Employee OASDI 6.2%, USD 184,500 wage base | SSA current wage-base table confirms 184,500 for 2026; payroll retirement-rate split unchanged | 2026 | match | [official](https://www.ssa.gov/oact/cola/cbb.html) |

Supplementary payroll sources: [CRA CPP](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html), [CRA CPP2](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html), [ÖGK 2026 values PDF](https://www.gesundheitskasse.at/cdscontent/load?contentid=10008.784766&version=1703772249), [ČSSZ employee rates](https://www.cssz.gov.cz/web/cz/vyse-a-sazba), [Skatteverket 2026 fee/cap/PBB](https://www.skatteverket.se/privat/skatter/beloppochprocent/2026.4.1522bf3f19aea8075ba21.html), [CPF Board rates](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay). [SSA OASDI rates](https://www.ssa.gov/oact/progdata/oasdiRates.html) confirms the 6.2% employee rate for 2019 and later. The Swiss current English AHV leaflet is labelled 2025; its standing 5.3% employee rate is not an annually indexed cap.

## Parental leave: 48 distinct values

Source for every row: [OECD PF2.1 workbook](https://webfs.oecd.org/els-com/Family_Database/PF2_1_Parental_leave_systems.xlsx), tables A/B, column 10 (zero-based), rounded to one decimal. [PF2.1 explanatory document](https://webfs.oecd.org/Els-com/Family_Database/PF2_1_Parental_leave_systems.pdf): Updated May 2026; policy reference April 2025; earnings inputs 2024. The live workbook's title and notes agree. Comparison covers every committed city copy as well as all 48 unique values. Singapore and the UAE have no observations, not zero weeks.

The OECD landing page does not expose a readable body in the available extraction, so edition evidence rests on the publisher's live PF2.1 document and workbook, not on a claim to have read the full landing-page index.

| Country | Mothers: repo / official FRE weeks | Fathers: repo / official FRE weeks | Policy year | Verdict for both values |
|---|---|---|---|---|
| AT | 46.5 / 46.5 | 8.1 / 8.1 | April 2025 | match (not verified as 2026 law) |
| AU | 9.2 / 9.2 | 0.9 / 0.9 | April 2025 | match (not verified as 2026 law) |
| BE | 15.1 / 15.1 | 6.8 / 6.8 | April 2025 | match (not verified as 2026 law) |
| CA | 20.1 / 20.1 | 2 / 2 | April 2025 | match (not verified as 2026 law) |
| CH | 8.1 / 8.1 | 1.2 / 1.2 | April 2025 | match (not verified as 2026 law) |
| CZ | 50.6 / 50.6 | 1.2 / 1.2 | April 2025 | match (not verified as 2026 law) |
| DE | 38.2 / 38.2 | 4.8 / 4.8 | April 2025 | match (not verified as 2026 law) |
| DK | 20.4 / 20.4 | 5.5 / 5.5 | April 2025 | match (not verified as 2026 law) |
| EE | 82.1 / 82.1 | 4.3 / 4.3 | April 2025 | match (not verified as 2026 law) |
| ES | 16 / 16 | 16 / 16 | April 2025 | match (not verified as 2026 law) |
| FI | 39.7 / 39.7 | 10.8 / 10.8 | April 2025 | match (not verified as 2026 law) |
| FR | 19.6 / 19.6 | 7.7 / 7.7 | April 2025 | match (not verified as 2026 law) |
| GB | 11.7 / 11.7 | 0.4 / 0.4 | April 2025 | match (not verified as 2026 law) |
| GR | 37 / 37 | 6.4 / 6.4 | April 2025 | match (not verified as 2026 law) |
| HU | 75.9 / 75.9 | 2.3 / 2.3 | April 2025 | match (not verified as 2026 law) |
| IE | 8.2 / 8.2 | 2.1 / 2.1 | April 2025 | match (not verified as 2026 law) |
| IT | 31.7 / 31.7 | 5.9 / 5.9 | April 2025 | match (not verified as 2026 law) |
| JP | 36.3 / 36.3 | 31.6 / 31.6 | April 2025 | match (not verified as 2026 law) |
| NL | 22.3 / 22.3 | 11.3 / 11.3 | April 2025 | match (not verified as 2026 law) |
| NO | 39.3 / 39.3 | 14.6 / 14.6 | April 2025 | match (not verified as 2026 law) |
| PL | 40.3 / 40.3 | 8.3 / 8.3 | April 2025 | match (not verified as 2026 law) |
| PT | 22.3 / 22.3 | 14.5 / 14.5 | April 2025 | match (not verified as 2026 law) |
| SE | 34.4 / 34.4 | 10.9 / 10.9 | April 2025 | match (not verified as 2026 law) |
| US | 0 / 0 | 0 / 0 | April 2025 | match (not verified as 2026 law) |

Full-rate equivalents depend on wage benchmarks, earnings caps, payment rates, sharable/reserved leave, and sometimes net rather than gross earnings. Replacing a stale OECD figure with a raw statutory duration would change the metric. Spain and Australia have post-reference-date reforms; their observations must not be relabelled 2026 or replaced by uncalculated full-pay equivalents.

## Unresolved items

1. **Five source-verification gaps:** Belgian and Greek voluntary pension rules; Greek pension-bearing payroll total/ceiling; Norway's lower contribution-limit/phase-in details; Poland's full employee pension/disability split (its 2026 ceiling is confirmed). Official source URLs and exact missing evidence are in the tables. Block/support-ID responses, TLS failures or unread attachment content do not count as successful verification.
2. **All 48 parental values as current-2026 entitlements:** unavailable in the latest served OECD reference window. Current national statutes alone cannot supply the same full-rate-equivalent metric without the OECD earnings/payment assumptions and a complete recomputation.
3. **Singapore status field:** use a dedicated citizenship/residency-status field (citizen / PR / foreign national), with PR contribution year and applicable CPF age band. CPF exemption must be separate from tax residency and from SRS contribution classification. A citizen with some unrelated social-insurance exemption must not receive the foreigner SRS cap. The existing no-social-contributions proxy is unchanged.
4. **Scheme and history inputs:** employer contributions, unused room, prior-year employer wages, retirement status, first pension coverage and plan eligibility are not generally available. The Italian module explicitly assumes first compulsory coverage after 1995; it must not be used as an uncapped pre-1996 result. Japan's December transition, Swiss BVG and individual Dutch pension limits remain stated modelling boundaries.
5. **Non-pension figures:** this is not a complete audit of all income-tax bands, IAS or other payroll components. In particular the Portuguese IAS caveat remains explicit; its employee 11% contribution is independently supported.

## Verification contract

The automated checks cover pension caps, age cutoffs, Czech qualifying payments, Spain's net-income ceiling, non-refundable credit boundaries, joint IRS credit capping, Hungary's non-cash fund transfer, Italian INPS ceiling, Irish PRSI credit, Swedish fee floor/base/rounding, UK holiday valuation, Swiss age uplift, and consistency between the statutory table and committed city observations. Pension sources propagate into the computed tax result.

The source comparison uses the live official workbook separately from the offline unit suite. Personal tax-return calculations, the five unresolved source checks and certification of parental leave as 2026 law are outside what this audit verifies.
