import type { CityResult, Evaluation } from "../core/engine.ts";
import { moneyGap } from "../core/criteria.ts";
import { convert } from "../core/money.ts";
import type { RightResult } from "../core/rights.ts";
import { shortestDay } from "../core/sun.ts";
import { climateOf, hourCanvas, niceStrip, niceTotal, warmCold } from "./climate.ts";
import { html, type Raw } from "./dom.ts";
import { countryName, hours, money, num, tempUnit, tempValue } from "./format.ts";
import { failText, glanceScale, winsLosses } from "./glance.ts";
import { partialNote } from "./partial.ts";
import { mapShell } from "./map.ts";
import { breakEvenLine, emptyState, missingText, moneyAdds } from "./results.ts";
import type { AppState } from "./state.ts";
import { problemsFor } from "./top.ts";
import { term, TERMS } from "./terms.ts";

// The Cities view: one dossier sheet per city, best first. A sheet says who it is (rank, score, name),
// why it sits there (where it wins and loses), how the year feels, and what you keep each month.

/** The nice-day range as a button, on the nice-days line itself: the one place it is edited. */
export function rangeButton(s: AppState, where: string): Raw {
  const { min, max, basis } = s.profile.prefs.comfort;
  return html`<button class="range" data-act="comfort" data-where="${where}" aria-haspopup="dialog" title="Change your nice-day range">${tempValue(min)}–${tempValue(max)}°${basis === "air" ? " air" : " feels"}</button>`;
}

/** Feels-like or air: which temperature the range is about. */
export function basisSeg(s: AppState): Raw {
  const b = s.profile.prefs.comfort.basis ?? "feels";
  return html`<span class="seg seg-sm" role="radiogroup" aria-label="Which temperature your range is on"><button role="radio" aria-checked="${b === "air"}" data-act="comfort-basis" data-basis="air" id="basis-air" title="${TERMS.air}">Air</button><button role="radio" aria-checked="${b === "feels"}" data-act="comfort-basis" data-basis="feels" id="basis-feels" title="${TERMS.feels}">Feels like</button></span>`;
}

/** The two ends of the nice-day range as steppers, in the person's unit; a step is one degree Celsius. */
export function comfortStep(f: "min" | "max", v: number, label: string, prefix: string): Raw {
  return html`<span class="stepper">
      <button data-act="comfort-step" data-field="${f}" data-d="-1" aria-label="${label} colder" id="${prefix}-${f}-dn">−</button>
      <input type="number" value="${tempValue(v)}" data-field="comfort-${f}" aria-label="${label}, ${tempUnit()}" id="${prefix}-${f}">
      <button data-act="comfort-step" data-field="${f}" data-d="1" aria-label="${label} warmer" id="${prefix}-${f}-up">+</button></span>`;
}

export function comfortEditor(s: AppState): string {
  const { min, max } = s.profile.prefs.comfort;
  return html`<div class="pop-body comfort-ed"><b>Your nice days</b>
    <p class="hint">Nice days are yours to define. A ${term("comfortable", "nice day")} is dry and mostly clear, and from 8 am to 8 pm it feels the way you like:</p>
    <p class="cl-line">${comfortStep("min", min, "Coolest nice daytime temperature", "cs")} to ${comfortStep("max", max, "Warmest nice daytime temperature", "cs")} ${tempUnit()}</p>
    <div class="ce-row">${basisSeg(s)}</div>
    <p class="hint">Every sheet, strip and rank follows. In a city's dossier you can also drag the band on its chart.</p></div>`.value;
}

/** Why there is no take-home figure, when the reason is ours (no tax model, no exchange rate), not a missing input. */
const noModel = (missing: string[]) => {
  const why = missing.find((x) => x.startsWith("a tax model for ") || x.startsWith("an exchange rate for "));
  return why ? `: no ${why.slice(why.indexOf(" ") + 1)} yet` : "";
};

/** The money stub: what you keep, or what blocks it, said as the input that would give it. */
function stub(s: AppState, r: CityResult): Raw {
  const m = r.money;
  const shown = m.display.currency;
  const toShown = (v: number) => convert(s.data, v, m.localCurrency, shown) ?? v;
  const home = !s.profile.income.everyday?.assumed && s.profile.income.everyday?.homeCity === r.city.id;
  const rentMissing = m.missing.includes("rent");
  const noSalary = m.missing.includes("salary");
  const ours = m.missing.find((x) => x.startsWith("a tax model for ") || x.startsWith("an exchange rate for "));
  // A partial figure leaves out something due, so it is an upper bound: said as "at most", with what it lacks.
  const partial = m.display.monthlyLeft !== null && moneyGap(m) !== null;
  const amount = ours
    ? html`<span class="a-miss">${missingText({ ...m, missing: [ours] })}</span>`
    : noSalary
      ? html`<button class="a-miss a-ask" data-act="focus" data-target="verdict-salary">Needs your salary</button>`
      : m.display.monthlyLeft !== null
        ? html`<span class="a num">${partial ? html`<small>at most </small>` : ""}${money(m.display.monthlyLeft, shown)}<small> a month</small></span>`
        : rentMissing
          ? html`<label class="rent-in"><span class="sr">Your rent in ${r.city.name}, a month</span><input type="number" inputmode="numeric" min="0" step="10" placeholder="Your rent" data-rent-city="${r.city.id}" id="rent-${r.city.id}"></label>${problemsFor(s, `overrides.${r.city.id}.rent_`)}`
          : html`<span class="a-miss">${missingText(m)}</span>`;
  const parts = [
    m.net !== null ? html`${term("net", "Take-home")} ${money(toShown(m.net / 12), shown)}` : noSalary ? html`take-home: add your salary` : html`take-home not known${noModel(m.missing)}`,
    m.rent ? html` − rent ${money(toShown(m.rent.monthly), shown)}${home ? " (yours)" : ""}` : html` − rent ?`,
    m.everyday ? html` − everyday ${money(toShown(m.everyday.monthly), shown)}` : "",
    m.childcare ? html` − childcare ${money(toShown(m.childcare.monthly), shown)}` : "",
    m.health ? html` − health ${money(toShown(m.health.monthly), shown)}` : "",
  ];
  const own = s.profile.income.mode === "per-city" ? s.profile.income.perCity[r.city.id] : undefined;
  const pay = html`<span class="br-pay"><label class="check tick"><input type="checkbox" data-act="pay-here" data-city="${r.city.id}" id="pay-here-${r.city.id}" ${own ? "checked" : ""}> Your pay differs here</label>${own
    ? html`<label class="pay-in"><span class="sr">Your gross pay a year in ${r.city.name}, ${own.currency}</span><input type="number" inputmode="numeric" min="0" step="1000" value="${own.gross}" data-gross-city="${r.city.id}" data-earner="0" id="g-0-${r.city.id}-card"><span class="quiet">${own.currency} a year</span></label>`
    : ""}${breakEvenLine(s, r, { short: true })}</span>`;
  const regime = m.regime
    ? html`<span class="br-reg">${term("regime", m.regime.name.split(",")[0]!)} ${m.regime.status === "scenario" ? html`counted <b>as a scenario</b>: some conditions are yours to confirm in Money` : "counted"}, up to ${m.regime.years} years</span>`
    : "";
  const c = m.completeness;
  const status = c.status === "partial" && c.missing.length
    ? html`<span class="br-cmp">${partial ? "Leaves out" : "Also leaves out"} ${moneyAdds(s, r)}</span>`
    : c.status === "approximate" && m.net !== null
      ? html`<span class="br-cmp is-approx" title="${c.approximations.join(" ")}">Approximate: ${c.approximations[0] ?? ""}</span>`
      : "";
  return html`<div class="tear" aria-hidden="true"></div>
    <div class="stub"><span class="k">${term("kept", "You keep")}</span>${amount}
      <a class="go" href="#/city/${r.city.id}">Open dossier</a>
      <span class="br">${parts}${status}${regime}</span>${pay}</div>`;
}

const RIGHT_WORD: Record<RightResult["status"], string> = { yes: "yes", no: "needs a visa or permit", unknown: "not checked" };
/** The word after a person's name: "You need", "Partner needs". */
const rightWord = (person: string, status: RightResult["status"]) => (status === "no" && person === "You" ? "need a visa or permit" : RIGHT_WORD[status]);

/** Who can move there, person by person: yes (and how), needs a visa or permit, or not checked. Never "needs a visa" without a passport. */
function eligibilityCell(s: AppState, r: CityResult): Raw {
  const must = s.profile.dealBreakers.includes("right_to_live");
  const rows = r.rights.length
    ? r.rights.map(
        (x) => html`<li class="el-${x.status} ${x.status === "no" && must ? "fail" : ""}" title="${x.text}"><b>${x.person}</b> <span>${rightWord(x.person, x.status)}${x.status === "yes" ? html`<span class="quiet">, ${x.via === "citizen" ? "citizen" : x.via}</span>` : ""}</span>${x.status === "unknown" ? html` <button class="link" data-act="focus" data-target="e${Math.max(0, s.profile.household.findIndex((h) => h.label === x.person))}-pass">add passport</button>` : ""}</li>`,
      )
    : [html`<li class="el-unknown"><b>You</b> <span>not checked</span> <button class="link" data-act="focus" data-target="e0-pass">add your passport</button></li>`];
  return html`<div class="cell c-elig"><div class="lab">Can move there</div><ul class="el-list">${rows}</ul></div>`;
}

function sheet(s: AppState, r: CityResult, e: Evaluation, scale: number): Raw {
  const out = r.ruledOut.length > 0;
  const home = !s.profile.income.everyday?.assumed && s.profile.income.everyday?.homeCity === r.city.id;
  const c = climateOf(s, r.city);
  const n = niceTotal(c);
  const wc = c ? warmCold(c) : null;
  const passing = e.results.filter((x) => !x.ruledOut.length).length;
  const unknown = !out && r.unresolved.length > 0;
  const ident = html`<div class="d-id">
      <p class="bib num">${Math.round(r.total)}<small>/ 100</small></p>
      <h3 class="dname" id="dn-${r.city.id}"><a href="#/city/${r.city.id}">${r.city.name}</a></h3>
      <p class="dmeta"><b class="rankw">${out ? "Ruled out" : `No. ${r.rank} of ${passing}`}</b> · ${countryName(s.data, r.city.country)}${home ? html` · <b>you live here</b>` : ""}${s.fetchedHere.includes(r.city.id) ? html` · <span class="quiet">fetched in this browser</span>` : ""}</p>
      ${out
        ? html`<span class="stamp">Ruled out: ${failText(r.ruledOut, r.lines)}</span>`
        : unknown
          ? html`<p class="unknown-note"><b>Not known yet:</b> ${r.unresolved.map((l) => l.toLowerCase()).join(", ")}, which you marked must pass. It ranks after every city that passes.</p>`
          : ""}
      ${out ? "" : partialNote(s, r)}
    </div>`;
  const metaSrc = c?.source.origin.kind === "source" ? c.source.origin.observation.period : null;
  return html`<article class="sheet dos ${out ? "is-out" : ""} ${r.rank === 1 && !out && !unknown ? "is-lead" : ""}" data-flip="${r.city.id}" aria-labelledby="dn-${r.city.id}">
    <div class="band" aria-hidden="true"><i style="width:${r.total.toFixed(1)}%"></i></div>
    <div class="d-head">${ident}${winsLosses(r, e, scale, s.profile.dealBreakers)}</div>
    <div class="cells cells-2">
      <div class="cell c-comfort"><div class="lab"><span>${term("comfortable", "Nice days")} ${rangeButton(s, r.city.id)}</span>${n === null ? "" : html`<b class="num">${n}<small> a year</small></b>`}</div>
        ${c ? niceStrip(c, r.city.name, s.profile.prefs.comfort) : html`<p class="nice-none">No climate figures for ${r.city.name} yet.</p>`}
        ${c ? html`<p class="attr">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> · ${term("era5", "ERA5")}${metaSrc ? ` ${metaSrc.replace("-", "–")}` : ""}</p>` : ""}</div>
      ${eligibilityCell(s, r)}
    </div>
    <details class="d-more"><summary>Daylight, sunshine and every hour of the year<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg></summary>
      <div class="cells cells-2b">
        <div class="cell"><div class="lab">${term("daylight", "Winter daylight")}</div><div class="val num">${hours(shortestDay(r.city.lat))}</div></div>
        <div class="cell"><div class="lab">${term("sunshine", "Sun a year")}</div><div class="val num">${c?.sunYear ? html`${num(c.sunYear)}<small> h</small>` : html`<span class="quiet" title="No sunshine recorder near the city that we can use yet">–</span>`}</div></div>
      </div>
      ${c?.hourly
        ? html`<div class="yr"><div class="lab"><span>${term("hourly", "Every hour of the year")}</span><span class="num">${wc!.warm} · ${wc!.cold}</span></div>${hourCanvas(r.city.id, "strip", `${r.city.name}: temperature at every hour of the year, in your bands`)}<div class="yr-ax" aria-hidden="true"><span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span></div></div>`
        : ""}
    </details>
    ${stub(s, r)}
  </article>`;
}

/** Explore more places: the world map under the first results. Drawn when it scrolls into view (`mounted`). */
export function exploreShell(s: AppState, mounted: boolean): Raw {
  return html`<h2 class="explore-h" id="explore-h">Explore more places</h2>
    <p class="explore-lede">Every city in the data, and any town on the map, coloured by what matters to you. Point at one to see where it would rank among yours; click to open its card, and add it from there.</p>
    ${mounted ? mapShell(s) : html`<div class="sheet explore-wait"><p class="quiet">The map loads as you reach it. <a href="#/map">Open it on its own page</a>.</p></div>`}`;
}

export function citiesView(s: AppState, e: Evaluation): Raw {
  if (e.results.length === 0) return emptyState();
  const scale = glanceScale(e);
  const k = s.profile.prefs.comfort;
  const waiting = e.results.some((r) => climateOf(s, r.city) && !climateOf(s, r.city)!.nice);
  const feels = (k.basis ?? "feels") === "feels";
  const lead = html`${waiting ? html`<p class="wall-key">Nice-day counts arrive with the next climate update. Until then each sheet's strip shows the usual ${feels ? "feels-like " : ""}afternoon high of each month against your ${tempValue(k.min)}–${tempValue(k.max)}° range: <i class="kx in">filled</i> in range, <i class="kx above">mark on top</i> warmer, <i class="kx below">mark below</i> cooler.</p>` : ""}`;
  return html`${lead}<section class="wall" aria-label="Your cities, best first">${e.results.map((r) => sheet(s, r, e, scale))}</section>
    <p class="key">Wins and losses are in points of the 100-point score, against the average of your other cities. A line with no figure for a city scores as the lowest of your other cities on it, and never shows here. Temperature bands follow your comfortable range.</p>`;
}
