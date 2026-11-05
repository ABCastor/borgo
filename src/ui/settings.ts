import { DATE_STYLES, NUMBER_STYLES, unitsOf } from "../core/units.ts";
import { html, type Raw } from "./dom.ts";
import { CURRENCIES } from "./format.ts";
import type { AppState } from "./state.ts";

// Settings: how figures are written. Small on purpose: units, money's currency, numbers and dates. They live in the
// profile, so the share link carries them, and every figure in the app follows.

function seg(name: string, label: string, value: string, options: [string, string][]): Raw {
  return html`<div class="set-row"><span class="set-k" id="set-${name}">${label}</span>
    <span class="seg seg-sm" role="radiogroup" aria-labelledby="set-${name}">${options.map(([v, l]) => html`<button type="button" role="radio" aria-checked="${v === value}" data-act="set-unit" data-unit="${name}" data-v="${v}" id="set-${name}-${v.replace(/[^a-z0-9]/gi, "")}">${l}</button>`)}</span></div>`;
}

export function settingsPanel(s: AppState): string {
  const u = unitsOf(s.profile.prefs.units);
  return html`<div class="pop-body settings"><b id="settings-title">Settings</b>
    ${seg("temp", "Temperature", u.temp, [["C", "°C"], ["F", "°F"]])}
    ${seg("distance", "Distance", u.distance, [["km", "km"], ["mi", "miles"]])}
    <label class="set-row"><span class="set-k">Money in</span><select id="set-currency" data-field="display-currency" aria-label="Show money in">${CURRENCIES.map((c) => html`<option ${c === s.profile.displayCurrency ? "selected" : ""}>${c}</option>`)}</select></label>
    <label class="set-row"><span class="set-k">Numbers</span><select id="set-numbers" data-unit-select="numbers">${NUMBER_STYLES.map((v) => html`<option value="${v}" ${v === u.numbers ? "selected" : ""}>${v}</option>`)}</select></label>
    <label class="set-row"><span class="set-k">Dates</span><select id="set-dates" data-unit-select="dates">${DATE_STYLES.map((v) => html`<option value="${v}" ${v === u.dates ? "selected" : ""}>${v}</option>`)}</select></label>
    <p class="hint">Saved with your comparison and carried by its share link.</p>
  </div>`.value;
}
