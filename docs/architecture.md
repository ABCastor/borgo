# Architecture: a source registry, fetched on the person's side

## 1. The idea

The project does not store the world's figures. Committing every figure for a fixed list of cities would re-publish other people's data, limit the comparison to the places on the list, and let figures age in the repository. What the project keeps is judgement: **which sources are good for which question, what each one measures, under which terms, and how to fetch it.** The person's browser, CLI or MCP server does the fetching, for the places they ask about, so any real place works.

## 2. Values and boundaries

| Value | What it imposes |
|---|---|
| The curated list is the product | Every source is a reviewed registry entry: plain definition, coverage, licence, redistribution, fetch recipe, refresh, who vetted it. A new source is one pull request. |
| Fetch on the person's side | Fetchers run in the person's browser, CLI or MCP server and write to their own cache. We run no data server. |
| Any real place | A place resolves on demand from an open gazetteer, not from our list. |
| Provenance on every figure | Source, period, level, retrieval time, the address read and the fetcher version. Agent-reported figures are marked unverified. |
| Respect each publisher's terms, not only its licence | Link-only sources (Numbeo, WeatherSpark …) are for people to read: their terms or robots rules forbid automated reading. An agent never fetches them; a figure the person reads there and passes on stays in that person's cache (section 10). |
| Never invent a missing input | A place in a country without a tax model, an exchange rate or a station gets a visible gap with its reason, never zero tax, a rate of one or a modelled stand-in. |
| Understandable everywhere | One plain sentence per metric in `src/core/metrics.ts`; air vs feels-like temperature; sunshine by the WMO definition. |

Non-goals: a hosted API, a crawler keeping the world up to date, reading proprietary sites on anyone's behalf.

## 3. The pieces

```
 registry/*.json (committed, vetted)  ──►  what to fetch, how, under which terms
        │
 "Palermo, IT" ─► src/places/resolve.ts ─► src/fetch/* ─► the person's cache ─► engine (unchanged) ─► UI / CLI / MCP
                  GeoNames + Wikidata       one fetcher     provenance on          snapshot ∪ cache
                                            per source      every figure
 data/observations/ (committed snapshot: open-licensed figures for the 57 seed cities, built by the same fetchers)
```

### 3.1 Registry: `registry/<id>.json`

One file per source (57: 37 fetched by API or file, 8 curated from legal or cited texts, 12 link-only). Schema and validator in `src/registry/schema.ts`; loaded by `src/registry/load.ts`; written to `public/data/registry.json` for the browser; the dataset's `sources` are built from it, so each source has one home.

| Field | Meaning |
|---|---|
| `measures[]` | metric ids with what *this source* counts, in plain words |
| `coverage` | geography, level (city, region, country), period |
| `licence`, `licenceUrl`, `redistribute` | `yes` (may be in the snapshot), `share-alike` (kept apart, ODbL), `no` (never stored by us) |
| `rights` | required unless `redistribute` is `no`, forbidden on link-out sources: `licenceId` (from the catalogue in `src/registry/licences.ts`), `edition` read, `termsUrl` and `termsRead`, `attribution`, `notices`. The licence decides which published file holds the figures (`docs/data-sources.md`) |
| `access` | `api` / `bulk` (our fetchers read it), `curated` (encoded here from cited texts), `link-out` (people read it; we never fetch it) |
| `fetch` | `mode` (`per-city` on demand, or `batch`, only in the seed pipeline), `runtimes`, `endpoint`, `cors`, `key`, `rateLimit`, `fetcher` (the code path) |
| `linkOut` | the publisher's page for a place |
| `refresh` | cadence and `maxAgeDays` |
| `vetted` | `humanSelected`, `by`, `on`, `notes`. Two entries are human-selected (Founders Running Club, WeatherSpark); the rest were selected by an agent and await human review |
| `caveats`, `personalUse` | known biases; for link-only sources, what a person and their agent may do |

`npm test` refuses an entry whose metrics do not exist, a link-only source with a fetcher, redistribution or rights, a redistributed source without rights or with an unknown licence, a browser runtime without CORS, a missing definition or vetting record. `pipeline/build-data.ts` refuses a snapshot figure whose source has no rights, an unknown licence, a folder other than its licence requires, or does not declare that metric; it writes `public/data/dataset.json` (the CC BY 4.0 compilation), one file per other set of terms (`dataset-odbl.json`, `dataset-who.json`, `dataset-cmhc.json`) and the licence manifest `public/data/licences.json`.

### 3.2 Places: `src/places/`

Free text ("Palermo", "Palermo, IT", "Cork, Ireland", "Tenerife", "Bangalore", `geonames:2523920`) becomes a `City` with GeoNames id, coordinates, elevation, population, time zone and ISO 3166-2 region.

1. **Open-Meteo's geocoder** (GeoNames records, CC BY 4.0, CORS, no key); populated places, the most populous first, hamlets under 1,000 people dropped from the alternatives. The CLI and MCP list the alternatives with their region so a person can pick another by GeoNames id. No population threshold, country list or tax model limits what can be added.
   - **Islands and countries.** When the best answer is an island, a group of islands or a country with more people than any town of that name, it stands for its main town: a country for its capital, an island for the biggest town near its centre (within 30 to 150 km, more for a more populous island; each town weighed down by its distance, so Las Palmas does not win for Tenerife). The towns are the map's (section 6.1, Natural Earth, read by GeoNames id) plus the geocoder's own. Tenerife becomes Santa Cruz de Tenerife, Lanzarote Arrecife, Mallorca Palma, Madeira Funchal, Malta Valletta, Mauritius Port Louis; the city keeps the island's name as an alias, and every face says "read as Santa Cruz de Tenerife, the main town of Tenerife". A low island with no town found stands for its own centre (Fuerteventura); a mountainous one does not, since its centre has a summit's climate.
   - **Other names.** The geocoder matches a place's own name, so when it finds no town of 100,000 people by that name, Wikidata's search reads labels and aliases (Bangalore, Kiev, Saigon) and the geocoder is asked for the GeoNames ids it names. Only exact matches count: the search also matches prefixes.
2. **Region code:** a committed table for the 26 regions the tax rules name (`src/places/regions.ts`), else Wikidata (`P1566` GeoNames id of the first-level division → `P300`). Sicily → IT-82, Connacht → IE-C. A busy Wikidata only costs the region: national rates apply.
3. **Fallbacks:** GeoNames' own search when the person sets `GEONAMES_USERNAME` (their own account: a shared one would share its quota). A busy Wikidata costs only the other names.
4. **Ids:** a seed city keeps its id (same GeoNames id → same city). Otherwise `<name>-<cc>`, then `<name>-<region>-<cc>`, then `<name>-<geonames id>-<cc>`; re-resolving a fetched place returns the id it already has. The GeoNames id is the identity; the slug is for reading.

### 3.3 Fetchers: `src/fetch/`

A fetcher is `{ source, version, runtimes, covers?, fallbackFor?, fetch(city, ctx) }`. It uses only `ctx` (`src/fetch/context.ts`: fetch with deadlines, retries and `Retry-After`; a cache for large files; the clock), so the same code runs in the browser, the CLI, the MCP server and the snapshot build. Node-only fetchers (xlsx, gzip, no CORS) live in `src/fetch/node/` and never reach the browser bundle. `fetchCity` runs every fetcher that can run here and covers the place, then each fallback only if its primary gave nothing, and returns one outcome per source (`ok`, `empty`, `failed`, `skipped`, with the reason).

| Source | Fetcher | Browser | Node | Metrics |
|---|---|---|---|---|
| Open-Meteo archive (ERA5) | `open-meteo.ts` | yes | yes | air and feels-like highs and lows, their spread and extremes, hourly temperature by month, cloud cover, wet days, weather-day scores (nice, beach, run or ride, muggy, grey, hot nights, heat stress, snow, wind) |
| WMO 1991-2020 normals (NCEI) | `sunshine.ts` | yes | yes | sunshine, by month and year |
| Meteostat normals | `node/meteostat.ts` | no CORS | fallback for WMO | sunshine |
| WHO Ambient Air Quality Database | `node/who-air.ts` | no CORS, xlsx | yes | PM2.5, measured |
| CAMS via Open-Meteo | `air.ts` | yes | fallback for WHO | PM2.5, modelled |
| World Bank WDI | `country.ts` | yes | yes | price level, homicides, life expectancy (country level) |
| World Bank Worldwide Governance Indicators | `country.ts` | yes | yes | control of corruption (country level) |
| Election results and party positions | `politics.ts` | yes | yes | politics, left to right (country, or canton, province or state), read from the table committed in `pipeline/inputs/` |
| Abortion law, same-sex couples in law | `rights-law.ts` | yes | yes | the law's standing, from the cited statutes encoded in this repository |
| OECD Well-being | `country.ts` | no: a browser's own request is refused for CORS, though a plain request with an `Origin` header gets the header | yes | life satisfaction (OECD members, country level) |
| OECD net childcare costs | `family.ts` | no, as above | yes | childcare fees and their cost after public support (OECD members, country level) |
| OpenAlex | `research.ts` | yes | yes | research output and density |
| CSO / RTB (Ireland) | `rent.ts` | yes | yes | rents, any Irish place the table names |
| ONS (UK) | `node/ons-rent.ts` | no CORS, xlsx | yes | rents by local authority |
| Eurostat Urban Audit | `eurostat-urban.ts` | yes | yes | commuting, walking or cycling to work, transit pass, road deaths, green space, born abroad, public pools, adults with a degree; the place is found by its name among the Urban Audit's city labels |
| GitHub user search | `github.ts` | yes | yes | developers per 1,000 residents (10 searches a minute without a token) |
| OSM walking and cycling (Overpass) | `node/osm-walk-cycle.ts` | not run (heavy queries) | yes | everyday needs on foot, cycle network |
| GHSL urban centres | `node/ghsl.ts` | no CORS, GeoPackage | yes | distance from the centre to the edge of the dense city |

CORS is checked with an `Origin` header on the exact GET each fetcher makes, and recorded per entry. Batch-only, for the seed cities (`pipeline/sources/`): OSM counts within 10 km, ROR, airports, sea and mountain distances, ACS, the EU Labour Force Survey by region, CLDR, M-Lab, Founders Running Club.

### 3.4 The person's cache

- **Node:** `$BORGO_HOME` (or `$WHERE_TO_LIVE_HOME`), default `~/.cache/borgo/`: `cities/<id>.json` (the city, every observation with provenance, each source's outcome, the fetch time; written atomically) and `bulk/` (large files with their URL and date; 30 days). A cached place is reused for 30 days unless `--refresh`, or sooner when any of its figures came from an older fetcher version. A partial refresh (`--only`) keeps the other sources' figures.
- **Browser:** `localStorage`, one key per place (`borgo:city:<id>`; places saved under `where-to-live:city:<id>` are read too), merged over the snapshot at every visit. Storage failures cost only persistence. Places fetched in a browser stay in that browser.
- **The person's comparison** (the profile) lives in `localStorage` under `borgo:profile:v1` and is sent nowhere: the page requests only its own files, and a live fetch sends a place's name or coordinates to the sources that cover it, never the profile. A share link carries `sharedProfile()` (`src/ui/state.ts`) in the fragment after `#share=`, which browsers do not send to a server: by default the cities, the weights and must-pass lines, the nice-day range, the home size, the display currency and the settings. Pay, spending and savings; who is moving; the person's own numbers; their own lines; and their stances are each left out unless ticked in the share panel. Opening a link saves its profile in that browser and removes the fragment from the address; a place the link names that this browser has not fetched is named in the answer, to be added by name. The older `?p=` query is still read.

### 3.5 Engine and merge

The engine consumes one `Dataset`: `withFetched(snapshot, cached)` adds new places and, for a place the snapshot also has, replaces figures source by source and metric by metric (`src/fetch/index.ts`). Scoring, missing data and consolidation are the same for every place; a fetched Palermo is scored exactly like a seed city (tested). The snapshot is what the browser shows for the seed cities, including figures it could not fetch itself (WHO, ONS); only *live* fetching is limited by CORS.

### 3.6 Faces

- **CLI:** `borgo fetch "Palermo, IT" [--only a,b] [--refresh] [--json]` runs every fetcher in `src/fetch/node/index.ts`, which carries every browser fetcher that runs in Node too (tested in `test/registry.test.ts`); `borgo sources [--metric m] [--country CC]` lists the registry; every other command sees fetched places.
- **MCP:** `fetch_city`, `list_sources`, `record_observation` (a figure the agent read in an open source, or one the person read on a link-only page and gave it; marked agent-reported and unverified), and the comparison, city, pay and catalogue tools, which accept any fetched place.
- **One boundary, compact answers:** every face builds its profile through `src/agent/profile.ts`, which refuses what `profileProblems` in `src/core/engine.ts` names (negative or absurd amounts, weights outside 0-100, an impossible nice-day range, unknown criteria) and asks for the country when a name fits two places. The CLI and the MCP server answer in a compact summary by default (`summarize` in `src/agent/report.ts`: verdict, ranking with must-pass status, weighted lines cited with publisher and period, money in brief, notes, required unknowns, next inputs) and in full on request; every report carries `reportVersion` and, in `dataset`, the snapshot's `version` and `builtAt`, the exchange rates' `fxDate` and the `engine` version, so two answers can be matched (docs/agents.md).
- **Browser:** "Add any city" suggests any place the geocoder knows while the person types (with region, country and population, and the town an island or country stands for); picking one adds that exact place by GeoNames id. A name with a qualifier ("Cambridge, US", "London, CA") matches a seed city only when the qualifier is that city's country or region; otherwise it goes to the geocoder, so a namesake is never swallowed by the seed city. Typing a place the snapshot lacks and pressing Enter, or clicking a town on the Map (by its GeoNames id), resolves it and shows one line per source while it loads (waiting, fetching, done with its count, skipped or failed with the reason), then adds it. The source popover shows when a figure was read and links to what was read.

## 4. What a fetched place can lack, and how it says so

A place with partial data is still added. Its sheet and dossier say **Partial data** when it lacks something the comparison uses (a figure the other cities have, a tax model or free-movement rules where those lines count), beside the share of its score that rests on its own figures among the lines that count for some city, then what it lacks (`src/places/gaps.ts`): on the sheet in a short line ("no tax model for Israel yet, no free-movement rules; no figure for sunshine and 2 more"), in the dossier one gap per line with its reason. `fetch` in the CLI and `fetch_city` over MCP open with the same list.

| Capability | When it is missing | What the person sees |
|---|---|---|
| Region | Wikidata busy or no ISO code | national tax rates; no region in the place line |
| Take-home pay | no tax model for the country | "take-home not known: no tax model for Israel yet" on the sheet; "Take-home pay: no tax model for Israel yet" in the dossier |
| Any money figure | no ECB rate for the currency | "No exchange rate for COP … nothing is guessed" |
| Who may live there | no free-movement area covers the country | "Residence rules: only citizens count" |
| A scoring line | no source has a figure for the place | the line scores as the lowest compared city on it (never above a city with the figure) and is named in the gaps; coverage counts only observed figures |
| Money left | a compared city lacks rent, spending, a premium due or a tax model | every city is compared on take-home pay less any compulsory health premium, else on cost, else money counts for none; one note names the input to add; when a city could overtake the leader once its figures are known, the verdict says the lead is provisional and why |
| A must-pass line | no figure, or a passport not given | unknown, shown, never a pass; the city ranks after every city that passes |
| Sunshine | no station within the rules | the line is missing and scored as the lowest compared city, never modelled |
| A source | failure, timeout, no CORS, does not cover the place | its outcome row with the reason; the place is still added if any source answered |

## 5. What stays committed, and why

Three separate questions:

| Question | Answer |
|---|---|
| Do public pages show numbers? | Yes, for the 57 seed cities, from sources whose terms allow it, each with source, date and the attribution its terms require. Without numbers the city pages answer nothing a search engine or an AI assistant can quote. |
| Keep a dated, validated release of those numbers? | Yes: deterministic builds, survives an upstream outage, reviewable diffs. |
| Store it in Git? | Yes (`data/observations/`, under 1 MB): the simplest way to keep the release reviewable and reproducible. Fetching at build time and keeping the built artefact works too, at the cost of about an hour of Open-Meteo quota per build. |

Also committed: the registry; code and metric definitions; tax and newcomer-regime rules and free-movement rules (hand-encoded from official texts, each with its sources and year: they need review as laws change, like any data); the countries table (all 249 ISO countries with currency, from GeoNames); the seed list; a dated FX fallback.

Also committed: the world map, `data/map/world.json` (section 6.1).

Never committed: places outside the seed list, anything from a link-only source, the person's cache, bulk downloads.

## 6. Climate, made understandable

| Metric | What it is | Source |
|---|---|---|
| `temp_high`, `temp_low` | **Air** temperature 2 m above the ground in the shade, the mean of daily highs/lows by month | Open-Meteo ERA5, last five full years |
| `feels_high`, `feels_low` | **Feels like** (apparent temperature: air temperature with humidity, wind and sun counted), mean of daily highs/lows | Open-Meteo `apparent_temperature_max/min` |
| `temp_hourly` | Air temperature at each local hour, averaged per month (12 × 24 values, January 0:00 first), for an hourly chart | Open-Meteo hourly `temperature_2m` |
| `cloud_cover` | Share of the sky covered by cloud, monthly mean of every hour | Open-Meteo hourly `cloud_cover` |
| `temp_high_p10/p90`, `temp_low_p10/p90` | The usual spread: one day in ten has a high (or low) beyond this, by month | Open-Meteo hourly `temperature_2m`, daily highs and lows derived here |
| `temp_record_high`, `temp_record_low` | The highest high and lowest low of the five years, by month (not all-time records) | same |
| `nice_bins_feels`, `nice_bins_air` | Dry, mostly clear days by daytime temperature in whole degrees, by month: the person's comfortable range picks the **nice days** from them, live | hourly temperature, apparent temperature, precipitation, cloud cover |
| `beach_days`, `active_days`, `muggy_days`, `grey_days`, `hot_nights`, `hot_days`, `snow_days`, `windy_days` | Days a month passing one plain test each; definitions and sources in `docs/weather-scores.md` | hourly ERA5, seven variables in one request |
| `sunshine_hours`, `sunshine_monthly` | **WMO sunshine duration**: hours of direct sunlight of at least 120 W/m², roughly the hours bright enough to cast a sharp shadow | WMO 1991-2020 station normals, else Meteostat normals |
| `wet_days`, `wet_days_monthly` | Days with at least 1 mm of rain or snow | Open-Meteo |

**Why stations for sunshine.** Open-Meteo's derived `sunshine_duration` for 2021-2025 read well above the WMO 1991-2020 station normals: Heathrow 2,765 h against 1,595 (+73%), Dublin Airport 2,837 against 1,474 (+92%), Madrid 3,759 against 2,851 (+32%), Berlin-Tempelhof 2,900 against 1,736 (+67%). CERRA and Open-Meteo's satellite product also read high; the historical-forecast models matched at Heathrow and Dublin (probably the UK Met Office model there) but not at Madrid or Berlin. The periods differ, so this is not a measured model bias, but the gap is far beyond any decade-to-decade change and varies by place, so it cannot be corrected by a factor: **modelled sunshine is excluded until a matched-period comparison says otherwise.**

**Station rules.** The nearest WMO station within 50 km whose height differs by under 500 m; else Meteostat's nearest within 80 km by the same height rule (Node only); else no figure. The note always names the station, distance and height, so a "station stand-in" is visible as one. 52 of the 57 seed cities get a station; San Francisco, Los Angeles, New York, Bologna and Cambridge have none within the rules. Palermo gets Ustica, an island 68 km away, through Meteostat: shown as such.

### 6.1 The world map

The Map page colours the whole world, so it needs figures for places no one has asked about. Only two kinds exist everywhere, and only those colour the land:

| Layer | What it is | Source | Built by |
|---|---|---|---|
| Land tiles and their country | A 200 × 87 grid of squares on the Equal Earth projection (an equal-area map), 84° N to 56° S; a tile is land when two of nine sample points fall in a country | Natural Earth 1:50m admin-0 countries (public domain) | `pipeline/sources/world-map.ts` |
| Afternoon high by month, per tile | The monthly mean air temperature plus half the mean daily range, averaged over the POWER points on land in the tile | NASA POWER climatology, MERRA-2, 2001-2025, about 0.5° by 0.625° (CC0) | the same script, one regional request per 10° box and parameter |
| Small islands | A tile holding a town of 50,000 people or more is land even when the sampling misses its island (the Canaries, Madeira, the Azores, Malta, Mauritius), in the town's country, with the climate of the POWER point nearest the town | Natural Earth 1:10m populated places | the same script |
| Places a click can add | Towns of 50,000 people or more and every national capital, each with its GeoNames id (so a click adds that exact place: by name alone, Iraklio would find an Athens suburb) and a capital flag (a country's name stands for its capital) | Natural Earth 1:10m populated places (public domain) | the same script |
| Who may live where | Citizenship and the free-movement areas, for any country | `data/rights.json` | computed in the browser |

City points carry everything else, scored as each city would score if the person added it (`scoreCandidates` in `src/core/engine.ts`, tested to equal `evaluate` with the city added). A tile is about 150 km across and averages its ground, mountains included, so it reads cooler than a city in a valley; the card says so, and the cities keep their own nice days from Open-Meteo. The tiles use air temperature and know nothing of rain, cloud or humidity, so the land shows months whose afternoon high is in the person's range, not nice days.

`pipeline/build-data.ts` checks the map (shape, countries, sources declared in the registry and cleared for redistribution) and writes `public/data/map.json`, which the browser loads only on the Map page. Clicking land picks the nearest populated place and fetches it like any other place (section 3.6).

## 7. Privacy boundary

Calculations and the cache stay on the person's machine. The places they look up go to the named providers as names or coordinates (Open-Meteo logs coordinates for 90 days), with their network address. Salary, weights, household and passports never go to a data provider. A local MCP server returns results to whichever agent the person uses, which may run remotely. Recorded URLs contain no keys; a fetcher that needs a key must keep it out of the recorded URL.

## 8. Failure modes

| Failure | Handling |
|---|---|
| Stalled connection | 45 s deadline per request (3 min for large files), retried; then a `failed` outcome with the reason |
| Rate limit (429) or server error | up to three attempts, honouring `Retry-After` up to a minute; then `failed`. OECD answers 500 intermittently: re-run that source alone |
| No CORS in the browser | the source is not run; the panel says the CLI or MCP fetches it; the fallback runs instead (CAMS for WHO) |
| Ambiguous name | most populous first, alternatives listed with region and population, pick by `geonames:<id>` (in the browser, from the suggestions while typing; Enter takes the first) |
| Gazetteer gap | an island or country stands for its main town; Wikidata's labels and aliases for other names; otherwise "no place found, add the country" |
| Changed fetcher | cached places with figures from an older version are fetched again |
| Cache file damaged | skipped, not fatal; Node writes are atomic |
| Unsupported money | explicit gap with its reason (section 4) |

## 9. Promises and their checks

| Promise | Check |
|---|---|
| Every registry entry is complete and consistent; link-only sources are never fetched or redistributed; every fetcher's entry allows its runtimes; browser fetchers have CORS | `test/registry.test.ts` |
| Every snapshot figure's metric is declared by its source, and the source may be redistributed | `test/registry.test.ts`, `pipeline/build-data.ts` |
| Every exported figure's source has a known licence, edition and attribution; each licence's figures sit in their own file; an unknown licence fails the build | `test/registry.test.ts`, `pipeline/build-data.ts` |
| Sunshine comes only from station sources | `test/registry.test.ts` |
| Every metric has one plain sentence of definition; climate says air or feels-like | `test/registry.test.ts` |
| Any place resolves with its region; colliding names get distinct ids; a busy Wikidata costs only the region | `test/fetch.test.ts` (recorded network) |
| Tel Aviv and Hyderabad resolve; an island or a country stands for its main town or capital, read by GeoNames id; older names resolve through Wikidata, prefixes never; a mountainous island never stands for its summit | `test/places.test.ts` (recorded network) |
| A place in a country without a tax model, an exchange rate or free-movement rules says so on its sheet, dossier, CLI and MCP answer | `test/places.test.ts` |
| Every island with a town of 50,000 or more has a land tile on the map, and its towns carry GeoNames ids | `test/places.test.ts` |
| Each fetched figure carries the URL actually read, its fetcher version, period and time | `test/fetch.test.ts` |
| A failing source is reported and the others still arrive; in a browser, non-CORS sources are skipped with a reason | `test/fetch.test.ts` |
| A fetched place is scored like a snapshot city; merging replaces source by source | `test/fetch.test.ts` |
| The cache round-trips, is reused, refreshed partially, and invalidated by a fetcher version change | `test/fetch.test.ts` |
| MCP `list_sources`, `fetch_city`, `record_observation` work over the protocol | `test/fetch.test.ts` |
| A proposal without a primary citation for a rule, citing a link-only source, or of the wrong shape is refused with a readable reason; a valid data proposal becomes a pull request and a rule stays an issue; `propose_change` posts nothing without the person's agreement to that exact proposal | `test/community.test.ts` |
| No money figure is invented without a rate or tax model | `test/fetch.test.ts` |

Not promised: that a provider is up or right, that a resolved name is the place the person meant (they see country, region and population), that any metric exists for every place.

## 10. Limits and terms

- **Numbeo and WeatherSpark are links for people only.** Numbeo's terms: "Automated data collection methods (such as scraping or crawling) are strictly prohibited unless you have obtained prior written permission." WeatherSpark's robots.txt blocks GPTBot, ClaudeBot and other AI agents from the whole site. An agent may only record a figure the person gives it; anything more needs the publishers' written permission.
- **Public pages show numbers** for the 57 seed cities, from a small open-licensed snapshot only (section 5).
- **Open-Meteo's free API is for non-commercial use.** This project is non-commercial; a commercial use would need its paid API or another source for the snapshot.
