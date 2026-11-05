import type { CityResult, Evaluation, LineResult } from "../core/engine.ts";
import { criterionById } from "../core/criteria.ts";
import { CHILDCARE_AGES, convert, describeMissing, paidChildcare } from "../core/money.ts";
import type { HouseholdLine } from "../tax/household.ts";
import { taxModelFor } from "../tax/index.ts";
import { eligibleRegimes, NO_WAGE_REGIME, regimesFor, withRegime } from "../tax/regimes.ts";
import { PENSION_RELIEF } from "../tax/pension.ts";
import { moneyGap } from "../core/criteria.ts";
import type { Resolved } from "../core/lookup.ts";
import { html, raw, type Raw } from "./dom.ts";
import { term } from "./terms.ts";
import { countryName, money, num } from "./format.ts";
import type { AppState } from "./state.ts";

/** The drawn close mark, one stroke weight everywhere. */
export const CLOSE = raw('<svg viewBox="0 0 10 10" aria-hidden="true" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke-linecap="round"/></svg>');

export const SOURCE_SHORT: Record<string, string> = {
  geonames: "GeoNames",
  "ecb-fx": "ECB",
  "open-meteo-era5": "ERA5",
  "worldbank-wdi": "World Bank",
  "who-aqdb": "WHO",
  "ons-pipr": "ONS",
  "cso-rtb": "RTB",
  openalex: "OpenAlex",
  "oecd-wellbeing": "OECD",
  "open-meteo-cams": "CAMS",
  "wmo-normals": "WMO",
  meteostat: "Meteostat",
  ror: "ROR",
  osm: "OSM",
  "eurostat-urban": "Eurostat",
  acs: "US Census",
  cldr: "CLDR",
  mlab: "M-Lab",
  foundersrc: "Founders RC",
  ourairports: "OurAirports",
  "natural-earth": "Natural Earth",
  "terrain-tiles": "Terrain Tiles",
  "couples-law": "Statutes",
  "abortion-law": "Statutes",
  politics: "Election",
  "worldbank-wgi": "World Bank",
  "oecd-childcare": "OECD",
  "oecd-family-db": "OECD",
  "labour-law": "Statutes",
  "nager-date": "Nager.Date",
  github: "GitHub",
  "ghsl-ucdb": "GHSL",
  "osm-walk-cycle": "OSM",
  "eurostat-regions": "Eurostat",
  numbeo: "Numbeo",
};

/** A tiny teal marker naming where a figure came from; terracotta "yours" when the person set it. */
export function srcMark(r: Resolved | null | undefined, city: string, metric?: string, compact = false): Raw {
  if (!r) return html``;
  if (r.origin.kind === "you") return html`<span class="yours">yours</span>`;
  const o = r.origin.observation;
  if (r.origin.kind === "consensus") {
    const n = r.origin.observations.length;
    return html`<button class="src" data-act="source" data-city="${city}" data-metric="${metric ?? o.metric}" title="Median of ${n} sources">${n} sources<span class="src-yr">${o.period.slice(0, 4)}</span></button>`;
  }
  const country = r.level === "country" ? " · national figure" : r.level === "region" ? " · region" : "";
  const when = o.period.includes("-") && o.period.length === 9 ? o.period : o.period.slice(0, 4);
  return html`<button class="src" data-act="source" data-city="${city}" data-metric="${metric ?? o.metric}" title="${SOURCE_SHORT[o.source] ?? o.source}, ${o.period}${country}">${SOURCE_SHORT[o.source] ?? o.source}${compact ? "" : html`<span class="src-yr">${when}</span>`}${!compact && r.level === "country" ? html`<span class="src-lv">national</span>` : ""}</button>`;
}

export const missingText = (m: CityResult["money"]) => describeMissing(m.missing);

export function emptyState(): Raw {
  return html`<div class="empty"><h2>Pick a few cities</h2><p>Add the places you are weighing above. Everything here is computed in your browser from open, sourced data, and weighted by what you say matters.</p></div>`;
}

export function cell(s: AppState, r: CityResult, l: LineResult): Raw {
  const crit = criterionById(l.id);
  if (l.personal) {
    const line = s.profile.personal.find((p) => p.id === l.id)!;
    const v = line.scores[r.city.id];
    return html`<div class="likert" role="radiogroup" aria-label="${l.label} in ${r.city.name}">${[1, 2, 3, 4, 5].map(
      (n) => html`<button role="radio" aria-checked="${v === n}" class="${v === n ? "is-on" : ""}" data-act="score" data-line="${l.id}" data-city="${r.city.id}" data-v="${n}">${n}</button>`,
    )}</div>`;
  }
  const src = l.raw.sources[0];
  const dotClass = src?.origin.kind === "you" ? "is-yours" : l.imputed ? "is-imputed" : "";
  return html`<div class="cmp-val ${l.score === null ? "is-missing" : ""}">
      <span class="v">${crit?.metric ? html`<button class="edit" data-act="edit" data-city="${r.city.id}" data-metric="${crit.metric}" title="Use your own number">${l.raw.text}</button>` : l.raw.text}${crit?.metric ? srcMark(src, r.city.id, crit.metric) : ""}</span>
      ${l.score !== null ? html`<span class="scale" title="${l.imputed ? "No figure: scored as the lowest of your other cities" : ""}"><i style="left:${(l.score * 100).toFixed(1)}%" class="${dotClass}"></i></span>` : ""}
    </div>`;
}

export function compareView(s: AppState, e: Evaluation): Raw {
  if (e.results.length === 0) return emptyState();
  const results = e.results;
  const hasData = (id: string) => results.some((r) => r.lines.find((l) => l.id === id)!.raw.value !== null);
  const all = results[0]!.lines.slice().sort((a, b) => b.weight - a.weight);
  const lines = all.filter((l) => l.personal || hasData(l.id));
  const empty = all.filter((l) => !l.personal && !hasData(l.id));
  const best = (id: string) => {
    const scores = results.map((r) => r.lines.find((l) => l.id === id)!.score).filter((v): v is number => v !== null);
    return scores.length > 1 ? Math.max(...scores) : null;
  };
  const rentMetric = `rent_${s.profile.housing.size}`;
  const wsum = all.reduce((t, l) => t + l.weight, 0) || 1;
  return html`<div class="sheet cmp-sheet"><div class="cmp-wrap"><table class="cmp">
    <thead><tr><th class="cmp-corner" scope="col"><span class="quiet">Ranked by your values</span></th>
      ${results.map(
        (r) => html`<th scope="col" class="${r.ruledOut.length ? "is-out" : ""}"><button class="cmp-city" data-act="open-city" data-city="${r.city.id}">
          <b><span class="cmp-rank num">${r.ruledOut.length ? "Out" : r.rank}</span> ${r.city.name}</b><small>${countryName(s.data, r.city.country)}${r.ruledOut.length ? html` · <span class="fail">ruled out</span>` : ""}</small>
          <span class="cmp-score num">${Math.round(r.total)}<small>/100</small></span><span class="cmp-meter"><i style="width:${r.total.toFixed(1)}%"></i></span>
          <span class="cmp-keep" title="${r.money.display.monthlyLeft === null ? missingText(r.money) : ""}">${r.money.display.monthlyLeft === null ? html`<span class="quiet">keep: not yet known</span>` : html`keep <b class="num">${money(r.money.display.monthlyLeft, r.money.display.currency)}</b> a month`}</span>
        </button></th>`,
      )}</tr></thead>
    <tbody>
      <tr class="cmp-info"><th scope="row">Net pay a month<small>your salary after tax</small></th>${results.map(
        (r) => html`<td><div class="cmp-val ${r.money.display.net === null ? "is-missing" : ""}"><span class="v num">${r.money.display.net === null ? describeMissing(r.money.missing.filter((x) => x.startsWith("a tax") || x === "salary")) : money(r.money.display.net / 12, r.money.display.currency)}</span></div></td>`,
      )}</tr>
      <tr class="cmp-info"><th scope="row">Rent, ${s.profile.housing.size === "1bed" ? "one bedroom" : "three bedrooms"}<small>a month, local currency</small></th>${results.map((r) => {
        const rr = r.money.rent;
        return html`<td><div class="cmp-val ${rr ? "" : "is-missing"}"><span class="v"><button class="edit" data-act="edit" data-city="${r.city.id}" data-metric="${rentMetric}" title="Use your own rent">${rr ? money(rr.monthly, r.money.localCurrency) : "add yours"}</button>${rr ? srcMark(rr.resolved, r.city.id, rentMetric) : ""}</span></div></td>`;
      })}</tr>
      ${lines.map((l) => {
        const b = best(l.id);
        return html`<tr class="${l.weight === 0 ? "is-off" : ""}"><th scope="row">${l.label}<small>${l.personal ? "your line · " : ""}${Math.round((100 * l.weight) / wsum)}% of the score${s.profile.dealBreakers.includes(l.id) ? " · must pass" : ""}</small></th>
          ${results.map((r) => {
            const rl = r.lines.find((x) => x.id === l.id)!;
            return html`<td class="${b !== null && rl.score === b ? "is-best" : ""} ${rl.failed && s.profile.dealBreakers.includes(l.id) ? "is-fail" : ""}">${cell(s, r, rl)}</td>`;
          })}</tr>`;
      })}
    </tbody></table></div></div>
    ${empty.length ? html`<p class="hint">No open data yet for your cities on: ${empty.map((l) => l.label.toLowerCase()).join(", ")}. Those lines do not affect the ranking.</p>` : ""}`;
}

/** Gross to kept, line by line, in the display currency; every tax and payroll line opens under its total. */
export function waterfall(s: AppState, r: CityResult): Raw {
  const m = r.money;
  const shown = s.profile.displayCurrency;
  const toShown = (v: number) => convert(s.data, v, m.localCurrency, shown) ?? v;
  const open = s.taxOpen.includes(r.city.id);
  const lines: HouseholdLine[] = m.tax?.lines ?? [];
  const taxes = lines.filter((l) => !l.saving).reduce((a, l) => a + l.amount, 0);
  type Row = { label: Raw | string; v: number; kind: "in" | "out" | "sum" | "line" | "save"; note?: Raw };
  const rows: Row[] = [];
  if (m.gross !== null) rows.push({ label: m.earners.length > 1 ? "Gross pay, everyone" : "Gross pay", v: toShown(m.gross / 12), kind: "in" });
  if (m.tax) {
    rows.push({
      label: html`<button class="wf-open" data-act="tax-lines" data-city="${r.city.id}" aria-expanded="${open}">Tax and contributions<span class="quiet"> · ${lines.filter((l) => !l.saving).length} lines, ${open ? "close" : "open"}</span></button>`,
      v: -toShown(taxes / 12),
      kind: "out",
    });
    if (open) for (const l of lines.filter((x) => !x.saving)) rows.push({ label: l.label, v: -toShown(l.amount / 12), kind: "line" });
  }
  if (m.pension > 0) rows.push({ label: term("pension", "Into pensions"), v: -toShown(m.pension / 12), kind: "save", note: html`<span class="quiet">still yours, not spent; ${pensionPlan(r.city.country, countryName(s.data, r.city.country))}</span>` });
  if (m.net !== null) rows.push({ label: "Take-home pay", v: toShown(m.net / 12), kind: "sum" });
  if (m.rent) rows.push({ label: s.profile.housing.size === "1bed" ? "Rent, one bedroom" : "Rent, three bedrooms", v: -toShown(m.rent.monthly), kind: "out", note: srcMark(m.rent.resolved, r.city.id, `rent_${s.profile.housing.size}`) });
  if (m.everyday) rows.push({ label: "Everything else", v: -toShown(m.everyday.monthly), kind: "out", note: html`<span class="quiet">${m.everyday.how}</span>` });
  // Beside the childcare line: whether the household pays for care at all, and its own cost in place of the reference.
  const young = (s.profile.children ?? []).some((a) => a >= CHILDCARE_AGES.from && a < CHILDCARE_AGES.below);
  const paid = paidChildcare(s.profile);
  const careToggle = young ? html`<label class="cc-paid"><input type="checkbox" data-act-change="paid-childcare" ${paid ? "checked" : ""}> Paid childcare</label>` : "";
  if (m.childcare) rows.push({ label: html`${term("childcare", "Childcare")} ${careToggle}`, v: -toShown(m.childcare.monthly), kind: "out", note: html`<span class="quiet">${m.childcare.how}</span> ${srcMark(m.childcare.resolved[0], r.city.id)} ${childcareButton(s, r, m.childcare.how === "your own childcare cost" ? "change your cost" : "use your own cost a month")}` });
  else if (young && !paid) rows.push({ label: html`${term("childcare", "Childcare")} ${careToggle}`, v: 0, kind: "out", note: html`<span class="quiet">no paid childcare: none counted</span>` });
  if (m.health) rows.push({ label: term("health", "Health"), v: -toShown(m.health.monthly), kind: "out", note: html`<span class="quiet">${m.health.how}</span> ${srcMark(m.health.resolved[0], r.city.id)}` });
  if (m.monthlyLeft !== null) rows.push({ label: "You keep", v: toShown(m.monthlyLeft), kind: "sum" });
  const scale = Math.max(1, ...rows.filter((x) => x.kind !== "line").map((x) => Math.abs(x.v)));
  return html`<table class="wf">${rows.map(
    (x) => html`<tr class="wf-${x.kind}">${x.kind === "line" ? html`<th scope="row" colspan="2">${x.label}</th>` : html`<th scope="row">${x.label}${x.note ? html`<small>${x.note}</small>` : ""}</th><td class="wf-bar"><i style="width:${((Math.abs(x.v) / scale) * 100).toFixed(1)}%"></i></td>`}<td class="num">${money(x.v, shown, { signed: x.kind === "out" || x.kind === "line" || x.kind === "save" })}</td></tr>`,
  )}</table>
  ${m.missing.length ? html`<p class="missing">The total waits for ${m.missing.map((x, k) => html`${k ? (k === m.missing.length - 1 ? " and " : ", ") : ""}${missingAction(s, r, x)}`)}.</p>` : ""}
  ${completenessLine(s, r)}
  ${m.gaps.length ? html`<p class="gaps">${m.gaps.map((g) => (/: add yours$/.test(g) ? html`${g.replace(/: add yours$/, "")}: <button class="link" data-act="edit" data-city="${r.city.id}" data-metric="health_premium">add yours</button>. ` : /: add your own$/.test(g) ? html`${g.replace(/: add your own$/, "")}: ${childcareButton(s, r, "add your own")}. ` : html`${g}. `))}</p>` : ""}
  ${m.runwayMonths !== null ? html`<p class="runway">Your savings cover <b class="num">${num(m.runwayMonths, 0)} months</b> of expenses here with no income.</p>` : ""}`;
}

/** The pension share's plan and relief in this country, or that none is modelled: the share is then saving without relief. */
export function pensionPlan(country: string, name: string): string {
  const rule = PENSION_RELIEF[country];
  if (!rule || rule.kind === "not-modelled") return `${name}'s pension relief is not modelled: counted as saving, with no tax relief`;
  if (rule.kind === "none") return `${name} gives employees no tax relief on it`;
  return `as a ${rule.plan}, ${rule.kind === "deduction" ? "taken off income tax up to its limit" : "with its tax credit"}`;
}

/** The button that sets what the household pays for childcare here, a month, in place of the OECD reference figure. */
function childcareButton(_s: AppState, r: CityResult, label: string): Raw {
  return html`<button class="link" data-act="edit" data-city="${r.city.id}" data-metric="childcare_cost">${label}</button>`;
}

/** What a partial money figure leaves out, each with the input that fills it: "childcare for 1 child under 6: add your cost". */
export function moneyAdds(s: AppState, r: CityResult): Raw {
  const items = r.money.completeness.missing;
  return html`${items.map((x, i) => {
    const sep = i ? (i === items.length - 1 ? " and " : ", ") : "";
    if (x.startsWith("childcare")) return html`${sep}${x.replace(/ \(.*\)$/, "")}: ${childcareButton(s, r, "add your cost a month")}`;
    if (x.startsWith("health insurance premium")) return html`${sep}${x.replace(/ \(.*\)$/, "")}: <button class="link" data-act="edit" data-city="${r.city.id}" data-metric="health_premium">add yours a month</button>`;
    return html`${sep}${x}`;
  })}`;
}

/** How whole the money figure is: approximate (with its stand-ins), partial (what it leaves out), or a scenario regime. */
function completenessLine(s: AppState, r: CityResult): Raw {
  const m = r.money;
  const c = m.completeness;
  if (c.status === "complete") return html``;
  if (c.status === "approximate") return html`<p class="cmpl is-approx"><b>Approximate.</b> ${c.approximations.join(" ")}</p>`;
  if (moneyGap(m) && m.monthlyLeft !== null) return html`<p class="cmpl"><b>At most this:</b> the figure leaves out ${moneyAdds(s, r)}, so it is not scored until you add ${c.missing.length > 1 ? "them" : "it"}.</p>`;
  return html``;
}

/** One missing input, as the button that adds it where the figure is the person's to give. */
function missingAction(s: AppState, r: CityResult, x: string): Raw {
  const couple = s.profile.household.slice(1).some((p) => p.relation === "partner" || p.spouse);
  const young = Math.min(2, (s.profile.children ?? []).filter((a) => a < 6).length);
  if (x === "rent") return html`<button class="link" data-act="edit" data-city="${r.city.id}" data-metric="rent_${s.profile.housing.size}">your rent</button>`;
  if (x === "childcare") return html`<button class="link" data-act="edit" data-city="${r.city.id}" data-metric="childcare_cost">your childcare cost a month</button> (no open figure for ${countryName(s.data, r.city.country)})`;
  return html`${describeMissing([x]).replace(/^./, (c) => c.toLowerCase())}`;
}

/** The pay you would need here to keep what you keep where you live now: a verdict, so olive. */
export function breakEvenLine(s: AppState, r: CityResult, o: { short?: boolean } = {}): Raw {
  const homeId = s.profile.income.everyday?.assumed ? null : (s.profile.income.everyday?.homeCity ?? null);
  if (!homeId) return html``;
  const home = s.data.cities.find((c) => c.id === homeId);
  if (r.city.id === homeId) return o.short ? html`` : html`<p class="be">You live here now: every other city's ${term("breakeven", "break-even pay")} is measured against what you keep here.</p>`;
  const be = r.breakEven;
  const local = r.money.localCurrency;
  if (!be) return o.short ? html`` : html`<p class="be is-none">${term("breakeven", "Break-even pay")}: not yet known. It needs what you keep in ${home?.name ?? "your city"} and every cost here.</p>`;
  const vs = be.current ? Math.round(((be.gross - be.current) / be.current) * 100) : null;
  if (o.short) return html`<span class="br-be">${term("breakeven", "Break-even")} <b class="num">${money(be.gross, local, { compact: true })}</b> a year</span>`;
  return html`<p class="be">To keep what you keep in ${home?.name ?? "your city"} (${money(be.target, s.profile.displayCurrency)} a month), you would need <b class="num">${money(be.gross, local)}</b> a year here${be.shown !== null && local !== s.profile.displayCurrency ? ` (${money(be.shown, s.profile.displayCurrency)})` : ""}${vs !== null ? html`: <b class="num">${vs > 0 ? "+" : vs < 0 ? "−" : ""}${Math.abs(vs)}%</b> on your pay here` : ""}.</p>`;
}

/** Paid days off by law and parental leave, with what the days are worth at your pay. */
export function leaveLine(s: AppState, r: CityResult): Raw {
  const l = r.money.leave;
  if (l.holiday === null && l.publicHolidays === null && l.mothers === null) return html``;
  const src = (metric: string) => srcMark(l.resolved.find((x) => x.origin.kind !== "you" && (x.origin as { observation: { metric: string } }).observation.metric === metric), r.city.id, metric, true);
  const days = (l.holiday ?? 0) + (l.publicHolidays ?? 0);
  const value = l.value !== null ? convert(s.data, l.value, r.money.localCurrency, s.profile.displayCurrency) : null;
  return html`<p class="leave">${term("leave", "Paid days off")}: ${l.holiday !== null ? html`<b class="num">${num(l.holiday, Number.isInteger(l.holiday) ? 0 : 1)}</b> by law${src("annual_leave")}` : "holiday by law not known"}${l.publicHolidays !== null ? html` + <b class="num">${l.publicHolidays}</b> public holidays${src("public_holidays")}` : ""}${l.holiday !== null && l.publicHolidays !== null ? html` = ${num(days, Number.isInteger(days) ? 0 : 1)} days` : ""}${value !== null && days > 0 ? html`, worth ${money(value, s.profile.displayCurrency)} of your pay` : ""}.${l.holidayNote ? html` <span class="quiet">${l.holidayNote}.</span>` : ""}
    ${l.mothers !== null || l.fathers !== null ? html`<br>Paid parental leave, in weeks at full pay: ${l.mothers !== null ? html`mothers <b class="num">${num(l.mothers, 1)}</b>` : ""}${l.fathers !== null ? html`${l.mothers !== null ? ", " : ""}fathers <b class="num">${num(l.fathers, 1)}</b>` : ""}${src("leave_mothers")}` : ""}</p>`;
}

export function taxDetails(s: AppState, r: CityResult): Raw {
  const m = r.money;
  if (!m.tax) return html``;
  const cc = r.city.country;
  return html`<details class="taxinfo"><summary>How the tax is worked out</summary><p>${m.tax.caveats.join(" ")}</p><ul>${m.tax.sources.map((x) => html`<li><a href="${x.url}" target="_blank" rel="noopener">${x.label}</a></li>`)}</ul>
    ${(model0(cc)?.options ?? []).map((o) => html`<label class="check"><input type="checkbox" data-act="tax-option" data-country="${cc}" data-field="${o.field}" ${s.profile.income.taxTweaks[cc]?.[o.field] ? "checked" : ""}> ${o.label}</label>`)}
    <div class="tweak"><label>Taxable share<input type="number" min="0" max="1" step="0.05" value="${s.profile.income.taxTweaks[cc]?.taxableShare ?? ""}" placeholder="1" data-tweak="${cc}" data-tweak-field="taxableShare"></label>
    <label>Flat rate<input type="number" min="0" max="1" step="0.01" value="${s.profile.income.taxTweaks[cc]?.flatRate ?? ""}" placeholder="none" data-tweak="${cc}" data-tweak-field="flatRate"></label></div>
    <p class="hint">For special regimes in ${countryName(s.data, cc)}: a share of 0.5 taxes half your gross; a flat rate replaces the schedule.</p></details>`;
}

/** Per-city pay fields, one per earner whose pay differs by city. */
function perCityPay(s: AppState, r: CityResult): Raw {
  const local = r.money.localCurrency;
  const p = s.profile;
  const earners = [{ i: 0, label: "Your", mode: p.income.mode, own: p.income.perCity[r.city.id] }, ...p.household.slice(1).map((x, j) => ({ i: j + 1, label: `${x.label}'s`, mode: x.pay?.mode, own: x.pay?.perCity?.[r.city.id] }))].filter((e) => e.mode === "per-city");
  return html`${earners.map(
    (e) => html`<label class="fld">${e.label} gross pay a year in ${r.city.name}<span class="fld-row"><input type="number" inputmode="numeric" min="0" step="1000" value="${e.own?.gross ?? ""}" placeholder="same as elsewhere" data-gross-city="${r.city.id}" data-earner="${e.i}" id="g-${e.i}-${r.city.id}"><select data-gross-currency="${r.city.id}" data-earner="${e.i}" aria-label="Currency">${[local, "EUR", "USD", "GBP"].filter((v, k, a) => a.indexOf(v) === k).map((c) => html`<option ${c === (e.own?.currency ?? local) ? "selected" : ""}>${c}</option>`)}</select></span></label>`,
  )}`;
}

export function moneyView(s: AppState, e: Evaluation): Raw {
  if (e.results.length === 0) return emptyState();
  const cards = e.results.map((r) => {
    const m = r.money;
    const local = m.localCurrency;
    return html`<article class="sheet msheet ${r.ruledOut.length ? "is-out" : ""}" data-flip="${r.city.id}">
      <header class="ms-head"><div><h3 class="dname"><a href="#/city/${r.city.id}">${r.city.name}</a></h3><p class="dmeta">${countryName(s.data, r.city.country)} · paid and spent in ${local}</p></div>
        <div class="ms-keep"><span class="k">${term("kept", "You keep")}</span><span class="a num">${m.display.monthlyLeft === null ? "–" : money(m.display.monthlyLeft, m.display.currency)}</span></div></header>
      ${perCityPay(s, r)}
      ${waterfall(s, r)}
      ${breakEvenLine(s, r)}
      ${m.filing?.note ? html`<p class="hint filing">${term("joint", m.filing.mode === "joint" ? "Filed jointly" : "Filed separately")}: ${m.filing.note}</p>` : ""}
      ${leaveLine(s, r)}
      ${advanced(s, r)}
    </article>`;
  });
  return html`<section class="mwall" aria-label="Money, city by city">${cards}</section>`;
}

const model0 = (country: string) => taxModelFor(country);

/** Newcomer regimes and tax settings: closed until opened, and open while one is in use. */
export function advanced(s: AppState, r: CityResult): Raw {
  const cc = r.city.country;
  const inUse = !!r.money.regime || Object.keys(s.profile.income.taxTweaks[cc] ?? {}).length > 0;
  const regimes = regimeBlock(s, r);
  const tax = taxDetails(s, r);
  if (!regimes.value && !tax.value) return html``;
  return html`<details class="adv" ${inUse ? "open" : ""}><summary>Newcomer regimes and tax settings${inUse ? html` <span class="quiet">· in use</span>` : ""}</summary>${regimes}${tax}</details>`;
}

/** The deciding fact behind a failed condition, in a few words. */
function shortWhy(why: string | undefined, text: string): string {
  const salary = why?.match(/gross (\d+) (\w+) against (\d+)/);
  if (salary) return `needs a salary of at least ${money(Number(salary[3]), salary[2]!)}`;
  const lived = why?.match(/last resident (\d+) years ago/);
  if (lived) return lived[1] === "0" ? "you live there now" : `you lived there ${lived[1]} years ago`;
  if (why?.startsWith("age ")) return `not for your age (${why.slice(4)})`;
  if (why?.startsWith("passports")) return "not for your passport";
  if (why === "no minor children") return "needs a child under 18";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Newcomer regimes for this city's country: who may qualify, what it is worth a month, and a switch. */
export function regimeBlock(s: AppState, r: CityResult): Raw {
  const country = r.city.country;
  const m = r.money;
  const none = NO_WAGE_REGIME[country];
  const list = regimesFor(country);
  if (!list.length) return none ? html`<p class="regime-none">${none}</p>` : html``;
  const me = s.profile.household[0];
  const model = taxModelFor(country);
  const gross = m.earners[0]?.gross ?? null;
  if (gross === null || !gross || !model) return html``;
  const facts = { ...(me?.newcomer ?? {}), citizenships: me?.citizenships, gross };
  const own = s.profile.income.taxTweaks[country];
  const base = model.compute({ gross, region: r.city.region, city: r.city.id, tweak: own, age: me?.newcomer?.age, children: s.profile.children }).net;
  const on = m.regime?.id;
  const shown = s.profile.displayCurrency;
  // Variants of one regime (the Dutch ruling's routes, for example) show once: the best route, or the one switched on.
  const seen = new Set<string>();
  const checks = eligibleRegimes(country, facts)
    .filter((c) => c.verdict !== "not eligible" || c.regime.id === on)
    .sort((x, y) => Number(y.regime.id === on) - Number(x.regime.id === on))
    .filter((c) => {
      const family = c.regime.name.split(",")[0]!;
      if (seen.has(family)) return false;
      seen.add(family);
      return true;
    });
  if (!checks.length) {
    const why = eligibleRegimes(country, facts).map((c) => {
      const failed = c.conditions.flatMap((x) => (x.options ?? [x])).find((x) => x.verdict === "not met");
      return `${c.regime.name}${failed ? ` (${shortWhy(failed.why, failed.text)})` : ""}`;
    });
    return html`<p class="regime-none">Newcomer regimes you do not qualify for: ${why.join("; ")}.</p>`;
  }
  return html`<div class="regimes">${checks.map((c) => {
    const net = model.compute({ gross, region: r.city.region, city: r.city.id, tweak: withRegime(own, c.regime, gross), age: me?.newcomer?.age, children: s.profile.children }).net;
    const gain = convert(s.data, (net - base) / 12, m.localCurrency, shown) ?? 0;
    const isOn = on === c.regime.id;
    const open = c.conditions.flatMap((x) => (x.options ?? [x]).filter((o) => o.verdict === "confirm")).filter((o, i, a) => a.findIndex((y) => y.id === o.id) === i);
    return html`<div class="regime ${isOn ? "is-on" : ""}">
      <div class="regime-head"><b>${c.regime.name}</b><span class="num">${money(gain, shown, { signed: true })} a month${isOn ? "" : " if it applies"}</span></div>
      <p class="hint">${c.regime.summary} Lasts up to ${c.regime.years} years from the move. ${isOn && m.regime?.status === "scenario" ? html`<b>Counted as a scenario, not as established:</b> answer the conditions below to settle it.` : isOn ? "Counted: your details and answers meet every condition we can check." : c.verdict === "eligible" ? "You meet every condition." : "Some conditions are yours to confirm."}</p>
      ${open.length ? html`<ul class="conds">${open.map((o) => {
        const a = me?.newcomer?.confirmed?.[o.id];
        return html`<li><span>${o.text}</span><span class="yn"><button class="${a === true ? "is-on" : ""}" data-act="confirm-cond" data-id="${o.id}" data-v="yes">Yes</button><button class="${a === false ? "is-on" : ""}" data-act="confirm-cond" data-id="${o.id}" data-v="no">No</button></span></li>`;
      })}</ul>` : ""}
      <button class="${isOn ? "btn" : "btn-quiet"}" data-act="regime" data-country="${country}" data-id="${isOn ? "none" : c.regime.id}">${isOn ? "Counted · don't count it" : "Count it"}</button>
      <span class="regime-src">${c.regime.sources.slice(0, 1).map((x) => html`<a href="${x.url}" target="_blank" rel="noopener">${x.label}</a>`)}</span>
    </div>`;
  })}</div>`;
}

export function sourcePopover(s: AppState, cityId: string, metric: string, r: Resolved | null): Raw {
  const city = s.data.cities.find((c) => c.id === cityId)!;
  const m = s.data.metrics[metric];
  if (!r || r.origin.kind === "you") return html``;
  const describes = r.level === "country" ? html`the whole of ${countryName(s.data, city.country)}, standing in for the city` : r.level === "region" ? "the wider region" : r.level === "metro" ? "the metro area" : "the city";
  const one = (o: import("../core/types.ts").Observation) => {
    const src = s.data.sources[o.source]!;
    return html`<dt>Source</dt><dd><a href="${src.url}" target="_blank" rel="noopener">${src.name}</a>, ${src.publisher}${typeof o.value === "number" ? html` · <b class="num">${num(o.value, m?.decimals ?? 1)}</b>` : ""}</dd>
      <dt>Period</dt><dd>${o.period}</dd>${o.note ? html`<dt>Note</dt><dd>${o.note}</dd>` : ""}
      <dt>Licence</dt><dd>${src.licenceUrl ? html`<a href="${src.licenceUrl}" target="_blank" rel="noopener">${src.licence}</a>` : src.licence}</dd>
      <dt>Fetched</dt><dd>${o.retrieved.length > 10 ? `${o.retrieved.slice(0, 10)} ${o.retrieved.slice(11, 16)} UTC` : o.retrieved}${o.url ? html` · <a href="${o.url}" target="_blank" rel="noopener">what was read</a>` : ""}${o.fetcher === "agent" ? " · read by your agent" : ""}</dd>`;
  };
  const head =
    r.origin.kind === "consensus"
      ? html`<p class="pop-lede">Median of ${r.origin.observations.length} sources, which range from ${num(r.origin.min, m?.decimals ?? 1)} to ${num(r.origin.max, m?.decimals ?? 1)}.</p>`
      : "";
  const list = r.origin.kind === "consensus" ? r.origin.observations : [r.origin.observation];
  return html`<div class="pop-body"><b>${m?.label ?? metric}, ${city.name}</b>${head}
    <dl><dt>Describes</dt><dd>${describes}</dd>${list.map(one)}</dl>
    ${r.others.length ? html`<p class="hint">${r.others.length} older or less local figure${r.others.length > 1 ? "s" : ""} not used.</p>` : ""}
    <button class="link" data-act="edit" data-city="${cityId}" data-metric="${metric}">Use my own number</button></div>`;
}

export { raw };
