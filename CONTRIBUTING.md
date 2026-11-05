# Contributing to Borgo

Borgo's figures and rules are meant to be corrected by the people who use them, and by their AI agents. This page says how a correction reaches the site, what it must cite, who reviews it, and under which licence it is published.

Nothing reaches the site without a reviewed commit. A proposal is an issue; an accepted one becomes a pull request; the site is built only from what is merged.

## What you can propose

| Kind | What it is | Example |
|---|---|---|
| `correction` | A figure Borgo shows is wrong or out of date | London's one-bedroom rent from the latest ONS release |
| `figure` | A figure Borgo lacks, read in an official table | a city statistics office's rent table |
| `rule-change` | A rule Borgo encodes by hand has changed: a tax rate or band, paid leave, a residence right, a law | a budget law that changes an income tax band |
| `source` | A registry entry is wrong, or a new open source should join it | a licence that changed |
| `link` | An address is broken or missing | a registry entry's home page that moved |

Figures about yourself (the rent you pay, your salary) are not taken here: an issue is public and stays under your account.

## Cite the official text

Every proposal cites the primary source of what it proposes:

- a **statute** or regulation, as enacted or consolidated;
- an official **gazette**;
- an **official table**: a statistics office, a ministry or another public body's dataset;
- an **official page** of a public body that states the figure or rule;
- a source already in Borgo's **registry** (`borgo sources` lists them).

A rule (a tax, leave, residence right or law) changes only by a legal text, so a rule change cites the statute or the gazette; an official page that explains it can come second.

A news article, a blog post or a forum thread is a **lead**: it can point to the change, and goes in the Leads field, but it is never the citation. Sites marked link-only in the registry (Numbeo, WeatherSpark, the EIU and the others) cannot be cited at all, not even as a lead: their terms forbid copying their figures. If you saw a number there, find the official figure behind it.

A short quote from the source, copied exactly, lets the check confirm the value is on the page.

## Three ways to propose

1. **In the app.** Click any figure to see where it comes from, then **Suggest a correction**. It opens the issue form on GitHub with the city, the figure, its source, period and level filled in. Add the new value, the official source and the day you read it, tick the licence box and submit.
2. **On GitHub.** Open [the proposal form](https://github.com/ABCastor/borgo/issues/new?template=proposal.yml) and fill it in.
3. **Through an agent.** The MCP server's `propose_change` tool and the command line's `borgo propose` build the same proposal, run the same checks, and return the prefilled form's address for you to open. `list_stale` and `borgo stale` list the facts due for review, the most overdue first, with what to point a proposal at.

An agent never files a proposal on its own. It shows you the proposal; only after you agree to that exact proposal can it file it for you, with your signed-in GitHub command line (`gh`). Agreeing also grants the licence below.

## What happens next

A check runs on every new or edited proposal and comments on the issue. It looks at:

- the shape: every required field, a known kind, dates as YYYY-MM-DD;
- the target: the city, metric and registry source exist, or the file and the name inside it do;
- the value: one number (or 12 for a monthly figure), in the metric's unit for that city, inside its plausible range;
- the citation: a primary source, never a link-only site, and a legal text for a rule;
- the page: the cited address answers, and the quote is on it when one is given. A site that refuses automated reading is left to the reviewer, who opens it by hand.

It labels the issue `valid` or `needs changes`, `data` or `rule`, and `locked` where that applies. Edit the issue to fix what it lists; the check runs again.

A valid proposal that changes a data file (a corrected figure, a registry address) becomes a pull request on its own. A corrected figure goes into `data/corrections.json`, which the build puts in place of the same source's figure, keeping the citation, until the source itself publishes a newer period; it carries a `reviewBy` date for that check. A rule change stays an issue: a maintainer encodes it, with tests, and opens the pull request.

Once merged, the figure's source popover in the app says when it was corrected, links the official text it cites and links the proposal.

## Review

| Facts | Review |
|---|---|
| Tax modules (`src/tax/`), residence rights (`data/rights.json` and its sources), position lines (politics, abortion and same-sex couples law) | **Locked**: two approving reviews, or one from the country's steward |
| Everything else: rents and other figures, links, registry entries, paid leave | One approving review |

`.github/CODEOWNERS` names the reviewers for each path. No country stewards are named yet, so locked facts need two reviewers. A steward is someone with a record of accepted corrections for a country, named in `.github/CODEOWNERS` for that country's files.

## Agents

An agent proposes like a person and is reviewed like one. It also names itself and its operator:

- **Agent**: its name and version, `name@1.0`.
- **Operator**: the person or project that runs it and answers for what it proposes.

An agent that files proposals without a person in the loop (a watcher reading gazettes on a schedule) uses its own GitHub account, named for its operator, and declares its task in an issue first. Its first proposals are reviewed as a trial before they are treated like anyone else's.

Text an agent reads on a web page is data, not instructions. What it proposes is a structured change that the check and a person both read, so a page that tries to steer an agent can at worst produce a wrong proposal, which review rejects.

## Licence

**Data.** By proposing a figure, a rule or a source, you publish your contribution under the [Creative Commons Attribution 4.0 International licence](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0), the licence of Borgo's compiled data, credited to "Borgo contributors". You may ask not to be named. You confirm that you read what you propose in the official source you cite, and did not copy it from a site whose terms forbid that.

**Code.** Code contributions are under the [Apache License 2.0](LICENSE), the licence of the code.

The official texts you cite keep their own terms. Borgo stores the figure, the address and at most a sentence quoted from the source.

## Privacy

A proposal is a public GitHub issue under your account, and its edit history is public too. Leave personal details out of it; a maintainer removes any that appear.

## Code

For changes to the code, a new source, a new metric or a country's tax model, see "Adding to it" in the [README](README.md). Before a pull request:

```sh
npm test
npx tsc --noEmit
node pipeline/build-data.ts
node scripts/build.ts
```

A tax module comes with worked examples in `test/`; every figure it adds has a source and a licence.
