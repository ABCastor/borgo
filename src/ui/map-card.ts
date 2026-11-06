import { monthsInRangeOf, niceDays } from "../core/criteria.ts";
import type { CityResult, LineResult } from "../core/engine.ts";
import { money as moneyOf, type MoneyResult } from "../core/money.ts";
import { rightToLiveWork } from "../core/rights.ts";
import type { City } from "../core/types.ts";
import { highInRange, monthsInRange, tileHighs, type WorldMap } from "../core/world-map.ts";
import { bandOf } from "./climate.ts";
import { html, type Raw } from "./dom.ts";
import { countryName, distance, local as localText, money, MONTHS, num, tempUnit, tempValue } from "./format.ts";
import { shortLabel } from "./glance.ts";
import { CLOSE } from "./results.ts";
import type { AppState } from "./state.ts";
import { regionName } from "./top.ts";

// The card a place on the map opens: what the place is, how many months of its year are in the person's nice-day
// range, what they would take home there, and the figures its rank rests on. Pointing at a place shows it; clicking
// pins it, and only the pinned card's "Add to my cities" adds the place.

export type MapPlace = WorldMap["places"][number];
export type Target = { kind: "city"; id: string } | { kind: "land"; tile: number; place: MapPlace | null };

export const sameTarget = (a: Target | null, b: Target | null): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind === "city" ? a.id === (b as { id: string }).id : a.tile === (b as { tile: number }).tile && a.place?.[0] === (b as { place: MapPlace | null }).place?.[0]));

/** What a click on the map does: pins the place under the pointer, or unpins when it is the one already pinned. It never adds. */
export function pinAfterClick(pinned: Target | null, clicked: Target | null): Target | null {
  return clicked && !sameTarget(clicked, pinned) ? clicked : null;
}

export interface CardContext {
  map: WorldMap;
  pinned: boolean;
  /** The city's result as it would score among the person's cities (for a city target). */
  result?: CityResult;
  /** The line the map is coloured by, when it is one value and not the score or nice days. */
  lens?: { id: string; label: string; text: string } | null;
}

const rangeText = (s: AppState) => `${tempValue(s.profile.prefs.comfort.min)}–${tempValue(s.profile.prefs.comfort.max)}°`;
const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

function head(name: string, meta: Raw | string, pinned: boolean): Raw {
  return html`<div class="mc-head"><b class="mc-name" id="map-card-name">${name}</b><span class="mc-meta">${meta}</span>${pinned ? html`<button class="chip-x mc-x" data-act="map-unpin" aria-label="Close">${CLOSE}</button>` : ""}</div>`;
}

/** Take-home pay a month in the display currency, said only once the person has given a salary. */
function takeHome(m: MoneyResult): Raw | "" {
  if (m.missing.includes("salary")) return "";
  const why = m.missing.find((x) => x.startsWith("a tax model for ") || x.startsWith("an exchange rate for "));
  if (m.display.net === null) return html`<p class="mc-line"><span class="mc-k">Take-home</span> not known${why ? `: no ${why.slice(why.indexOf(" ") + 1)} yet` : ""}</p>`;
  const left = m.taxCompleteness.status === "partial" && m.taxCompleteness.missing.length ? html` <span class="quiet">at most: leaves out ${m.taxCompleteness.missing[0]}</span>` : "";
  return html`<p class="mc-line"><span class="mc-k">Take-home</span> <b class="num">${money(m.display.net / 12, m.display.currency)}</b> a month${left}</p>`;
}

function figure(l: LineResult): Raw {
  const v = l.failed ? "must pass, fails" : l.imputed || l.score === null ? "no figure" : localText(l.raw.text);
  return html`<li><span class="mc-k">${shortLabel(l)}</span> <span>${v}</span></li>`;
}

/** The lines its rank rests on: the ones you weigh most, after the nice days and pay the card already says. */
function rankFigures(r: CityResult, lens: CardContext["lens"]): Raw | "" {
  const weighed = r.lines.filter((l) => l.weight > 0 && l.id !== "nice_days").sort((a, b) => b.weight - a.weight);
  const top = weighed.slice(0, 3);
  const shown = lens && !top.some((l) => l.id === lens.id) ? r.lines.find((l) => l.id === lens.id) : undefined;
  const list = shown ? [shown, ...top.slice(0, 2)] : top;
  return list.length ? html`<ul class="mc-figs" aria-label="What its rank rests on">${list.map(figure)}</ul>` : "";
}

function monthBars(values: number[], max: number, title: string): Raw {
  return html`<div class="mc-months" role="img" aria-label="${title}">${values.map(
    (v, i) => html`<span><i style="height:${Math.round((100 * Math.min(v, max)) / max)}%"></i><b>${MONTHS[i]}</b></span>`,
  )}</div>`;
}

function cityCard(s: AppState, id: string, cx: CardContext): Raw {
  const r = cx.result;
  const city = s.data.cities.find((c) => c.id === id)!;
  const mine = s.profile.cities.includes(id);
  const evaluated = s.profile.cities.length + (mine ? 0 : 1);
  const top = head(city.name, countryName(s.data, city.country), cx.pinned);
  if (!r) return html`${top}<p class="mc-line quiet">Not scored yet.</p>`;
  const out = r.ruledOut.length > 0;
  const nice = niceDays(s.data, s.profile, city)?.months ?? null;
  const inRange = monthsInRangeOf(s.data, s.profile, city);
  const actions = cx.pinned
    ? html`<div class="mc-act">${mine
        ? html`<a class="ink-btn" href="#/city/${id}">Open dossier</a><button class="link" data-act="remove-city" data-city="${id}">Remove from your cities</button>`
        : html`<button class="ink-btn" data-act="add-known" data-city="${id}">Add to my cities</button>`}</div>`
    : html`<p class="mc-hint">${mine ? "Click to pin" : "Click to pin, then add it"}</p>`;
  return html`${top}
    <p class="mc-score"><span class="mc-big num">${Math.round(r.total)}</span><small>/ 100</small><span class="mc-rank">${out ? "ruled out" : mine ? `No. ${r.rank} of ${evaluated}` : `would be No. ${r.rank} of ${evaluated}`}</span></p>
    ${inRange ? html`<p class="mc-line"><span class="mc-k">In your range</span> <b>${months(inRange.count)}</b> of 12 with afternoon highs ${inRange.basis === "air" ? `of ${rangeText(s)} (air)` : `that feel ${rangeText(s)}`}</p>` : ""}
    ${nice ? html`<p class="mc-line"><span class="mc-k">Nice days</span> ${num(nice.reduce((a, b) => a + b, 0))} a year</p>${monthBars(nice, 31, "Nice days by month")}` : ""}
    ${takeHome(r.money)}
    ${rankFigures(r, cx.lens)}
    ${!mine && !out && r.coverage < 0.999 ? html`<p class="mc-note">${Math.round(r.coverage * 100)}% of this score from real data.</p>` : ""}
    ${actions}`;
}

/** A town the map knows but the comparison does not: what a click can add, by its GeoNames id where there is one. */
function townCity(pl: MapPlace): City {
  return { id: `map-${pl[5] || `${pl[0]}-${pl[1]}`}`, name: pl[0], country: pl[1], lat: pl[2], lon: pl[3], population: pl[4] };
}

function landCard(s: AppState, t: Extract<Target, { kind: "land" }>, cx: CardContext): Raw {
  const map = cx.map;
  const cc = map.countries[map.tiles[t.tile * 3 + 2]!] ?? "";
  const k = s.profile.prefs.comfort;
  const highs = tileHighs(map, t.tile);
  const inRange = monthsInRange(map, t.tile, k.min, k.max);
  const country = cc ? countryName(s.data, cc) : "No country code";
  const people = s.profile.household.filter((p) => p.citizenships.length > 0);
  const pl = t.place;
  const rights = people.length && cc
    ? (() => {
        const yes = people.filter((p) => rightToLiveWork(s.data, p, cc).allowed).length;
        const of = people.length;
        return html`<li><span class="mc-k">Right to live</span> <span>${yes === of ? (of === 1 ? "you can live and work here" : "all of you can live and work here") : yes === 0 ? "a visa for everyone" : `${yes} of ${of} of you without a visa`}</span></li>`;
      })()
    : "";
  // By GeoNames id where Natural Earth gives one: a name alone can find a namesake (Iraklio is also an Athens suburb).
  const q = pl ? (pl[5] ? `geonames:${pl[5]}` : `${pl[0]}, ${pl[1]}`) : "";
  const actions = cx.pinned
    ? pl
      ? html`<div class="mc-act"><button class="ink-btn" data-act="map-add-place" data-q="${q}" data-name="${pl[0]}">Add to my cities</button></div>`
      : html`<p class="mc-note">No town of 50,000 people near here. Zoom in, or type a place in Add any city.</p>`
    : html`<p class="mc-hint">${pl ? "Click to pin, then add it" : "Zoom in to pick a town"}</p>`;
  const meta = pl ? html`${regionName(pl[1])}${pl[4] >= 1000 ? html` · ${pl[4] >= 1e6 ? `${num(pl[4] / 1e6, 1)} million` : num(Math.round(pl[4] / 1000) * 1000)} people` : ""}` : "land";
  return html`${head(pl ? pl[0] : country, meta, cx.pinned)}
    <p class="mc-line"><span class="mc-k">In your range</span> <b>${months(inRange)}</b> of 12 with afternoon highs of ${rangeText(s)} (air)</p>
    <div class="mc-highs" role="img" aria-label="Average afternoon high by month: ${highs.map((h) => tempValue(h)).join(", ")} ${tempUnit()}">${highs.map(
      (h, i) => html`<span class="b${bandOf(h, k)} ${highInRange(h, k.min, k.max) ? "is-in" : ""}"><b>${tempValue(h)}°</b><i>${MONTHS[i]}</i></span>`,
    )}</div>
    <p class="mc-note">Air temperature, averaged over this tile's ground (about ${distance(150)}), 2001–2025.</p>
    ${pl ? takeHome(moneyOf(s.data, s.profile, townCity(pl))) : ""}
    ${rights ? html`<ul class="mc-figs">${rights}</ul>` : ""}
    ${pl && cx.pinned ? html`<p class="mc-note">Its score and rank come once it is added: its figures are fetched from the open sources, as with Add any city.</p>` : ""}
    ${actions}`;
}

/** The card's markup for a place: read-only while pointed at, with "Add to my cities" once pinned. */
export function cardFor(s: AppState, t: Target, cx: CardContext): Raw {
  return t.kind === "city" ? cityCard(s, t.id, cx) : landCard(s, t, cx);
}
