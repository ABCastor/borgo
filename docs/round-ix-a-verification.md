# Round IX-A implementation and verification

Context home for this implementation: this file. Branch: `round-ix-a`, based on `main` at `29d5ae7`. Status: implementation and local verification complete; not pushed or deployed. The requested repository `AGENTS.md` and `PRODUCT.md` were not present in the supplied checkout. The parent instructions and architecture section 3.7 were read; that section now describes the implemented behavior.

## Changes and agent calls

1. First visits use `emptyProfile`, separate from reference/agent defaults: no cities, salary, spending or people. The prerendered first page uses the same empty state and preloads no example cities. Reset uses confirmation rather than undo because it clears several classes of personal settings. Cancellation preserves the comparison; acceptance saves an empty comparison and opens setup. Public city caches remain, explicitly stated in the confirmation. An epoch guard prevents an older asynchronous city fetch from adding a city after Reset.
2. Setup has five selectable steps with Back, Next, Finish and Skip, plus a permanent Guided setup entry point. It leads to the existing city, priorities, money, household and weather editors rather than creating competing copies of those inputs. Its AI disclosure contains connection instructions and a copyable prompt. The remote MCP already accepts the profile fields requested, so no MCP implementation change was necessary. An added SDK-to-Worker integration test supplies work, weights, same/per-city pay, currency, housing, spending, household, a partner's passports and permanent right, children, requirements and every weather option. The remote service cannot fetch arbitrary cities; the prompt explains the web-app/local-MCP alternative and never promises remote fetch_city or automatic browser synchronization.
3. Weights now say `% of score`; Money's question asks about importance relative to other priorities. Raised the artificial 40/60 slider ceilings to 100, while retaining the engine's existing valid 0-100 per-criterion range. Kept relative importance rather than introducing a second percentage-allocation algorithm: setting every other priority to zero gives one priority the full score. Expanded groups explain the part/group sum, and the group's share in that explanation updates live.
4. Removed rule-out controls from the weight rows. Other requirements live in a bordered Rule cities out, regardless of score disclosure. The separate rights panel says Require everyone to qualify and explains that this is not a score weight. Existing engine exclusion semantics are unchanged.
5. Nice days explicitly means weather. The editor's table uses the current temperature range, rain, sun/cloud, humidity, wind, heat bound and daylight setting. It labels each test Required or Off. Tests are conjunctive: all enabled tests must pass on the same day. Inventing individual weather-test percentages would misrepresent the existing engine, so the table explains that only the resulting annual count receives a score weight. The tooltip now reads the current profile; Edit weather tests replaces the ambiguous chip-only gesture. With wind enabled, city-specific counts with/without wind explain which days the test removes.
6. The map checks its backing buffer on every paint, independent of whether the rounded layout width changes. Drawing uses the actual buffer-to-layout ratio; pointer and wheel positions use current bounds. A second fix prevents a nearby seed city's oversized hit area from swallowing a closer populated place, found with Riyadh/Dubai on narrow maps. City colours now use an orange-neutral-blue diverging ramp, numerical legends/rankings remain available, and Your score uses an absolute 0-100 scale rather than restretching its extrema. Land still represents temperature-range months except on the rights lens. The explanation before the canvas makes that limitation explicit.
7. `srcMark` uses Source / Sources consistently for ordinary figures, rent, consensus and personal overrides. It preserves the source popover, period and national/region metadata.
8. `round-ix-a-proposal.md` ranks future density reductions with measured before counts and explicit after budgets, and recommends an on-demand film dialog next to setup. No density cuts or video placement changes were implemented.

## Map reproduction and numerical result

A controlled baseline build bundled the original `src/ui/map.ts` from `29d5ae7` into the otherwise current app, without altering source files. Real browser zoom was set through `chrome.tabs.setZoom` in a temporary extension, not CSS zoom or a simulated device scale.

At 1440 px, moving from 67% to 80% browser zoom left the original canvas buffer at 754 × 368 while the displayed canvas was 1126.02 × 548.98 CSS pixels and devicePixelRatio was 0.8000000119. The required buffer was about 901 × 439. The original draw transform used the new ratio against the old buffer, so painted and clickable positions diverged. The regression failed its buffer-size assertion on that original map module. The final implementation passes the same check at 67%, 80% and 110%, before and after resize, on both tested widths and themes.

Separately, at 390 px and 80%, a Riyadh click opened Dubai because the seed-city reach check ran before comparing the nearest populated place. The final pointer checks open New York, London, Riyadh and Anchorage at their independently projected coordinates across all 24 zoom/resize/width/theme combinations: 96 point selections.

Score recomputation itself was already wired correctly. Two other facts explained the weak visual change: the whole land background is temperature-only by design, and city shades were stretched to each scenario's current lowest/highest score. The latter could conceal an absolute score shift. The fixed score scale removes that rescaling.

Published-data control: Lisbon, London and Berlin, Software and IT, no salary or money weight, default 18-30 °C feels-like dry/sunny weather. Work-heavy uses total work weight 100 and Nice days 1; weather-heavy uses total work weight 1 and Nice days 100. Individual work lines retain the kind-of-work recipe.

| City | Work-heavy score / 100 | Weather-heavy score / 100 | Change |
|---|---:|---:|---:|
| Lisbon | 50.34 | 47.23 | -3.11 |
| London | 45.27 | 1.54 | -43.73 |
| Berlin | 50.91 | 6.05 | -44.86 |

These are real differences, not a stuck scoring engine. The unit regression checks them on candidate scoring; the browser walkthrough separately changes actual work/weather sliders and observes the London map-list score change in all four width/theme runs. The precise browser scenario also has calm wind enabled and a 16-27 °C range; its results are recorded separately in `round-ix-a-shots/walkthrough.json`.

## Executed checks

Runtime: Node 24.22.2, TypeScript 7, headless Chrome for Testing 159.0.8154.6 on Linux. CI's workflow specifies Node 26; its test, type-check, data-build and site-build commands were executed here on the installed Node 24 runtime.

| Check | Result |
|---|---|
| `npm test` | 561 tests passed, 0 failed, 0 skipped |
| `npx tsc --noEmit` | Exit 0, no diagnostics |
| `npm run data` | Exit 0: 57 cities; 5,245 main, 512 ODbL, 54 WHO, 6 CMHC and 12 OMI observations; 65 licensed sources; 5,157 map tiles and 4,229 places |
| `npm run build` | Exit 0: app, 426 pages, 1,049 files |
| `git diff --check` | Clean |
| Chromium walkthrough | Passed at 1440 and 390 px, light and dark, with no page errors or horizontal overflow in the captured states |

Six new focused tests in `test/round-ix-a.test.ts` cover empty/reset profiles, score-share language and allocation, current weather definition/table, zoom geometry, changed work/weather scores and source labels. One added MCP integration test covers the AI setup contract. Existing first-visit/region assertions were updated because their old requirement was exactly the seeded example flow this task replaces; regional utility and Worker coverage remain.

The browser script exercises all five setup steps, skipping, city entry including Geneva, group expansion, current-weather tooltip, calm-wind diagnostics, live map score updates, both fixed lenses, real browser zoom and resize, reset cancellation, reset acceptance and reset persistence after reload. `round-ix-a-shots/walkthrough.json` contains 32 evidence records: 24 zoom/resize cases, four live score-change cases and four completed walkthroughs with section word counts.

## Reproduce the browser evidence

After building the site, provide an installed Playwright module and an extension-capable Chromium executable. The browser script starts its own bounded local server, isolated browser profiles and zoom-test extension, then closes them and deletes its temporary profiles.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME=/path/to/chrome node scripts/round-ix-a-walkthrough.mjs
```

Screenshots are in `docs/round-ix-a-shots/`: 44 PNGs for empty start, each setup step, weights, weather table, map score lens, map weather lens and reset. They total about 6.1 MB and are deliberately untracked, not included in the commit. The small JSON evidence record is committed. `SHOTS_DIR` can redirect a new run's output. Generated dataset build-time metadata was restored after checking the data build to avoid unrelated timestamp churn; the site and tests were run against the repository's committed dataset inputs.

## Limits and next step

This was an isolated local build, not a production deployment. Physical phones, WebKit/Firefox, a human colour-blindness study, external AI clients and native OS accessibility software were not tested. Orange/blue separates the endpoints without relying on red-versus-green discrimination; numbers and ranking remain the non-colour fallback. The requested colour readability was visually inspected in the captured light/dark views, not certified as universal colour-vision accessibility. No npm release, package-matrix smoke run, push or video publication was attempted.

The next owner is the parent integrator: review and fetch this branch, retrieve or regenerate the untracked screenshots if needed, then run the normal publication gates before shipping. The density/video proposal is not a release blocker for these approved implementation changes.
