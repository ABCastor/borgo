# Right to live and work: entry difficulty

Borgo separates **rights already held** from **how difficult an application route is**. This is a rough guide, not legal advice or an approval prediction. The person's passports, free movement and valid work-permitting rights establish “Already allowed”. Otherwise, only a route whose conditions the person confirms applies is scored. An unchecked country or route says “Not checked”, not “Very hard”.

The household uses its hardest checked route. If anyone's difficulty is unchecked, the household difficulty has no score. The fixed levels are Already allowed (1), Straightforward route (0.75), Demanding route (0.4), and Very hard (0.1). The levels and numbers are Borgo's interpretation of procedural barriers, not facts supplied by a government. A Required right-to-live line filters on existing rights, so even a straightforward prospective application does not pass that requirement. Required lines take no scoring share.

## Sourced coverage

The factual summaries and provenance live in `src/core/entry-routes.ts`. Only short factual requirements are encoded; no page, guidance text or personal application is reproduced. Sources are read on 19 November 2026; the period is November 2026. Recheck the linked requirements before making plans or applying.

| Country and route | Procedural facts and applicability | Borgo's level | Official source and redistribution |
|---|---|---|---|
| UK Ancestry | Commonwealth citizenship, eligible UK-born grandparent, age 17 or above, ability and intention to work, support without public funds. No employer sponsorship or annual selection lottery. Other qualifying nationality categories also exist; this row covers Commonwealth applicants only. | Straightforward route, only when the person confirms those conditions | [UK Home Office](https://www.gov.uk/ancestry-visa), [eligibility](https://www.gov.uk/ancestry-visa/eligibility), [Open Government Licence 3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) |
| UK Skilled Worker | Confirmed eligible job offer with an approved employer sponsor; applicable salary and English requirements. The exact thresholds depend on the job and circumstances. | Demanding route | [UK Home Office](https://www.gov.uk/skilled-worker-visa), Open Government Licence 3.0 |
| US cap-subject H-1B | Employer petition, qualifying specialty occupation and qualification; annual numerical limits and selection when registrations exceed the limit. Cap-exempt jobs are outside this row. | Very hard | [US Citizenship and Immigration Services](https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations), [US government website policies](https://www.uscis.gov/website-policies), federal government facts/public-domain material |

These are routes, not country-wide verdicts. An Italian passport alone does not establish that a UK route is straightforward. A US route outside cap-subject H-1B is not automatically very hard. Other countries, family routes, talent routes, self-employment, youth mobility and cap-exempt US employment are not checked here.

## Interfaces

In the people editor, open **How hard to get in** for each person and choose an applicable route. The conditions and official source sit with the choice. Existing rights take precedence. Route choices stay in the private household profile and travel in a share link only when the person includes household information.

CLI JSON arguments (`--args profile.json`) and MCP household entries take `entryRoutes`, for example `{"GB":"gb-skilled","US":"us-h1b"}`. Use only facts and route applicability the person confirms. Empty or unsupported routes are not checked. `methodology` lists the same sources and levels.
