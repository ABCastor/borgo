import type { CityResult, Evaluation, LineResult } from "../core/engine.ts";
import { html, type Raw } from "./dom.ts";
import type { Resolved } from "../core/lookup.ts";
import { num } from "./format.ts";
import { term } from "./terms.ts";

// What a card says at a glance, in place of the rose: where the city wins and loses against your other
// cities, on the engine's own points. The points ruler (one column per value, as wide as your share and
// as tall as the city's result) is drawn on the city's own page.

const SHORT: Record<string, string> = {
  money_left: "Money kept",
  living_cost: "Cost of living",
  right_to_live: "Right to live there",
  nice_days: "Nice days",
  winter_light: "Winter daylight",
  sunshine: "Sunshine",
  dry_days: "Dry days",
  clean_air: "Clean air",
  safety: "Safety",
  long_life: "Long lives",
  happiness: "Happiness",
  builders: "Research output",
  politics: "Politics",
  abortion: "Abortion law",
  couples_law: "Same-sex couples",
  health_costs: "Health costs",
  childcare: "Childcare",
  family_leave: "Parents' leave",
};
/** Why a must-pass line rules a city out, in words that read after "ruled out:". */
const FAILS: Record<string, string> = {
  right_to_live: "not everyone can move there",
  money_left: "you would keep less than nothing",
};
export const failText = (labels: string[], all: { id: string; label: string }[]) =>
  labels.map((lab) => {
    const id = all.find((c) => c.label === lab)?.id ?? "";
    return FAILS[id] ?? `fails "${lab.toLowerCase()}"`;
  }).join("; ");

export const shortLabel = (l: { id: string; label: string }) => SHORT[l.id] ?? l.label;

/**
 * A line's share of this city's score: its weight over the weights of the lines that score here. A line with no
 * score here (money with no figure any city can be compared on) has none, and the others share its weight, so a
 * line's points never exceed the share shown beside them.
 */
export function scoreShare(r: CityResult, l: LineResult): number | null {
  if (l.score === null) return null;
  const scored = r.lines.reduce((t, x) => t + (x.score === null ? 0 : x.weight), 0);
  return scored > 0 ? l.weight / scored : null;
}

const LEVEL_WORD = { city: "", metro: "metro area", region: "region", country: "national" } as const;

/**
 * Where and when a figure is from, said next to it: "national, 2023", "region, 2024", "2021–2025" for the city
 * itself, "yours" for the person's own number. Empty when the line has no single source (money, the right to live).
 */
export function scopeOf(r: Resolved | undefined): string {
  if (!r) return "";
  if (r.origin.kind === "you") return "your number";
  const o = r.origin.observation;
  const when = /^\d{4}-\d{4}$/.test(o.period) ? o.period.replace("-", "–") : o.period.slice(0, 4);
  return [LEVEL_WORD[r.level], when].filter(Boolean).join(", ");
}

export interface Delta {
  line: LineResult;
  /** Points above (+) or below (−) the average of the other cities on this line. */
  d: number;
}

export function deltas(r: CityResult, all: CityResult[]): Delta[] {
  const others = all.filter((o) => o.city.id !== r.city.id);
  return r.lines
    .filter((l) => l.weight > 0 && l.score !== null)
    .map((l) => {
      if (!others.length) return { line: l, d: l.points };
      const pts = others.map((o) => o.lines.find((x) => x.id === l.id)?.points ?? 0);
      return { line: l, d: l.points - pts.reduce((a, b) => a + b, 0) / pts.length };
    });
}

/** The largest swing on any card, so every card's bars share one scale. */
export function glanceScale(e: Evaluation): number {
  let m = 1;
  for (const r of e.results) for (const x of deltas(r, e.results)) m = Math.max(m, Math.abs(x.d));
  return m;
}

function row(x: Delta, scale: number, kind: "win" | "loss", alone: boolean, failing: boolean): Raw {
  const w = Math.min(100, (Math.abs(x.d) / scale) * 100);
  const sign = alone ? "" : x.d > 0 ? "+" : "−";
  const scope = scopeOf(x.line.raw.sources[0]);
  return html`<li class="wl ${kind} ${failing ? "is-fail" : ""}" title="${x.line.label}: ${x.line.raw.text}${scope ? ` (${scope})` : ""}. ${alone ? `${num(x.d, 1)} points of your score` : `${sign}${num(Math.abs(x.d), 1)} points against the average of your other cities`}.">
    <span class="wl-n">${shortLabel(x.line)}</span><span class="wl-v">${failing ? "must pass, fails" : html`${x.line.raw.text}${scope ? html`<span class="wl-s"> · ${scope}</span>` : ""}`}</span>
    <span class="wl-d num">${sign}${num(Math.abs(x.d), 1)}</span><span class="wl-bar" aria-hidden="true"><i style="width:${w.toFixed(1)}%"></i></span></li>`;
}

export function winsLosses(r: CityResult, e: Evaluation, scale: number, mustPass: string[]): Raw {
  const ds = deltas(r, e.results).filter((x) => !x.line.imputed);
  const alone = e.results.length < 2;
  const failing = ds.filter((x) => mustPass.includes(x.line.id) && x.line.failed);
  if (alone) {
    const best = ds.sort((a, b) => b.d - a.d).slice(0, 4);
    return html`<div class="glance"><p class="wl-h">${term("wins", "Earns most on")}</p><ol class="wl-list">${best.map((x) => row(x, scale, "win", true, false))}</ol>
      <p class="wl-none">Add a second city to see where each one wins and loses.</p></div>`;
  }
  const wins = ds.filter((x) => x.d > 0.25 && !failing.includes(x)).sort((a, b) => b.d - a.d).slice(0, 2);
  const losses = [...failing, ...ds.filter((x) => x.d < -0.25 && !failing.includes(x)).sort((a, b) => a.d - b.d)].slice(0, failing.length ? Math.max(2, failing.length) : 2);
  return html`<div class="glance">
    <p class="wl-h">${term("wins", "Wins on")}</p>
    ${wins.length ? html`<ol class="wl-list">${wins.map((x) => row(x, scale, "win", false, false))}</ol>` : html`<p class="wl-none">Ahead on nothing you weigh.</p>`}
    <p class="wl-h">Loses on</p>
    ${losses.length ? html`<ol class="wl-list">${losses.map((x) => row(x, scale, "loss", false, failing.includes(x)))}</ol>` : html`<p class="wl-none">Behind on nothing you weigh.</p>`}
  </div>`;
}

/** The widest columns of the ruler, in words: the same for every city, so it is said once above the sheets. */
export function rulerKey(r: CityResult): Raw {
  const lines = r.lines.filter((l) => l.weight > 0 && l.score !== null);
  return html`Widest columns: ${lines.sort((a, b) => b.weight - a.weight).slice(0, 3).map((l, i) => html`${i ? " · " : ""}<b>${shortLabel(l)}</b> ${Math.round(100 * scoreShare(r, l)!)}%`)}. Point at a column for the rest.`;
}

/** Your values as one row of columns: width is your share, height the city's result; the filled area is the score. */
export function ruler(r: CityResult, mustPass: string[], o: { labels?: boolean } = {}): Raw {
  // Only lines that score here are columns: the filled area is then the score itself.
  const lines = r.lines.filter((l) => l.weight > 0 && l.score !== null);
  return html`<figure class="ruler-fig"><div class="ruler" role="img" aria-label="${r.city.name}: ${Math.round(r.total)} of 100, built from ${lines.length} values">
      ${lines.map((l) => {
        const share = scoreShare(r, l)!;
        const cls = [l.imputed ? "is-imputed" : "", l.personal ? "is-personal" : "", mustPass.includes(l.id) && l.failed ? "is-fail" : ""].join(" ");
        return html`<span class="rs ${cls}" style="flex:${share.toFixed(4)} 1 0" title="${l.label}: ${l.imputed ? "no figure, scored as the lowest of your other cities" : l.raw.text}. ${Math.round(share * 100)}% of your score, result ${Math.round((l.score ?? 0) * 100)} of 100, ${num(l.points, 1)} points.">
          <i style="height:${Math.max(3, (l.score ?? 0) * 100).toFixed(1)}%"></i></span>`;
      })}</div>
    ${o.labels === false ? "" : html`<figcaption class="ruler-cap">${rulerKey(r)}</figcaption>`}</figure>`;
}
