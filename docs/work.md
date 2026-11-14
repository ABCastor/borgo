# Work and ambition by kind of work, and the quality-of-life index

## Work and ambition for your kind of work

Without a kind of work, Work and ambition is the same for everyone. It counts research output by default, with
degrees, developers, jobs, internet, coworking and Founders Running Club as opt-in parts. Research output on its own
puts university towns first: on default weights Cambridge scores 95 on the group and San Francisco 61.

Choose a kind of work (app, `--work` in the CLI, `work` in MCP) and the group reads what matters for that work. The 17
kinds are the ones people use for community pay, without "Other work", plus "Founding a company". They are listed in
`src/core/work.ts`, `WORK_KINDS`. Each kind has a recipe that shares the group's weight over its parts. The recipes:

| Kind | Recipe (share of the group) |
|---|---|
| Software and IT | pay in your field 35%, jobs in your field 25%, developers 25%, research output 15% |
| Engineering, not software | pay 35%, jobs 30%, degrees 15%, research output 20% |
| Research and science | research output 40%, pay 25%, jobs 20%, degrees 15% |
| Doctors and dentists | pay 55%, jobs 30%, research output 15% |
| Nursing and care, public sector | pay 60%, jobs 40% |
| Teaching and education | pay 55%, jobs 30%, degrees 15% |
| Finance and accounting | pay 45%, jobs 35%, degrees 20% |
| Law | pay 50%, jobs 30%, degrees 20% |
| Marketing, design and media | pay 40%, jobs 30%, degrees 20%, young companies 10% |
| Office and administration | pay 70%, jobs (unemployment) 30% |
| Sales, hospitality, trades, transport | pay 50%, jobs in your field 30%, jobs (unemployment) 20% |
| Management | pay 55%, degrees 20%, young companies 25% |
| Founding a company | young companies 35%, developers 25%, degrees 15%, research output 15%, Founders Running Club 10% |

The group keeps the weight it had and only the split changes; the person can tune any part afterwards. Clearing the
kind shares the weight by the default weights again. The new lines (`field_pay`, `field_jobs`, `young_companies`,
`qol`) have a default weight of 0, so a profile without a kind scores exactly as before. A test checks this, and every
default ranking of the 57 cities was compared with the previous release: they match exactly.

Each city then explains its place in plain sentences, e.g. "For software and IT, San Francisco scores 94 of 100 on
Work and ambition, first of your 15 cities". One sentence follows for each part, with its figure, rank and what the
figure counts. Where under 60% of the country speaks English and English is not an official language, a sentence says
that many jobs ask for the local language.

### Pay in your field (`pay_<kind>`, line `field_pay`)

Mean gross pay a year of employees, before tax. Each figure's note says which occupations or industry it counts.

| Where | Source | Level | What a kind reads |
|---|---|---|---|
| United States | BLS Occupational Employment and Wage Statistics, May 2025, through api.bls.gov (public domain) | Metro area | SOC 2018 major occupation groups (software: 15-0000 computer and mathematical) |
| United Kingdom | ONS Annual Survey of Hours and Earnings, table 5.7a, full-time employees (Open Government Licence) | Region | SIC 2007 industry |
| EU and EFTA | Eurostat Structure of Earnings Survey 2022, `earn_ses22_49`, mean annual earnings | Country | ISCO 08 occupation within the kind's NACE industry, firms of 10 or more; where a country publishes no all-industry total, the total without public administration, noted |
| Canada | Statistics Canada table 14-10-0064, weekly wages of full-time employees by industry, times 52 (Statistics Canada Open Licence) | Province | NAICS industry |
| Australia | ABS Average Weekly Earnings, full-time adult total earnings, times 52 (CC BY 4.0) | Country by industry; all jobs by state | ANZSIC industry |
| Japan, Singapore | ILOSTAT average monthly earnings of employees by economic activity, times 12 (CC BY 4.0) | Country | ISIC industry; Japan leaves bonuses out |

Dubai has no pay figure. Pay in your field is a guide to the market there: take-home pay and money left still use the
salary the person enters. Scale: €15,000 to €150,000 a year, in the display currency.

### Jobs in your field (`jobs_<sector>`, line `field_jobs`)

How many of every 1,000 people in work work in the kind's field, in one of seven sectors (`SECTORS` in
`src/core/work.ts`). Each sector has its own scale, about the 10th to the 90th percentile of the 57 cities.

| Where | Source | Level |
|---|---|---|
| United States | BLS Quarterly Census of Employment and Wages, jobs where people work (public domain). Information and communication is NAICS 51 plus 5415, computer systems design; cells the BLS withholds count as 0 | County |
| EU and EFTA | Eurostat `lfst_r_lfe2en2`, employment by NACE section, by where people live | NUTS 2 region |
| Canada | Statistics Canada Labour Force Survey | Province |
| United Kingdom, Australia, Japan, Singapore, UAE | ILOSTAT employment by economic activity | Country |

### Young companies nearby (`young_companies`)

Businesses in Wikidata founded in 2010 or later whose headquarters is within 50 km of the centre, with articles on at
least two Wikimedia sites. The query runs on QLever's Wikidata endpoint (CC0). Requiring two sitelinks drops bulk
imports of company registers: without it Prague reads 6,897. The count follows how well each country's companies are
written about. Tokyo (296) and San Francisco (216) read high partly for that reason, and Tokyo partly for its anime
studios. It is a rough signal, opt-in, and part only of the founder, management and marketing recipes. Scale: 0 to
200.

Venture funding has no open source by city: Crunchbase, Dealroom, Startup Genome and the Y Combinator directory are
links only.

### San Francisco, before and after (15 cities, balanced weights)

| Kind | San Francisco on Work and ambition | Next | Overall rank |
|---|---|---|---|
| None (default) | 61 (research output only) | Cambridge 95, Boston 84 | 14th |
| Software and IT | 94, first | Seattle 91 | 3rd |
| Founding a company | 94, first | Boston 70 | 3rd |

## Quality of life index (`src/core/qol.ts`)

A generic score per place, the same for everyone, beside the person's own ranking and never instead of it. It reads
Borgo's own sourced lines on their fixed scales, for a single full-time employee on the place's average pay
(`pay_all`) with the default nice day.

| Part | Weight |
|---|---:|
| Take-home pay against prices (Borgo's tax model on average pay, over the country's price level; €12,000 to €60,000 at US prices) | 20 |
| Nice days | 15 |
| Clean air | 15 |
| Safety | 15 |
| Long lives | 10 |
| Happiness | 10 |
| Clean government | 10 |
| Doctors | 5 |

A part with no figure is left out and the others share its weight; under 60% of the weight there is no index. The city
sheet and city pages show the parts and weights; `get_city` returns `qualityOfLife`. It counts in a ranking only when
the person weights the `qol` line (off by default), which repeats lines they may already weight. Numbeo, Mercer, the
EIU and Monocle publish their own indices by their own methods: Borgo links to them and copies nothing.
