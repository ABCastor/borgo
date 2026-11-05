# What people weigh when choosing where to live

The evidence behind the app's optional dials and position lines: what people say matters when they choose a place,
which of those the app measures, and which open data can measure the rest. Sources as of 5 November 2026.

## Method

- **Relevance** from surveys of people who moved or were choosing where to live, with each figure's question and
  sample kept beside it, and two books for the qualitative case. Survey percentages answer different questions of
  different people, so they rank topics; they are not weights.
- **Data** from the publisher's dataset page or codebook, checked for what it measures and where.
- **Reuse** from the dataset's own licence or terms. A download button, an API or a paper's licence is not taken as a
  licence to the data. A source the app may not republish is left out, or kept as a link (`registry/`).
- The survey and book findings come from a structured literature review and are
  marked **reported**; licences and data the app uses were read on the publisher's page and are marked **read**.

## What the surveys show

| Topic | Evidence (question and sample) | Kind |
|---|---|---|
| Jobs and career | 35% of Expat Insider 2024 respondents (12,543 expatriates, open online survey) moved for work. 42.5% of Canadian households that moved between provinces cited a new job or transfer (Canadian Housing Survey 2022; several reasons allowed). | Decision, reported |
| Healthcare nearby | 79% of US adults aged 50+ valued conveniently located health care (AARP Home and Community Preferences 2024). | Preference, reported |
| Schools | 84% of US adults under 55 called good public schools important in deciding where to live (Pew Research Center 2014). | Decision, reported |
| Housing space | 25.3% of Canadian households that moved in the previous five years wanted a bigger or better home (Canadian Housing Survey 2022; local moves included). | Decision, reported |
| Walking to shops and parks | 82% of residents of the 50 largest US metros called an easy walk to shops and parks important when choosing where to live (NAR Community and Transportation Preferences 2026, 2,000 people). 55% of US adults would still take a larger home with amenities farther away over a smaller one close to them (Pew, January 2026, 8,512 adults). | Decision, reported |
| Community and belonging | 32% of US adults called a strong sense of community very important (Pew 2021). | Decision, reported |
| Safety | 17.5% of 904 likely US movers cited safety or crime (Redfin/Ipsos 2024). | Decision, reported |
| Working hours | 17% of Expat Insider 2024 respondents were unhappy with their working hours. | Experience, reported |
| Quiet | 69% of US prospective home buyers called quiet very or extremely important (Zillow 2025). | Decision, reported |
| Bureaucracy | 16% of Expat Insider 2024 respondents worried about bureaucracy before moving. | Experience, reported |
| Natural hazards | 13.7% of likely US movers cited disaster or climate risk (Redfin/Ipsos 2024). | Decision, reported |
| Similar politics | 10% of US adults called living among people who share their political views very important, against 58% for a good place to raise children (Pew 2021). | Decision, reported |

**Books.** Ray Oldenburg, *The Great Good Place* (chapter 2, "The Character of Third Places"): informal gathering places
carry community life, a case for measuring places where relationships can form. Richard Florida, *Who's Your City?*
(2008): where you live shapes your career and the people you meet, and the right place differs by life stage, a case
for job-market depth and for letting each household set its own weights. Both reported from the contents and the
publishers' and author's descriptions, not read in full.

**What follows from it.** Work, health care, schools, housing and everyday walking come up most often, and each is
distinct from what the app already measures (money left, rent, climate, safety, transport, the right to live there).
Politics matters a great deal to some people and little to most: it belongs as an opt-in line scored against the
person's own stance, never as a default weight. The same reasoning holds for the law on abortion and on couples.

## Missing criteria, ranked

The ranking weighs how often a topic decides a move, how far it adds to what the app measures, and whether an open
source can measure it across the countries the app covers.

| Rank | Criterion | Open source and licence | Verdict |
|---|---|---|---|
| 1 | Jobs | World Bank WDI `SL.UEM.TOTL.ZS`, ILO modelled unemployment, CC BY 4.0 (read) | **Built:** dial `jobs` |
| 2 | Health care access | World Bank WDI `SH.MED.PHYS.ZS`, physicians per 1,000 (WHO), CC BY 4.0 (read). The UHC service coverage index (`SH_UHC_SCI`, CC BY 4.0) runs only from 77 to 92 across the covered countries (2023), too narrow to separate them. | **Built:** dial `doctors` |
| 3 | Schools | PISA country results (OECD). PISA 2022 tables are published as spreadsheets under OECD terms; no open per-country feed was found (the World Bank EdStats series ends at PISA 2018, and the OECD data explorer holds no PISA dataflow). The PISA student files must not be redistributed. | Not built: needs a transcribed table of the latest published means, checked against OECD's own tables |
| 4 | Housing space | US Census Housing Vacancy Survey (US public domain); Eurostat `ilc_lvho03` rooms per person and `ilc_lvho05a` overcrowding (Eurostat reuse policy, EU and EFTA). No comparable source for the other countries. | Not built: covers half the countries |
| 5 | Walkable everyday shops | OpenStreetMap, ODbL 1.0: shops, pharmacies and services within a walk of homes | **Built:** dial `walkable` (see "Walking and cycling" below) |
| 6 | Belonging | European Commission, Quality of Life in European Cities 2023 (83 cities, CC BY 4.0) | Not built: Europe only |
| 7 | Safety beyond homicide | Same EC survey: feeling safe at night | Not built: Europe only |
| 8 | Working hours | ILOSTAT working-time statistics, CC BY 4.0 for data published from May 2023 | Not built: must compare like with like (part-time share skews the mean) |
| 9 | Culture and nightlife | OpenStreetMap venues, ODbL | Not built |
| 10 | Quiet | EEA Environmental Noise Directive data, CC BY 4.0, Europe | Not built |
| 11 | Clean government | World Bank Worldwide Governance Indicators, Control of Corruption (`GOV_WGI_CC.EST`), CC BY 4.0 (read on the World Bank Data Catalog) | **Built:** dial `clean_government`. Ranked low by mover surveys, built because one open source covers every country the app does and it measures how far dealings with officials can be trusted. |

Rejected as sources: Numbeo and the EIU (terms forbid republishing), RSF's press-freedom index (no reuse without
consent), Equaldex (terms forbid copying), LawAtlas and ILGA's reports (non-commercial licences).

## Work and ambition: who is around

The question is whether ambitious, skilled people live in a place: people to hire, to found a company with, to learn
from. No single open figure measures ambition, so the app offers several honest proxies, each opt-in, each saying what
it counts. Researched 5 November 2026; terms read on the publishers' pages that day.

| Signal | Source | Terms | Verdict |
|---|---|---|---|
| Adults with a degree | Eurostat Urban Audit `TE2031I` (city), EU Labour Force Survey `edat_lfse_04` (NUTS 2 region), US Census ACS table B15001 (city), World Bank `SE.TER.CUAT.ST.ZS` from the UNESCO Institute for Statistics (country) | CC BY 4.0; US public domain; CC BY 4.0 (read) | **Built:** dial `degrees`, metric `degree_share`. One definition throughout: highest qualification at ISCED level 5 to 8 (in the US an associate's degree or higher), ages 25 to 64; the country stand-in counts ages 25 and over |
| Developers | GitHub user search, total count of profiles whose location names the city | Acceptable Use Policies, section 7: public, non-personal information may be used for research published openly; only a count is kept (read) | **Built:** dial `developers`, metric `github_developers`, per 1,000 residents. A name shared with a large place elsewhere gets no figure unless profiles that name a country show the other place is rare |
| Research output | OpenAlex | CC0 | Already built: research density |
| Founders Running Club | foundersrc.com | Facts of presence only | Already built |
| Jobs | World Bank unemployment | CC BY 4.0 | Already built; grouped here |
| Startups by city | Y Combinator directory | Terms forbid copying, scraping and data mining (read) | Link only (`registry/yc-directory.json`) |
| Startup ecosystem rankings | Startup Genome | Proprietary (decision D2) | Link only |
| Product launches | Product Hunt API | "Must not be used for commercial purposes" (read): the compiled data is CC BY, which allows commercial reuse | Not used |
| Tech meetups | Meetup | No open data feed found; the terms page did not render for an automated read | Not used |
| Venture funding | Crunchbase, Dealroom, PitchBook; OECD venture capital statistics | Proprietary; the OECD's are national only | Not built |
| Companies founded per city | Wikidata | CC0, but its query service rate-limits this build machine, and counts follow Wikipedia's notability | Not built |

**What each proxy misses.** A degree share says nothing about drive, and a high one can mean a university town
(Cambridge, 79% in 2018) as much as a startup hub. GitHub counts follow what people type: many leave the location
empty, some name the big city next door, and cities whose population figure is the whole metropolitan area (Sydney,
Melbourne) read low. Research output counts papers, not companies. Read together they say more than any one alone.

## Walking and cycling

Everyday distances on foot and by bike: whether daily needs are a walk away, how much of
the city is built for bikes, how many people already walk or cycle to work, and how soon a cyclist leaves the dense
city behind.

| Signal | Source | Terms | Verdict |
|---|---|---|---|
| Everyday needs on foot | OpenStreetMap via Overpass: residential streets within 5 km of the centre; a food shop, a pharmacy or doctor, a school, a park and a public-transport stop, each within 1 km as the crow flies (about 15 minutes on foot) | ODbL 1.0, share-alike (read) | **Built:** dial `walkable`, metric `walkable_share`, kept apart under the ODbL |
| Cycle network | OpenStreetMap: cycle paths plus roads with a separate cycle track tagged on them, within 10 km, per km² of land | ODbL 1.0 | **Built:** metric `bike_network`; the `cycling` dial now reads it instead of cycle-path length, which ignored tracks tagged on roads (common in Copenhagen) and counted the sea as city |
| Walking or cycling to work | Eurostat Urban Audit `TT1007V` plus `TT1008V` (same year, 2010 or later); ACS table B08301 | CC BY 4.0; US public domain | **Built:** dial `active_commute`, metric `active_commute_share`. Several European cities last reported before 2010 (Copenhagen, Amsterdam) and get no figure |
| Out of the dense city | GHSL Urban Centre Database 2025 (R2024A): distance from the centre to the nearest edge of the urban centre over land | CC BY 4.0 (read in the dataset's copyright notice) | **Built:** dial `way_out`, metric `city_edge_km`, shown in minutes at 15 km/h |
| Bicycle-friendliness ranking | Copenhagenize Index | All rights reserved (read) | Link only (`registry/copenhagenize.json`) |
| Cycling to work outside the EU and the US | National censuses (Statistics Canada, ABS) | Open government licences | Not built yet |

**Limits.** The walking test is straight-line, so a river or a motorway without a crossing makes a real walk longer.
OpenStreetMap counts how well a city is mapped as well as what exists, and doctors' surgeries are mapped unevenly,
so a pharmacy counts too; a need missing for more than half the streets is read as a thin map, and the place gets no
figure. Dense European centres score near the top on walking (Turin 97%, Milan 100%); the test
separates them from car-built cities more than from each other. The urban centre ends where density falls below
1,500 people per km², which is suburbs or farmland as often as open country.

## Politics: sources

| Source | What it gives | Licence | Used |
|---|---|---|---|
| ParlGov 2024 (Döring and Manow), doi:10.7910/DVN/2VZ5ZC | Party left-right positions, 0-10, from expert surveys; elections to mid-2023 | CC0 (read on Dataverse) | **Yes**, party positions |
| Wikidata | Election results (party, votes) and party political alignments | CC0 | **Yes**, votes for 15 countries and the alignment fallback |
| MIT Election Data and Science Lab, U.S. President 1976-2024, doi:10.7910/DVN/42MVDX | US presidential votes by state | CC0 (read) | **Yes** |
| Electoral authorities and statistics offices | Official results: Sweden, Ireland, Belgium, Czechia, Portugal, Denmark, Switzerland (OPEN-BY, read), Canada, Australia | Official results, cited per country | **Yes** |
| Global Party Survey 2019 (Norris), doi:10.7910/DVN/WMGTNS | Party positions for 1,043 parties in 163 countries | CC0 (read) | Candidate to place parties ParlGov lacks; a different scale, so it needs calibrating first |
| V-Party v2 (V-Dem) | Party positions, 1970-2019 | CC BY-SA 4.0 | Not used: ends 2019, and share-alike would bind the derived table |
| Manifesto Project | Coded election programmes | Terms forbid redistribution without written permission (read) | **Excluded** |
| CHES 2024 (Chapel Hill Expert Survey) | Left-right and GAL-TAN positions, Europe | No dataset licence found | Excluded until one is |
| CLEA | Constituency results worldwide | Terms conflict (ODbL named, permission asked for commercial use) | Excluded |
| EU-NED, doi:10.7910/DVN/IQRYP5 | National votes by NUTS region | CC0 | Candidate for regional figures inside European countries |

How the figure is built is in [positions.md](positions.md).

## Rights: sources

No open, harmonised, current table of abortion or couples law covers the countries the app does: the Center for
Reproductive Rights map grants no reuse of its data, the WHO Global Abortion Policies Database reserves its rights
(WHO's own publishing default is CC BY-NC-SA 3.0 IGO), and Equaldex forbids copying. So each fact is read from the law
itself and cites it (`src/fetch/rights-law.ts`). Laws are not under copyright in the US (17 USC §105 and the
government-edicts doctrine), Japan (Copyright Act art. 13) or the UAE (Federal Decree-Law 38/2021, art. 3); the UK
publishes legislation under the Open Government Licence, Australia's federal register under CC BY 4.0, and Canada's
federal laws may be reproduced freely (SI/97-5).

Open sources for more legal facts, not built:

| Fact | Source | Licence | Coverage |
|---|---|---|---|
| Women's legal equality (work, travel, property, inheritance) | World Bank, Women, Business and the Law | CC BY 4.0 | 190 economies, law as of 1 Oct 2025 |
| Cannabis | EUDA cannabis-law source data; State Cannabis Policy Bundles (Mallinson et al.) | CC BY 4.0; CC0 | Europe; US states to 2023 |
| Death penalty | US Bureau of Justice Statistics, Capital Punishment | US public domain | US states, to 2023 |
| Firearms | ATF, State Laws and Published Ordinances | US public domain | US states, citations only |
| Assisted dying | The statutes | As above | Coding needed per country |

## Sources

Surveys and books (reported):

- InterNations, Expat Insider 2024. https://www.internations.org/expat-insider/
- Statistics Canada, Canadian Housing Survey 2022.
- AARP, 2024 Home and Community Preferences Survey.
- Pew Research Center, community and housing preference surveys of 2014, 2021 and January 2026. https://www.pewresearch.org/
- National Association of Realtors, Community and Transportation Preferences Survey 2026.
- Redfin/Ipsos survey of likely movers, 2024.
- Zillow Consumer Housing Trends Report 2025.
- Ray Oldenburg, *The Great Good Place*. https://www.berkshirepublishing.com/title/tggp-2023/
- Richard Florida, *Who's Your City?* (2008). https://creativeclass.com/richard_florida/books/whos-your-city/

Data and licences:

- Eurostat, Urban Audit (cities and greater cities), CC BY 4.0. https://ec.europa.eu/eurostat/web/cities/database
- Eurostat, population by educational attainment and NUTS 2 region (edat_lfse_04), CC BY 4.0. https://ec.europa.eu/eurostat/databrowser/view/edat_lfse_04/default/table
- US Census Bureau, American Community Survey 1-year estimates, tables B15001 and B08301. https://www.census.gov/programs-surveys/acs/data/summary-file.html
- World Bank, Educational attainment, at least completed short-cycle tertiary, population 25+ (SE.TER.CUAT.ST.ZS), CC BY 4.0. https://data.worldbank.org/indicator/SE.TER.CUAT.ST.ZS
- GitHub, Acceptable Use Policies, section 7. https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies
- GitHub REST API, search users. https://docs.github.com/en/rest/search/search#search-users
- Y Combinator, terms of use. https://www.ycombinator.com/legal
- Product Hunt API documentation. https://api.producthunt.com/v2/docs
- Copenhagenize Index. https://copenhagenizeindex.eu/
- GHSL Urban Centre Database 2025 (R2024A), CC BY 4.0, doi:10.2905/1a338be6-7eaf-480c-9664-3a8ade88cbcd. https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php
- Natural Earth land and lakes, public domain. https://www.naturalearthdata.com/

- World Bank, Unemployment (ILO modelled), SL.UEM.TOTL.ZS, CC BY 4.0. https://data.worldbank.org/indicator/SL.UEM.TOTL.ZS
- World Bank, Physicians per 1,000 people, SH.MED.PHYS.ZS, CC BY 4.0. https://data.worldbank.org/indicator/SH.MED.PHYS.ZS
- World Bank, UHC service coverage index, CC BY 4.0. https://data.worldbank.org/indicator/SH_UHC_SCI
- World Bank, Worldwide Governance Indicators, CC BY 4.0. https://datacatalog.worldbank.org/search/dataset/0038026
- World Bank, Women, Business and the Law, CC BY 4.0. https://datacatalog.worldbank.org/search/dataset/0038489
- OECD, PISA 2022 results. https://www.oecd.org/en/publications/pisa-2022-results-volume-i_53f23881-en.html
- ParlGov 2024, CC0. https://doi.org/10.7910/DVN/2VZ5ZC
- Global Party Survey 2019, CC0. https://doi.org/10.7910/DVN/WMGTNS
- MIT Election Data and Science Lab, U.S. President 1976-2024, CC0. https://doi.org/10.7910/DVN/42MVDX
- EU-NED, CC0. https://doi.org/10.7910/DVN/IQRYP5
- V-Party. https://www.v-dem.net/data/v-party-dataset/
- Manifesto Project terms of use. https://manifestoproject.wzb.eu/information/documents/terms_of_use
- CLEA licensing. https://electiondataarchive.org/about/licensing/
- CHES. https://www.chesdata.eu/
- WHO Global Abortion Policies Database, copyright. https://abortion-policies.srhr.org/copyright
- Center for Reproductive Rights, world abortion laws. https://reproductiverights.org/maps/world-abortion-laws/
- EUDA cannabis laws in Europe, source data. https://www.euda.europa.eu/data/repository/cannabis-laws-europe-questions-and-answers-policymaking-source-data_en
- State Cannabis Policy Bundles, CC0. https://doi.org/10.7910/DVN/2SB7ZF
- US Bureau of Justice Statistics, Capital Punishment. https://bjs.ojp.gov/data-collection/capital-punishment-nps-8
- ATF, State Laws and Published Ordinances. https://www.atf.gov/firearms/tools-and-services-firearms-industry/state-laws-and-published-ordinances-firearms
- OpenStreetMap copyright and licence, ODbL. https://www.openstreetmap.org/copyright
- ILOSTAT working time. https://ilostat.ilo.org/databases/cond/
- EEA noise data. https://www.eea.europa.eu/en/datahub/datahubitem-view/c952f520-8d71-42c9-b74c-b7eb002f939b
- European Commission, Quality of Life in European Cities 2023. https://ec.europa.eu/regional_policy/information-sources/maps/quality-of-life_en
