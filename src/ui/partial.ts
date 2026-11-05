// The partial-data note on a city's sheet and dossier: shown only when the city itself lacks something the comparison
// uses (a figure your other cities have, a tax model, free-movement rules), with the share of its score that rests on
// its own figures. What the person has not given yet (a passport, a salary, a rent) is not partial data: the answer
// and the sheet ask for it as the next input instead.
import type { CityResult } from "../core/engine.ts";
import { gapsShort, resultGaps } from "../places/gaps.ts";
import { html, type Raw } from "./dom.ts";
import type { AppState } from "./state.ts";
import { term } from "./terms.ts";

/** The share of a city's score from its own figures, among the lines that count for at least one of your cities. */
export function ownShare(r: CityResult): number {
  const counting = r.lines.filter((l) => l.weight > 0 && (l.observed || l.imputed));
  const all = counting.reduce((s, l) => s + l.weight, 0);
  return all === 0 ? 1 : counting.reduce((s, l) => s + (l.observed ? l.weight : 0), 0) / all;
}

/** The gaps that matter to this comparison: a missing model or rule only when the lines that need it count. */
function relevantGaps(s: AppState, r: CityResult) {
  const w = (id: string) => r.lines.find((l) => l.id === id)?.weight ?? 0;
  const money = w("money_left") + w("living_cost") > 0;
  const rights = w("right_to_live") > 0 || s.profile.dealBreakers.includes("right_to_live") || s.profile.household.length > 0;
  return resultGaps(s.data, r).filter((g) => (g.what === "Residence rules" ? rights : g.what === "Take-home pay" || g.what === "Money" ? money : true));
}

/** On a sheet: the marker, the share, and the first few gaps. In the dossier (`full`): every gap, one per line. */
export function partialNote(s: AppState, r: CityResult, full = false): Raw {
  const gaps = relevantGaps(s, r);
  if (!gaps.length) return html``;
  const real = ownShare(r);
  const share = real < 0.999 ? html` ${Math.round(real * 100)}% of this ${term("score", "score")} from ${term("real", "its own figures")}` : "";
  if (full)
    return html`<div class="partial"><p class="real"><b class="partial-mark">Partial data</b>${share}</p>
      <ul class="gaps" aria-label="What ${r.city.name} lacks">${gaps.map((g) => html`<li><b>${g.what}</b>: ${g.why}</li>`)}</ul></div>`;
  return html`<p class="real"><b class="partial-mark">Partial data</b>${share}${share ? ": " : " "}${gapsShort(gaps)}.</p>`;
}
