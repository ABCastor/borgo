# Borgo for agents and terminals

The website, the MCP server and the CLI run the same engine (`src/core`) on the same dataset (`public/data/dataset.json`). Two answers match when all of these match: the resolved profile (the same cities, weights, household, pay and settings), the figures (the snapshot plus the person's cache of fetched places and their own numbers), the exchange rates, and the engine with its tax models. Every report names the ones it can in `dataset`: `version` and `builtAt` (the snapshot), `fxDate` (the ECB rates) and `engine` (the engine and tax models, `package.json`'s version). A cache or an own number makes two answers differ on purpose, and is not identified there. Every figure comes with its source, period, geographic level and licence; every gap is named, with what would fill it.

Requires Node 26 or newer (it runs the TypeScript sources directly). From a checkout: `npm install`.

## MCP server

The server speaks MCP over stdio: `node /path/to/borgo/bin/borgo.ts mcp`. Use absolute paths. Desktop apps often start with a shorter `PATH` than your shell, so if `node` there is older than 26, give the full path to Node 26 instead of `node`.

**Claude Code**

```sh
claude mcp add borgo -- node /path/to/borgo/bin/borgo.ts mcp
```

**Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json` in a project) and other JSON-configured clients:

```json
{
  "mcpServers": {
    "borgo": {
      "command": "node",
      "args": ["/path/to/borgo/bin/borgo.ts", "mcp"]
    }
  }
}
```

**Codex**

```sh
codex mcp add borgo -- node /path/to/borgo/bin/borgo.ts mcp
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.borgo]
command = "node"
args = ["/path/to/borgo/bin/borgo.ts", "mcp"]
```

### Tools

| Tool | Use it for |
|---|---|
| `fetch_city` | Any real place, not only the cities in the snapshot: resolves "Palermo, IT" (or `geonames:<id>`) and fetches every registry source that covers it into the person's cache, with each figure's URL and time. Reused for 30 days unless `refresh`. Returns the id for the other tools, what each source gave and what the place lacks; long series are counted unless `detail: "full"`. |
| `list_sources` | The curated source registry: what each source measures in plain words, coverage, licence, whether it may be redistributed, how it is fetched (endpoint, CORS, key), who vetted it, and link-only pages (Numbeo, WeatherSpark) with the publisher's page for a given city. |
| `record_observation` | Keep a figure the person read on a link-only page and gave the agent, or one the agent read in an open source (a city statistics table), in the person's cache, with source id, URL, period and, ideally, its unit; it replaces that source's earlier figure for the metric and returns the one it replaced. It refuses a figure whose source does not measure that metric, whose unit is not the metric's (rent in Lisbon is `EUR/month`), that falls outside the metric's plausible range (a negative rent, a 70 °C month), or whose page is not an http(s) address; a refused figure leaves the kept one in place. Figures from link-only sources stay private to that person. |
| `compare_cities` | The main one. Ranks any number of cities for a person or a household: a verdict, the score out of 100 from their weights, points and reasons per line with each figure's publisher and period, must-pass lines as pass, fail or unknown, take-home pay and money left, who can move there, how the set was scored, and what to add next. Compact by default; `detail: "full"` adds every tax line, pensions, childcare, health, leave and the break-even salary. |
| `search_cities` | Find city ids by name, alias or country, with how many match (`total`, `hasMore`). A miss points to `fetch_city`. Names also work directly in the other tools ("Turin", "Torino", "Paris, FR"); a name two places share needs its country. |
| `get_city` | A city's figures with their provenance, daylight, the tax model, who in a household may live and work there (with the rules checked), and links to sources we may not copy. `metrics` picks a few figures; compact unless `detail: "full"`. |
| `net_pay` | Take-home pay for a gross salary in a country, region or city, with every tax line, caveats and official sources. Takes age, children, a pension share, a newcomer regime (refused when the facts given rule it out, a `scenario` otherwise until confirmed) and a partner (joint filing for a married couple where the country has it). `completeness` says whether the figure is complete, approximate or partial for that place. |
| `list_metrics_and_sources` | Scoring lines and their scales, metrics and coverage, sources and licences, tax models, newcomer regimes (ids and each condition's id), presets, link-only sources. `kind` returns one part, and `country` narrows tax models and regimes: `{ kind: "regimes", country: "NL" }`. |
| `methodology` | How scores, weights, must-pass lines, missing data and the money model work. |
| `list_stale` | The facts Borgo encodes by hand (tax models, abortion and same-sex couples law, paid leave, election results, residence rules, corrected figures), each with its `reviewBy` date, the most overdue first: why it is due, its current source, and the `target` to use with `propose_change`. `within` adds facts due in the next days; `kind` and `country` filter. |
| `propose_change` | Turn a correction to a figure, rule or source into a proposal for the maintainers, checked the way the repository's workflow checks an issue: the target exists, the value has the metric's shape and unit, the citation is the official text (statute, gazette, official table or page, registry source) and not a link-only site, a rule cites its legal text, and the cited page answers and holds the quote. Returns the verdict and a prefilled GitHub issue link for the person to open. It posts nothing by itself: with the person's yes to that exact proposal, call again with `post.confirm` set to the token it returned, and it files the issue with their signed-in GitHub CLI. See [CONTRIBUTING.md](../CONTRIBUTING.md). |

Each tool answers twice: markdown in the text content (for the model and for chat clients) and JSON in `structuredContent` (for programs), described by the tool's output schema and versioned by `reportVersion`. Answers are compact by default: a four-city comparison is under 20 KB in all. Errors come back as readable tool results with `isError`, naming the field or the closest matches.

**Reading a comparison.** Lead with `verdict`. A city without a figure on a line scores as the lowest compared city on it, never above one that has the figure, and `coverage` is the share of the weight resting on observed figures. Money is compared on one basis for every city: when one lacks money left, every city is scored on take-home pay less any compulsory health premium bought outside pay (or on cost when no salary is given, or not at all), `moneyBasis` says which (`requested` and `used`), and `notes` says so with the input that would fix it. A money figure that leaves out something due is at most what it shows: it never scores, and below zero it fails a money must-pass. When a city ranked with the leader could overtake it once its missing figures are known, `provisional` is true, the verdict starts "Provisional", `provisionalReasons` says what is missing, and `requestedCoverage` is the share of each city's weight resting on the figures asked for (money left, not its stand-in). Say so to the person. A must-pass is `passes`, `ruled out` or `unknown` (no figure, or passports not given); `requiredUnknowns` lists the unknowns, and an unknown never counts as a pass. Relay `notes`, `requiredUnknowns` and `nextInputs` to the person.

`compare_cities` takes what a person would say: `cities`, `preset` (`balanced`, `founder`, `family`, `saver`) or `weights` (criterion id → 0-100), `only` (score only these criteria: `only: ["nice_days"]` answers a one-line question), `household` (each person, with their `passports` if known, and optionally `age`, `spouse`, `relation`, `yearsSinceResident`, `regimes` (that person's own newcomer regimes, country → id), `regimeConfirmations` (condition id → true or false, from what the person told you), and for anyone after the first their own `salary`, `salaryByCity` and `pension`), `salary` or `salaryByCity` (amount and currency), `pension` (share of gross, 0.05 = 5%), `children` (ages), `paidChildcare` (false when the household uses no paid care), `childcareCost` and `healthPremium` (city → `{ amount, per: "month" | "year" }`; a year is converted and said, an amount without `per` is refused), `regimes` (country → regime id, for the first person; none counts unless named), `spending` (monthly, everything but housing, childcare and health, with `homeCity`), `housing` (`1bed`/`3bed`), `displayCurrency`, `savings`, `comfort` (°C range), `overrides` (city → metric → your own number), `dealBreakers` (must-pass lines), `personal` (your own 1-5 lines), `taxTweaks` (per country, for the first person only: `taxableShare`, `flatRate`, `noSocialContributions`), `stances` (where the person stands on the position lines, below), `detail` (`summary` or `full`) and `limit` (cities described in the summary, 10 by default). Leave out what you do not know: the result lists every default it assumed and everything worth adding. Do not invent a salary, spending or passports for someone; a person without passports is reported as not checked.

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
alias borgo="node /path/to/borgo/bin/borgo.ts"   # or: npm link (installs borgo, and where-to-live as another name for it)

borgo compare Lisbon Berlin --salary "60k EUR"   # start here: two cities, one salary
borgo compare Lisbon Berlin Dubai --only nice_days --comfort 20-28   # one line, with your own nice-day range
borgo city Zurich --person US                     # a city's figures, and whether a US passport lets you live there
borgo net-pay Edinburgh 50k --currency GBP
borgo net-pay IT 60000 --regime it-impatriati     # a newcomer regime, by id (see catalogue --kind regimes)
borgo fetch "Palermo, IT"                         # any place: resolve, fetch every source, keep it in your cache
borgo search --country US
borgo sources --metric rent_1bed                  # the source registry, filtered
borgo catalogue --kind regimes --country NL       # one part of the catalogue
borgo methodology
borgo stale --within 60                           # curated facts due for review in the next 60 days
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
borgo fetch Palermo --only oecd-wellbeing --refresh
borgo data build                 # validate data/ and rebuild the dataset
borgo data refresh worldbank     # re-fetch one source, then rebuild
borgo data refresh               # every source; failures are listed, their previous files kept
```

Fetched places live in the person's cache (`$BORGO_HOME`, default `~/.cache/borgo`; `$WHERE_TO_LIVE_HOME` is read too), never in the repository; every command and the MCP server merge them over the committed snapshot. Set `GEONAMES_USERNAME` to let the resolver fall back to GeoNames' own search.

Add `--json` to any command for the machine-readable report (the same JSON the MCP tools return); errors then print `{"error": "..."}`. Every error exits 1: an unknown city, a negative amount, a weight outside 0 to 100, a nice-day range whose minimum is not below its maximum. A whole profile can live in a file: `--args profile.json` takes the `compare_cities` arguments as JSON, and flags apply on top.

## Building on it

`src/agent/` is the shared layer: `profile.ts` turns simple arguments into an engine profile, `report.ts` builds the reports, `markdown.ts` and `chart.ts` render them. A new front end (an HTTP API, a bot) should call these rather than the engine directly, so every face answers alike.
