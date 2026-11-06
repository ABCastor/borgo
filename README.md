# Borgo

[![checks](https://github.com/ABCastor/borgo/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/ABCastor/borgo/actions/workflows/checks.yml?query=branch%3Amain)

Borgo (Italian for a village) compares any number of cities on open data, weighted by what you value: what you would earn after tax and keep after rent, who in your household can move there without a visa, and how each place does on climate, air, safety, health and research. Every figure shows its source, the period it describes, and whether it describes the city itself or only its country.

It runs in the browser with no account and no server. The same engine runs as a command-line tool (`borgo`, which also answers to `where-to-live`) and as an MCP server, so an AI assistant can answer "where should I live?" with the numbers you would see.

> **Why I built this:** I was deciding with a co-founder where to live and start a company, weighing San Francisco, London and Dublin against staying here in Torino. When I put together my own comparison, every site I pulled from answered one slice: one had price levels, another weather, another a salary calculator, and none weighted them by what mattered to me or said whether both of us could legally work there. Teleport, which once put those pieces together, is gone. So I built the comparison I wanted and made it open, for anyone (or their agent) to run with their own weights.

**Status:** early. Any city can be fetched on demand; 57 have public pages. Take-home pay for 26 countries (most of Europe, the United Kingdom, the United States with eight state modules and New York City, Canada, Australia, Singapore, Japan and the UAE), and 17 tax regimes for people moving in, with their conditions and how long they last.

## Quickstart

Needs [Node.js](https://nodejs.org/) 26 or newer, which runs the TypeScript sources directly.

```sh
npm install
node pipeline/build-data.ts      # assemble data/ into public/data/dataset.json, refusing anything unsourced
node scripts/build.ts --serve    # build dist/ and serve it at http://127.0.0.1:8794/
npm test                         # engine, money model and tax modules
```

Pick your cities and the answer is there: the cities ranked on two dials, money left and nice days, with one sentence saying who leads and the one input that would make the answer firmer (your salary, a rent no open source has, a passport). Nice days are yours to define: the range, 18 to 30 °C feels-like to start, sits on the nice-days dial and on every sheet. Add a third priority if you like; the rest (the right to live there as a weight, health, safety, children once you have them, people, work and ambition, getting around, nature, where you stand, and lines of your own) waits under **More priorities**, each group one dial with its parts inside. **Who can move there** is a check, not a dial: give each person's passport and every sheet says yes, needs a visa or permit, or not checked; mark it must pass to rule out the rest. No salary is assumed: money counts once you give one (one figure everywhere, or one per city), and pension shares, tax settings and newcomer regimes sit behind each money sheet's advanced section. Click any figure to see where it came from, or replace it with your own number. **Settings** (the gear) switches °C or °F, km or miles, the currency money is shown in, and how numbers and dates are written.

**Your comparison stays in your browser** (its local storage) and is sent nowhere. **Share** shows what its link will carry before you copy it: the cities, the weights and must-pass lines, the nice-day range, the home size and the settings. Pay, spending and savings; who is moving (names, passports, ages, children); your own numbers (rents and replaced figures); your own lines; and where you stand stay out unless you tick them. The link carries them after `#share=`, the part of an address browsers never send to a server, and the app removes it from the address once read. The page loads its own files and nothing else; adding a place sends only its name and coordinates to the sources that cover it.

**Explore more places**, under your cities (and on its own page, **Map**), colours the whole world by what you value: your own score, nice days in your own range, who in your household may live there, money kept or any other dial, and it follows the dials as you move them. The land shows how many months of the year, 0 to 12, have an afternoon high in your nice-day range, and changes as you change the range. Your cities are ringed and ranked on whatever the map shows. Point at any city or town to read it; click it to pin its card (its months in your range, take-home pay once you give a salary, and the figures its rank rests on), and add it from there with **Add to my cities**. The card works from the keyboard and closes with Escape; on a phone it rises from the bottom of the screen.

## How the score works

Each line turns one figure into a score from 0 to 1 against a fixed worst and best: PM2.5 runs from 35 µg/m³ down to the WHO guideline of 5, the shortest day of the year from 6 to 11 hours. Your weight decides how many of the 100 points that line can give. A group's dial is the sum of its lines' weights: moving it shares the new weight over them in the proportions they had, so the score is the same as setting each line by hand. A missing figure never scores better than a real one. Where a city has no figure on a line, it scores as the lowest of your other cities on it, so a gap can only cost it, never win it a place; a line no city has a figure for counts for none of them; and a city that lacks a figure your other cities have is marked "Partial data", with the share of its score that rests on its own figures and what it lacks. A passport, a salary or a rent you have not given is not partial data: the answer asks for it instead. Money is never filled in: when one city lacks rent, every city is compared on take-home pay alone, less the health premium where cover is bought outside pay (or on cost alone when no salary is given, or money is left out of the score), and one line says so with the input that would fix it, such as "add your rent for Zurich". When a city's missing figures could still carry it past the leader, the answer says the lead is provisional and what is missing. A line marked *must pass* passes, fails or is unknown: a city that fails is ruled out, and a city that cannot be checked yet (no figure, a passport not given) is shown as unknown and ranks after every city that passes. "Everyone can move there" is the usual one; a person whose passports are not given is not checked, rather than called in need of a visa.

"What you keep" each month is take-home pay (gross salary through the country's tax model, after pension contributions) minus rent, minus your own monthly spending scaled by the city's price level, minus childcare for children under 6 after public support (your own cost when you give it, none when you use no paid care), minus health costs paid out of pocket and any health insurance premium bought outside pay. A figure that leaves out a cost that is due (a premium, childcare with no open figure) reads "at most", names what it lacks with a field to add it, and is not scored until it is whole; a tax approximation is named beside the figure; a newcomer regime you count without confirming every condition is labelled a scenario. Cost of living is shown beside it and counts on its own only if you weight it, since money left already counts every cost. Savings show as months of expenses covered with no income. You can override any of it.

## Where the data comes from

The project keeps a curated list of sources, not a copy of their figures. `registry/` holds one file per source: what it measures in plain words, where and when it applies, its licence, whether we may redistribute it, how to fetch it (endpoint, whether a browser may read it, any key), how often it changes, and who vetted it. Your browser, the CLI or the MCP server fetch from those sources for the places you ask about and keep the figures, each with the address it was read from, on your side. See [docs/architecture.md](docs/architecture.md).

Any real place works: type "Palermo" in the app, run `borgo fetch "Palermo, IT"`, or ask your agent through the MCP server. A small snapshot of open-licensed figures for 57 seed cities is committed so the public city pages can show numbers.

| What | Source | Licence | Level |
|---|---|---|---|
| Place, coordinates, population, region | [GeoNames](https://www.geonames.org/) (through Open-Meteo's geocoder), [Wikidata](https://www.wikidata.org/) | CC BY 4.0, CC0 | city |
| Air and feels-like temperature, hourly temperature, cloud, wet days | [Open-Meteo](https://open-meteo.com/) (ERA5 reanalysis, last five full years) | CC BY 4.0 | city coordinates |
| Sunshine, measured | [WMO 1991-2020 normals](https://www.ncei.noaa.gov/products/wmo-climate-normals) (NOAA NCEI), [Meteostat](https://dev.meteostat.net/) | WMO policy, CC BY 4.0 | nearest station |
| Fine dust (PM2.5) | [WHO Ambient Air Quality Database](https://www.who.int/data/gho/data/themes/air-pollution/who-air-quality-database), else [CAMS](https://open-meteo.com/en/docs/air-quality-api) modelled | WHO terms, CC BY 4.0 | city |
| Rents | [ONS](https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics) (UK), [CSO and RTB](https://data.cso.ie/table/RIA02) (Ireland) | OGL v3, CC BY 4.0 | city or region |
| Price levels, homicides, life expectancy, doctors, unemployment | [World Bank WDI](https://databank.worldbank.org/source/world-development-indicators) | CC BY 4.0 | country |
| Control of corruption | [World Bank Worldwide Governance Indicators](https://www.worldbank.org/en/publication/worldwide-governance-indicators) | CC BY 4.0 | country |
| Politics, left to right | Latest national election: official results from the electoral authorities, party positions from [ParlGov](https://doi.org/10.7910/DVN/2VZ5ZC); 18 countries, Swiss cantons, Canadian provinces and Australian states, no figure where too little of the vote is positioned; see [docs/positions.md](docs/positions.md) | CC BY 4.0 (as compiled here) | country, canton, province or state |
| Abortion law, same-sex couples in law | The statutes, each cited | official texts | country, or US state |
| Life satisfaction | [OECD Well-being Database](https://www.oecd.org/en/data/datasets/well-being-database.html) | OECD terms | country |
| Research output per resident | [OpenAlex](https://openalex.org/) institutions | CC0 | city |
| Developers on GitHub per 1,000 residents | [GitHub user search](https://docs.github.com/en/rest/search/search#search-users): total counts of profiles by location only | no data licence; counts only (GitHub Acceptable Use Policies) | city |
| Distance to the edge of the built-up city | [GHSL Urban Centre Database 2025](https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php) (European Commission, JRC) | CC BY 4.0 | city |
| Adults with a degree | [Eurostat regional labour force survey](https://ec.europa.eu/eurostat/databrowser/view/edat_lfse_04/default/table) (edat_lfse_04) | Eurostat reuse with acknowledgement | region |
| Walkable streets, cycle network | [OpenStreetMap](https://www.openstreetmap.org/copyright) via the Overpass API | ODbL 1.0 | city |
| The world map: land, countries, towns | [Natural Earth](https://www.naturalearthdata.com/) 1:50m countries, 1:10m populated places | Public domain | country, town |
| The world map: afternoon high by month | [NASA POWER](https://power.larc.nasa.gov/) climatology (MERRA-2, 2001-2025) | CC0 | grid of about 50 km, averaged per map tile |
| Free movement | EU Directive 2004/38/EC, the EEA Agreement, the EU-Swiss agreement, the UK-Ireland Common Travel Area, the Trans-Tasman arrangement | official texts | country |

Numbeo, WeatherSpark, the EIU and similar closed sources are in the registry as link-only pages: their terms forbid copying and automated reading, so the app links to them and no agent fetches them. A figure you read there yourself can be kept as your own number, in your browser or your own cache, and is never copied into this project.

**Politics and the law are positions, not scores.** You say where you stand and a place scores by how close it is; until you do, those lines show the fact and count for nothing. See [docs/positions.md](docs/positions.md), and [docs/values-research.md](docs/values-research.md) for what people weigh when choosing where to live and the open data behind each dial.

**Sunshine is measured, not modelled.** Reanalysis models overstate sunshine by 30 to 90% against weather stations (ERA5 gives London 2,765 hours a year; Heathrow measures 1,595), so sunshine comes only from station normals and is missing where no station is close.

**The real gap is rent.** No open source gives a one-bedroom rent for cities worldwide: official data covers the UK and Ireland today. Elsewhere the app asks for your own figure rather than inventing one. Research output counts papers per resident from universities, labs, hospitals and companies; it is a proxy for "who is in the room", not a count of startups. Homicides and the other World Bank lines are national figures standing in for the city, and say "national" beside the number.

## Adding to it

Everything is a small, separate piece.

- **A city** needs nothing: any place resolves on demand. A seed city (one with a public page) is one line in `data/cities.seed.json`; run `node pipeline/sources/geonames.ts`, then the snapshot sources.
- **A source** is one file in `registry/` (copy a similar one; `npm test` validates it) and, to fetch it on demand, one fetcher in `src/fetch/` registered in `src/fetch/index.ts` (browser and Node) or `src/fetch/node/index.ts` (Node only). `pipeline/build-data.ts` refuses snapshot figures from a source the registry does not clear for redistribution, or does not declare for that metric.
- **A metric** is one entry in `src/core/metrics.ts`.
- **A scoring line** is one entry in `src/core/criteria.ts`: what it asks, its worst and best, and how it reads the data. It joins a group by its category, or by name in `src/core/groups.ts`.
- **A country's tax** is one module in `src/tax/` with its official sources and caveats, registered in `src/tax/index.ts`, with worked examples in `test/`.

Pull requests need a source and a licence for every number they add.

**Corrections** to any figure, rule or source are welcome from people and their agents: **Suggest a correction** under any figure's sources, the [proposal form](https://github.com/ABCastor/borgo/issues/new?template=proposal.yml), or `propose_change` in the MCP server (`borgo propose` on the command line). Each proposal cites the official text it comes from and is checked on GitHub, then reviewed; `borgo stale` lists the curated facts due for review. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

The Map follows the spirit of Nick Winans' [Where to Live](https://github.com/Nicell/where-to-live) map of pleasant days in the US (MIT); no code is copied from it.

Code under the [Apache License 2.0](LICENSE). Compiled data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with each source's own licence kept beside its figures. Fonts under the SIL Open Font License, with their licence files in `public/fonts/`.

<p><a href="https://abcastor.com"><img src="docs/castor-footer.svg" width="350" alt="Chip, the Castor beaver, Castor, we give a dam"></a></p>
