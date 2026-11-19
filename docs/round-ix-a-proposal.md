# Round IX-A: reduce the reading before the comparison

Borgo should let someone add two cities and see what changes the answer before asking them to read the explanation of every control. Keep the information available, but stop repeating it beside the controls, inside their editors and below the results.

This is a proposal only. No sections have been cut, collapsed or moved as part of this density pass. The implemented walkthrough, empty start, exclusion panel and weather table answer the separately approved usability findings.

## Cuts and moves, ranked by gain

The before column measures this branch's rendered desktop interface, not the previous release. Fixture: 1440 px, light, Lisbon/London/Geneva, Money expanded, a 16-27 °C feels-like range with dry, sunny and calm enabled. Count whitespace-separated visible words, including labels and numbers; replace select-option lists with the selected option and exclude collapsed details. `scripts/round-ix-a-walkthrough.mjs` records these counts in `round-ix-a-shots/walkthrough.json`. Each row is a distinct block, not an estimate for the whole page. The after column is a proposed visible-word budget, not a screen already implemented.

| Rank | Section | Before | After budget | Fewer words | Proposed change |
|---|---|---:|---:|---:|---|
| 1 | Nice-day editor, including its tests table and wind explanation | 335 | 150 | 185 | Keep the editable range and table. Put test switches in the table instead of repeating each definition beneath it. Keep each city's wind-loss count visible when wind is enabled, but collapse the methodology and source paragraph under Weather sources and calculation. Keep a visible source link. |
| 2 | Map instructions above the canvas | 84 | 24 | 60 | Keep the city-dot versus land distinction. Move mouse, touch and keyboard instructions into Map help, reachable from the map heading and keyboard focus. Keep the canvas's accessible instructions. |
| 3 | Right-to-live panel | 66 | 26 | 40 | Keep passports, the clear rule-out control and Add someone. Move the list of permit kinds into the existing people-and-rights editor. Keep unchecked and failed requirements visible. |
| 4 | Expanded Money parts | 41 | 14 | 27 | Replace the paragraph with one line: the lines split Money's share of the score. Keep percentages on each line and one rounding note on demand. Do not move Money kept or Cost of living out of the group. |
| 5 | What matters explanation | 51 | 29 | 22 | Keep the relative-importance explanation and the warning that this is not a savings rate. Move the slider-range and how-to-reach-100% explanation into the existing Share definition. |
| 6 | First guided-setup step | 82 | 64 | 18 | Keep the current task and Next/Skip. Shorten the five-step navigation labels to Cities, Priorities, Money, People, Weather; the active heading retains the full meaning. Keep Ask your AI as a closed disclosure. |
| | Total across these six blocks | 659 | 307 | 352 | About 53% fewer initially visible words across the measured blocks. |

The first move is the weather editor. It currently defines dry, sunny and calm twice: once in the table, then again beside their switches. Removing that duplication preserves the definitions and makes the editing action easier to find. The map help move comes second, but must preserve the explanation that changing work weights changes dots, not the worldwide temperature background.

Beyond the measured blocks, keep the comparison, map and lens selector, Software and IT, passports and existing rights, partner support, MCP and arbitrary-city entry in their current flows. Do not remove them to achieve a word-count target. A later pass can move Every figure and the generic quality-of-life breakdown behind dossier disclosures, but their variable tables need their own measurement before assigning an honest saving.

## Where the film belongs

1. **Recommended: a Watch a 40-second example link beside Guided setup.** Open the film in a keyboard-accessible dialog, load the media only after the click, provide captions or a transcript, and restore focus when it closes. Offer the 10-second silent loop inside the first setup step under Show me an example, closed by default. This keeps the empty starting action in view and gives people help at the moment they need it. It adds no media download to a normal comparison.
2. **A small first-visit preview beside the empty state.** Use a still poster with an explicit play button for the 40-second film. The silent loop can play only after an explicit Preview action, and stops when it leaves view. More discoverable than the first option, but it competes with Add a city on a 390 px screen. Do not autoplay it above the city input.
3. **About / How Borgo works as the media home.** Put both versions there, with a small How it works link from setup. This is the least distracting option for returning visitors, but fewer newcomers will find the demonstration before making their first comparison. It works as a permanent home even if option 1 supplies the entry point.

The existing `docs/media/borgo-demo.mp4` and `borgo-demo.webp` are repository media, not yet a promise that those assets match the new empty-start flow. Review the footage before publishing it: an old example salary, city shortlist or hidden weather-test gesture would teach the behavior this round removes. Keep the first frame useful in both themes, respect reduced-motion preferences, and avoid loading the loop for someone who never opens the example. No video placement or media delivery changes are implemented in this branch.
