# Position lines: politics and the law

Most lines are more-is-better: more sunshine, cleaner air, more money left. Three are not, because people want
different things from them: how a place votes, what its law allows on abortion, and how its law treats same-sex
couples. These are **position lines**. The person says where they stand, and a place scores by how close it sits.

## How a position line scores

- **A stance, or no score.** A position line has a score only once the person has said where they stand
  (`stances` in a profile, `--stance` on the CLI, the "Where you stand" controls in the app). Without one, the line
  shows the place's fact and asks "say where you stand"; it adds nothing to the total. Nothing is inferred from a
  nationality, a city or any other answer.
- **Off by default.** Each starts at weight 0, like the other optional dials.
- **Distance, not direction.** The score is 1 when the place sits at the stance and falls in a straight line to 0 at
  the line's tolerance: 3 points of the 0-10 politics scale, 2 steps of a law. Beyond the tolerance it stays 0.
- **Must-pass.** Marked as a must-pass, a position line rules a place out at or beyond its tolerance, in either
  direction.
- **Missing data.** A place with no figure is handled like any other missing figure (`prefs.missing`), and the line
  says there is no figure.

## Politics, left to right (`politics`, metric `politics_lr`)

**What the figure is.** An estimate of how the place voted at its latest national lower-house election, on a scale
from 0 (left) to 10 (right): each party's position, averaged by its share of the official result. It describes an
electorate on one day, not every resident and not the government's policy, and the UI and notes call it an estimate.

**Votes.** Each result is the electoral authority's or statistics office's own, entered by hand in
`pipeline/inputs/politics.json` with its URL and the date it was compared with that source. Shares are of all valid
votes: parties left out of the list, independents and blank lists stay in the denominator.

| Where | Election | Source |
|---|---|---|
| AT | National Council, 29 Sep 2024 | Federal Ministry of the Interior |
| BE | Chamber of Representatives, 9 Jun 2024 | FPS Interior |
| CH, by canton | National Council, 22 Oct 2023, party strength | Federal Statistical Office |
| CZ | Chamber of Deputies, 3-4 Oct 2025 | Czech Statistical Office (volby.cz) |
| DE | Bundestag, 23 Feb 2025, second votes | Federal Returning Officer |
| DK | Folketing, 24 Mar 2026 | Statistics Denmark, table FV26TOT |
| EE | Riigikogu, 5 Mar 2023 | State Electoral Office |
| FI | Eduskunta, 2 Apr 2023 | Ministry of Justice |
| FR | National Assembly, 30 Jun 2024, round one | Ministry of the Interior, final results on data.gouv.fr, by the Ministry's candidate groups (nuances) |
| GB | House of Commons, 4 Jul 2024 | UK Parliament election results |
| HU | National Assembly, 12 Apr 2026, list votes | National Election Office |
| IE | Dáil, 29 Nov 2024, first preferences | Houses of the Oireachtas |
| IT | Chamber of Deputies, 25 Sep 2022, lists (Italy without Aosta Valley and abroad) | Ministry of the Interior, historical archive |
| JP | House of Representatives, 8 Feb 2026, proportional ballot | Ministry of Internal Affairs and Communications |
| NL | House of Representatives, 29 Oct 2025 | Electoral Council (verkiezingsuitslagen.nl) |
| NO | Storting, 8 Sep 2025 | Norwegian Directorate of Elections (valgresultat.no) |
| PL | Sejm, 15 Oct 2023 | National Electoral Commission |
| PT | Assembly of the Republic, 18 May 2025 | Ministry of Internal Administration |
| SE | Riksdag, 13 Sep 2026 | Election Authority (rounded percentages) |
| CA, by province | House of Commons, 28 Apr 2025 | Elections Canada |
| AU, by state | House of Representatives, 3 May 2025, first preferences | Australian Electoral Commission |

**Party positions.** From the ParlGov 2024 release (Döring and Manow, Harvard Dataverse doi:10.7910/DVN/2VZ5ZC, CC0),
matched by the ParlGov party id written beside each party in the inputs, never by name or Wikipedia link. ParlGov's
left-right figure is the mean of expert surveys where they cover the party; where they do not, ParlGov gives the mean of
the party's family (for example 8.7 for the right-wing family, 6.0 for liberal parties). The table marks each party's
basis (`expert`, `family`, or `members` for an alliance, which takes its member parties' mean) and the note names the
family and members cases. A party ParlGov does not list, or lists with no figure, has no position; it is never put in
the middle or given a neighbour's place. Where ParlGov files a renamed party under its older name (Reform UK as the
Brexit Party, Rødt as the Red Electoral Alliance) the input says so; where ParlGov's lineage would place a party by a
different party it absorbed (EKRE under the People's Union of Estonia), the party has no position.

**Coverage threshold.** A place gets no figure when the parties with a position took under 75% of the vote: the parties
left out could move it anywhere. Each figure carries the share it rests on. Hungary (TISZA), Italy (the Five Star
Movement, which ParlGov 2024 leaves without a left-right figure, and Azione), and Japan (the Centrist Reform Alliance,
founded 2026) fall under it.

**No figure.** The United States and Singapore: ParlGov covers neither, and community labels are not used in place of
expert positions. Spain and Greece: their official result sites could not be read for this release (they block
automated reads), so the figure waits for a check against them. The UAE has no national elections between parties.

**Words for the scale.** The word beside a figure names the nearest of fixed reference points: left 2.1, centre-left 3.7,
centre 5.6, centre-right 6.5, right 7.7, with far left 1.4 and far right 8.5 at the ends. The points are the mean ParlGov
position of the parties Wikidata files under each political alignment, computed once in October 2026; they name a point
on the scale and do not classify a place or its voters.

**Limits.** One left-right axis folds economic and social positions together, and expert scales are not perfectly
comparable across countries. A national party's position weighted by local votes is a proxy for local opinion. Party
positions are mostly fixed over time, and the 2024 ParlGov release predates parties founded since. Family means are a
coarse stand-in: they place the Swiss Green Liberals at the green family's 2.5 and Katter's Australian Party at the
social-democratic family's 3.3.

**Refresh.** Enter a new election's official result in `pipeline/inputs/politics.json` (each party with its ParlGov id, or
a note on why it has none), then `node pipeline/sources/politics.ts` rebuilds `src/fetch/politics-table.ts` and `node
pipeline/sources/positions.ts` writes the seed cities' observations.

## Abortion law (`abortion`, metric `abortion_law`)

**What the figure is.** On what grounds the law allows a pregnancy to be ended, as one of five steps:

| Step | Meaning |
|---|---|
| 0 | Not allowed, or only to save the woman's life |
| 1 | Also to protect her health, or after rape or incest |
| 2 | Also on broad social or economic grounds |
| 3 | On request, in the first weeks only (under 10) |
| 4 | On request, to 10 weeks or later |

Each entry names the statute, links to the source it was checked against (the statute, or an official page that states
it), and gives the limit in words. A step counts as "on request" where the law leaves the decision to the woman within
the limit, including where she states the statutory grounds herself (Italy, Hungary, Switzerland, the Netherlands). US states are entered one by
one, since the law there is a state's; a state not yet in the table has no figure, never a national one. Northern
Ireland has its own entry.

**Source.** The law itself (`src/fetch/rights-law.ts`). Compiled indices (the Center for Reproductive Rights map, the
WHO Global Abortion Policies Database) are not copied: neither grants reuse of its data.

**Limits.** The steps describe what the law allows, not how easy care is to reach: waiting periods, counselling,
conscientious objection and the number of providers are not in the figure.

## Same-sex couples in law (`couples_law`, metric `same_sex_couples`)

**What the figure is.** What national law offers same-sex couples: 0 sexual relations between people of the same sex
are a crime, 1 legal but national law offers no union, 2 civil union or registered partnership, 3 marriage. Each entry
names the law and links to it (`src/fetch/rights-law.ts`). The step is about forming a union at home; a note adds what
it leaves out, such as the recognition of a marriage concluded abroad that EU law requires (Poland), or local partnership
certificates (Japan). The UAE has no figure: its Penal Code could not be read from an official source.

## For agents

`docs/agents.md` lists the stance each line takes and how to pass it. Report a place's fact in neutral words, with its
date and source, and only pass a stance the person gave.
