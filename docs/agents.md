# Borgo for agents and terminals

The website, the MCP server and the CLI run the same engine (`src/core`) on the same dataset (`public/data/dataset.json`). Two answers match when all of these match: the resolved profile (the same cities, weights, household, pay and settings), the figures (the snapshot plus the person's cache of fetched places and their own numbers), the exchange rates, and the engine with its tax models. Every report names the ones it can in `dataset`: `version` and `builtAt` (the snapshot), `fxDate` (the ECB rates) and `engine` (the engine and tax models, `package.json`'s version). A cache or an own number makes two answers differ on purpose, and is not identified there. Every figure comes with its source, period, geographic level and licence; every gap is named, with what would fill it.

Borgo runs from npm with Node 22.13 or newer, with no clone: `npx -y @abcastor/borgo mcp` starts the MCP server, and `npx -y @abcastor/borgo <command>` runs the CLI. The package carries the engine, the snapshot and the source registry of its version.

## MCP server

### On the web: one address, nothing to install

`https://borgo.abcastor.com/mcp` is the same server for any assistant that takes a remote MCP address: Streamable HTTP, MCP 2025-11-25, no account and no key.

```sh
claude mcp add --transport http borgo https://borgo.abcastor.com/mcp    # Claude Code
codex mcp add borgo --url https://borgo.abcastor.com/mcp                # Codex
```

In Claude (web or desktop) and ChatGPT, add it as a custom connector with that address. JSON-configured clients that take remote servers use `{ "mcpServers": { "borgo": { "type": "http", "url": "https://borgo.abcastor.com/mcp" } } }` (some name the key `serverUrl` or the type `streamable-http`). The MCP Registry lists it as a remote of `io.github.ABCastor/borgo`.

What it is and is not:

- **Tools:** `search_cities`, `get_city`, `compare_cities` (with the chart view), `net_pay`, `list_metrics_and_sources`, `methodology`, `list_sources`, `community_figures`, `submit_figures` and `remove_figures`, answering exactly as the local server does on the same data. It holds Borgo's published cities only: `fetch_city`, `record_observation`, `list_stale` and `propose_change` need the person's own machine, so they run in the local server below. A place it does not hold is answered with that hint.
- **Sending figures:** `submit_figures` sends nothing without `confirm: true`, which an assistant passes only after the person said yes to the exact draft; the figures then go through the same inbox, daily limits per network and automated review as the site's form.
- **What it keeps:** a count per day of calls to each method and tool, and how many failed. Never the arguments, the answers, the address or anything else about who asked. Arguments reach the server only to compute that answer and go to no other provider.
- **Limits:** 60 requests a minute from one network (a 429 with `retry-after` beyond that), request bodies up to 64 KB.
- **Stateless:** each POST carries a JSON-RPC message and gets its answer as JSON. There are no sessions and no stream to open: `GET` and `DELETE` answer 405. Browser clients may call it from any origin; it reads no cookies.

### On your machine

The local server speaks MCP over stdio: `npx -y @abcastor/borgo mcp`. Desktop apps often start with a shorter `PATH` than your shell: if they cannot find `npx`, or the Node it runs is older than 22.13, give the full path to `npx` (`which npx` prints it) instead of `npx`.

**Claude Code**

```sh
claude mcp add borgo -- npx -y @abcastor/borgo mcp
```

**Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json` in a project) and other JSON-configured clients:

```json
{
  "mcpServers": {
    "borgo": {
      "command": "npx",
      "args": ["-y", "@abcastor/borgo", "mcp"]
    }
  }
}
```

**Codex**

```sh
codex mcp add borgo -- npx -y @abcastor/borgo mcp
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.borgo]
command = "npx"
args = ["-y", "@abcastor/borgo", "mcp"]
```

The server is also listed in the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.ABCastor/borgo`, for clients that install from it, with the npm package and the web address.

**From a clone** (Node 26 or newer, which runs the TypeScript sources directly): `npm install`, then use `node /path/to/borgo/bin/borgo.ts mcp` as the command, with absolute paths: `claude mcp add borgo -- node /path/to/borgo/bin/borgo.ts mcp`, or `"command": "node"` with `"args": ["/path/to/borgo/bin/borgo.ts", "mcp"]`. A clone answers with your own changes to the engine and the data.

### Tools

The local server has all of these; the web one all but `fetch_city`, `record_observation`, `list_stale` and `propose_change`.

| Tool | Use it for |
|---|---|
| `fetch_city` | Any real place, not only the cities in the snapshot: resolves "Oakland, US" or "San Francisco, US" (or `geonames:<id>`) and fetches every registry source that covers it into the person's cache, with each figure's URL and time. Reused for 30 days unless `refresh`. Returns the id for the other tools, what each source gave and what the place lacks; long series are counted unless `detail: "full"`. |
| `list_sources` | The curated source registry: what each source measures in plain words, coverage, licence, whether it may be redistributed, how it is fetched (endpoint, CORS, key), who vetted it, and link-only pages (Numbeo, WeatherSpark) with the publisher's page for a given city. |
| `record_observation` | Keep a figure the person read on a link-only page and gave the agent, or one the agent read in an open source (a city statistics table), in the person's cache, with source id, URL, period and, ideally, its unit; it replaces that source's earlier figure for the metric and returns the one it replaced. It refuses a figure whose source does not measure that metric, whose unit is not the metric's (rent in Lisbon is `EUR/month`), that falls outside the metric's plausible range (a negative rent, a 70 °C month), or whose page is not an http(s) address; a refused figure leaves the kept one in place. Figures from link-only sources stay private to that person. |
| `suggest_cities` | Rank all published cities for the current profile and return the top five not already in `cities`, with each city's two biggest observed point contributions. Takes the comparison inputs; `cities` may be empty. Check missing-data coverage before interpreting a high score. |
| `compare_cities` | The main one. Ranks any number of cities for a person or a household: a verdict, the score out of 100 from their weights, points and reasons per line with each figure's publisher and period, must-pass lines as pass, fail or unknown, take-home pay and money left, who can move there, how the set was scored, and what to add next. Compact by default; `detail: "full"` adds every tax line, pensions, childcare, health, leave and the break-even salary. |
| `search_cities` | Find city ids by name, alias or country, with how many match (`total`, `hasMore`). A miss points to `fetch_city`. Names also work directly in the other tools ("Turin", "Torino", "Paris, FR"); a name two places share needs its country. |
| `get_city` | A city's figures with their provenance, daylight, the tax model, who in a household may live and work there (with the rules checked), links to sources we may not copy, and Borgo's generic quality-of-life index (`qualityOfLife`: score, coverage, each part with its fixed weight, and other indices as links; left out when `metrics` is given). `metrics` picks a few figures; compact unless `detail: "full"`. |
| `net_pay` | Take-home pay for a gross salary in a country, region or city, with every tax line, caveats and official sources. Takes age, children, a pension share, a newcomer regime (refused when the facts given rule it out, a `scenario` otherwise until confirmed) and a partner (joint filing for a married couple where the country has it). `completeness` says whether the figure is complete, approximate or partial for that place. |
| `list_metrics_and_sources` | Scoring lines and their scales, metrics and coverage, sources and licences, tax models, newcomer regimes (ids and each condition's id), presets, link-only sources. `kind` returns one part, and `country` narrows tax models and regimes: `{ kind: "regimes", country: "NL" }`. |
| `methodology` | How scores, weights, must-pass lines, missing data and the money model work. |
| `list_stale` | The facts Borgo encodes by hand (tax models, abortion and same-sex couples law, paid leave, election results, residence rules, corrected figures), each with its `reviewBy` date, the most overdue first: why it is due, its current source, and the `target` to use with `propose_change`. `within` adds facts due in the next days; `kind` and `country` filter. |
| `propose_change` | Turn a correction to a figure, rule or source into a proposal for the maintainers, checked the way the repository's workflow checks an issue: the target exists, the value has the metric's shape and unit, the citation is the official text (statute, gazette, official table or page, registry source) and not a link-only site, a rule cites its legal text, and the cited page answers and holds the quote. Returns the verdict and a prefilled GitHub issue link for the person to open. It posts nothing by itself: with the person's yes to that exact proposal, call again with `post.confirm` set to the token it returned, and it files the issue with their signed-in GitHub CLI. See [CONTRIBUTING.md](../CONTRIBUTING.md). |
| `community_figures` | What people report for themselves about a place, after automated review: rent by bedrooms and area, everyday prices, take-home pay by kind of work and a 1 to 5 rating, each with its median (a rating: mean), middle half from 3 entries, count, months and the official figure beside it. Quote them as community figures, never as official. |
| `submit_figures` | Send the person's own figures to Borgo's open community data (CC BY 4.0, nothing about them kept). Without `confirm` it sends nothing and returns the draft with its privacy note; call again with `confirm: true` only after they said yes to those exact figures. Returns a removal code for them. |
| `remove_figures` | Delete a submission with its removal code. |

Each tool answers twice: markdown in the text content (for the model and for chat clients) and JSON in `structuredContent` (for programs), described by the tool's output schema and versioned by `reportVersion`. Answers are compact by default: a four-city comparison is under 20 KB in all. Errors come back as readable tool results with `isError`, naming the field or the closest matches.

**Reading a comparison.** Lead with `verdict`. Fixed scoring is city-local by default: missing lines do not count there, and adding/removing cities does not change another city's score. Coverage says how much requested weight rests on observed figures; missing lines can favour thin coverage, so do not read a high score as proof of a good fit. Money's fallback is city-local too: whole money left, else take-home pay less compulsory premiums, else known costs, else no money score. `notes` names each basis and next input; `moneyBasis` is null when bases differ or money has no scoring weight. Only opt-in `normalise: "relative"` uses comparison-set normalisation, peer gap policies and a shared money basis. Required (`dealBreakers`) filters cities without taking score share; turning it off restores its saved weight. A money figure that leaves out something due is at most what it shows: it never scores, and below zero it fails a money must-pass. When a city ranked with the leader could overtake it once its missing figures are known, `provisional` is true, the verdict starts "Provisional", `provisionalReasons` says what is missing, and `requestedCoverage` is the share of each city's weight resting on the figures asked for (money left, not its stand-in). Say so to the person. A must-pass is `passes`, `ruled out` or `unknown` (no figure, or no passport or other right given); `requiredUnknowns` lists the unknowns, and an unknown never counts as a pass. Relay `notes`, `requiredUnknowns` and `nextInputs` to the person.

`borgo suggest [already-chosen-city ...]` offers the same recommendations in the CLI and accepts comparison flags or `--args profile.json`. MCP `suggest_cities` takes the same profile as `compare_cities`; it never mutates a browser comparison.

Each household entry can include `entryRoutes` (country → route id), only when the person confirms the listed conditions apply. Official procedures, source/period, redistributable facts and the limits of the rough difficulty guide are in [entry-routes.md](entry-routes.md). Unknown routes/countries are not checked. Existing rights and prospective routes are distinct; a Required right-to-live check requires rights already held.

`compare_cities` takes what a person would say: `cities`, `preset` (`balanced`, `founder`, `family`, `saver`) or `weights` (criterion id → 0-100), `work` (their kind of work, e.g. `software` or `founder`: Work and ambition is weighed for it and each city gets `work`, plain sentences saying why; see [work.md](work.md)), `only` (score only these criteria: `only: ["nice_days"]` answers a one-line question), `household` (each person, with their `passports` if known, their `rights` if they hold any that are not citizenship (each `{ kind, where, until?, work? }`: `kind` one of `permanent`, `settled`, `residence`, `work`, `blue-card`, `other`; `where` a country code or a free-movement area id such as `EEA`; `until` its last valid day, YYYY-MM-DD; `work: false` for a permit that bars work; a right counts until that day and is checked in its own place only), and optionally `age`, `spouse`, `relation`, `yearsSinceResident`, `regimes` (that person's own newcomer regimes, country → id), `regimeConfirmations` (condition id → true or false, from what the person told you), and for anyone after the first their own `salary`, `salaryByCity` and `pension`), `salary` or `salaryByCity` (amount and currency), `pension` (share of gross, 0.05 = 5%), `children` (ages), `paidChildcare` (false when the household uses no paid care), `childcareCost` and `healthPremium` (city → `{ amount, per: "month" | "year" }`; a year is converted and said, an amount without `per` is refused), `regimes` (country → regime id, for the first person; none counts unless named), `spending` (monthly, everything but housing, childcare and health, with `homeCity`), `housing` (`1bed`/`3bed`), `displayCurrency`, `savings`, `comfort` (what a nice day is: `min` and `max` °C, `basis` `feels` or `air`, and the tests a day must pass: `dry` and `clear` are on unless set false, `notMuggy` (dew point under 18 °C), `calm` (daytime wind under 20 km/h) and `daylight` (at least this many hours) only when the person asks), `overrides` (city → metric → your own number), `dealBreakers` (must-pass lines), `personal` (your own 1-5 lines), `taxTweaks` (per country, for the first person only: `taxableShare`, `flatRate`, `noSocialContributions`), `stances` (where the person stands on the position lines, below), `detail` (`summary` or `full`) and `limit` (cities described in the summary, 10 by default). Leave out what you do not know: the result lists every default it assumed and everything worth adding. Do not invent a salary, spending or passports for someone; a person without passports is reported as not checked.

**Their own figures.** When the person tells you what they pay or earn where they live and wants to share it, `submit_figures` sends it, only after their yes to the exact draft. Never send estimates or figures read elsewhere.

**Corrections.** When a figure or rule is wrong or out of date, read its official text yourself (the statute, the gazette, the statistics office's table), never only a news article about it, then call `propose_change` with that text as the citation and, ideally, a sentence from it as `quote`. A news item can go in `leads`. Give the person the link it returns; post for them only after they agree to that exact proposal, which also grants its data under CC BY 4.0. `list_stale` shows where to look first.

**Link-only sources.** Numbeo, WeatherSpark, the EIU and the other sources `list_sources` marks link-out forbid copying and automated reading. Never fetch or read them yourself: give the person the link (`list_sources` with `city` fills in the page for a place). If they read a figure there and tell you, `record_observation` keeps it in their own cache with the page's address, marked unverified and never published.

### Position lines: where the person stands

Three lines are positions, not more-is-better sliders. The person says where they stand, and a place scores by how far it sits from them: 1 at their point, 0 at the line's tolerance, which is also where a must-pass fails. All three start at weight 0, and a line without a stance has no score at all.

| Line | Stance (`stances`) | What the place's figure is | Tolerance |
|---|---|---|---|
| `politics` | 0 (left) to 10 (right) | An estimate of how it voted at its latest national lower-house election: each party's ParlGov position on the 0-10 scale, averaged by its share of the official result. Swiss cantons, Canadian provinces and Australian states at their own count. No figure where parties with a position took under 75% of the vote (Hungary, Italy, Japan), nor for the United States, Singapore, Spain, Greece or the UAE. The figure says the election and its date. | 3 points |
| `abortion` | 0 not allowed, or only to save her life; 1 also for her health, or after rape; 2 also on social or economic grounds; 3 on request, first weeks only (under 10); 4 on request, 10 weeks or later | What the law allows, from the statute cited, with the limit in words. A US state outside the table has no figure, never a national one. | 2 steps |
| `couples_law` | 0 criminalised (same-sex relations a crime); 1 legal, no union in law; 2 civil union or partnership; 3 marriage | What national law offers same-sex couples, from the statute cited. | 2 steps |

A step may be passed by its words: `stances: { couples_law: "marriage", abortion: "on request, 10" }`. Pass a stance only when the person said it or you already know it from them; never infer it from their nationality, where they live or anything else. Give the line a weight too, or it does not count (the result says so). Report each place's fact in neutral words, with its date and source, and let the person decide what it means to them. `list_metrics_and_sources` gives each position line's scale and steps.

What the money part of each city holds in a full report (`cities[].money`, `detail: "full"`):

- `earners`: each person's gross, pension and take-home pay; `yearly.tax` lists every tax and payroll line, each person's prefixed with their label, and pension contributions marked `saving: true` (they leave take-home pay but are not a cost).
- `filing`: for a married couple (`spouse: true`), whether they are taxed jointly here and why. Joint filing is modelled for the United States (federal), Germany, France, Poland and Portugal, used where it is required (France) or cheaper; elsewhere a sentence says how the country treats couples.
- `monthly.childcare`: full-time care for children under 6 after benefits and tax breaks, from the OECD tax-benefit model (a couple on the average wage, or a single parent; a country figure). `monthly.health`: out-of-pocket health spending per person (WHO via the World Bank) for everyone in the household. Where basic cover is a premium bought outside pay (US, CH, NL), `gaps` says so and money left is partial until you pass the household's premium a month as `overrides: { city: { health_premium: monthly } }`.
- `leave`: paid holiday by law and public holidays on weekdays (Nager.Date), parental leave in weeks at full pay (OECD Family Database), and the days' worth at the first earner's pay.
- `regime`: a newcomer regime counts only when named in `regimes`. `status` is `established` when the person's facts and `regimeConfirmations` answers meet every condition, and `scenario` otherwise, with `unconfirmed` listing what is left to confirm: present a scenario as a what-if, never as eligibility. A regime a fact rules out (too recently resident, pay below the threshold) is not counted, and `taxModel.caveats` says why.
- `completeness`: how much of what is due the money figures hold. `status` is `complete`, `approximate` (a stand-in such as a typical regional rate or an earlier year's scale, listed in `approximations`), `partial` (something due is left out, listed in `missing`: a state, provincial or cantonal income tax with no model, a health premium bought outside pay, childcare with no figure) or `unsupported` (no tax model here, so no take-home figure). A partial figure is too high: do not compare it, or rank on it, as if it were whole.
- `breakEven`: the gross the first earner would need here to keep what they keep where they live now (`spending.homeCity`), against their pay here; `null` at home, when anything is missing, or when either side is partial.
- `missing` blocks the total (no rent, no spending); `gaps` and `completeness.missing` name what the total leaves out.

Simplifications, said once: each earner is taxed with the country's model on their own facts, with the newcomer regime named for them; tax settings (`taxTweaks`) apply to the first person only; children count as a parent's for both partners, and where the law lets either parent claim a child's credits (the US), each child is given to the parent the household gains most from, said in the caveats; a married couple files jointly where the model has joint filing and it is required or cheaper; childcare is the household's own cost when given, else the OECD figure for children aged 2-3, applied to every child under 6, with the third and later children counted at the second's cost only when both figures exist; pension relief is modelled only for the plans `list_metrics_and_sources` with `kind: "pensions"` lists, and elsewhere the share is counted as saving with no relief; age-dependent rules are applied only where the model names them.

### The chart in the chat

`compare_cities` declares an [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) view (`ui://borgo/compare.html`, extension `io.modelcontextprotocol/ui`, spec 2026-01-26). Hosts that support MCP Apps render it inline: stacked bars of each city's score by the line that earned it, money left each month, the ranking, reasons and what to add. The view needs no network access. Hosts without MCP Apps show the same result as markdown, with a text bar chart. The CLI writes the same chart as an SVG file (`--svg`).

## CLI

```sh
npm install -g @abcastor/borgo     # installs borgo, and where-to-live as another name for it; or put npx -y before any command
alias borgo="node /path/to/borgo/bin/borgo.ts"   # from a clone instead

borgo compare Lisbon Berlin --salary "60k EUR"   # start here: two cities, one salary
borgo compare Lisbon Berlin Dubai --only nice_days --comfort 20-28   # one line, with your own nice-day range
borgo city Zurich --person US                     # a city's figures, and whether a US passport lets you live there
borgo compare Berlin Lisbon --person US --right DE:permanent   # a right to live and work that is not citizenship
borgo compare Lisbon Singapore --comfort 20-30 --nice-day not-muggy,calm   # your own nice day
borgo net-pay Edinburgh 50k --currency GBP
borgo net-pay IT 60000 --regime it-impatriati     # a newcomer regime, by id (see catalogue --kind regimes)
borgo fetch "Oakland, US"                         # any place: resolve, fetch every source, keep it in your cache
borgo search --country US
borgo sources --metric rent_1bed                  # the source registry, filtered
borgo catalogue --kind regimes --country NL       # one part of the catalogue
borgo methodology
borgo stale --within 60                           # curated facts due for review in the next 60 days
borgo community Turin                             # what people report for Turin, after automated review
borgo submit Turin --rent 950 --bedrooms 1 --area centre --price cappuccino=1.6 --yes
                                                  # your own figures, open data; without --yes only the draft
borgo propose --kind correction --city london-gb --metric rent_1bed --source ons-pipr \
  --proposed 1790 --unit GBP/month --period 2026-10 --level region \
  --url https://www.ons.gov.uk/... --type official-table \
  --publisher "Office for National Statistics" --title "Private rent and house prices, UK" --accessed 2026-11-05
                                                  # checks it and prints the prefilled GitHub issue link
```

Answers are compact by default; add `--full` for every line, tax line and source, and `--limit 20` to describe more cities of a long list.

Advanced: a household with two earners, children, a regime, must-pass lines, positions and your own numbers.

```sh
borgo compare Turin London Dublin "San Francisco" \
  --person IT --person Partner=IT,US \
  --salary "70k EUR" --salary-in "London=85000 GBP" \
  --partner "40k EUR" --married --age 34 --children 2,5 --pension 5% \
  --regime IT:it-impatriati --regime IE:none \
  --spending "1200 EUR" --home Turin \
  --preset founder --weight clean_air=15 --deal-breaker right_to_live \
  --weight politics=10 --stance politics=4 --weight couples_law=5 --stance couples_law=marriage \
  --override "Turin:rent_1bed=750" --line "Family nearby:Turin=5,Dublin=2" \
  --svg chart.svg

borgo net-pay US 150000 --region US-CA --married --partner 40k --age 40 --children 3 --pension 6%
borgo fetch "San Francisco" --only openalex --refresh
borgo data build                 # from a clone: validate data/ and rebuild the dataset
borgo data refresh worldbank     # re-fetch one source, then rebuild
borgo data refresh               # every source; failures are listed, their previous files kept
```

Fetched places live in the person's cache (`$BORGO_HOME`, default `~/.cache/borgo`; `$WHERE_TO_LIVE_HOME` is read too), never in the repository; every command and the MCP server merge them over the committed snapshot. Set `GEONAMES_USERNAME` to let the resolver fall back to GeoNames' own search.

Add `--json` to any command for the machine-readable report (the same JSON the MCP tools return); errors then print `{"error": "..."}`. Every error exits 1: an unknown city, a negative amount, a weight outside 0 to 100, a nice-day range whose minimum is not below its maximum. A whole profile can live in a file: `--args profile.json` takes the `compare_cities` arguments as JSON, and flags apply on top.

## Building on it

`src/agent/` is the shared layer: `profile.ts` turns simple arguments into an engine profile, `report.ts` builds the reports, `markdown.ts` and `chart.ts` render them. A new front end (an HTTP API, a bot) should call these rather than the engine directly, so every face answers alike.
