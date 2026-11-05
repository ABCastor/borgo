import type { CityResult, Evaluation, LineResult } from "../core/engine.ts";
import { criterionById, figureWords } from "../core/criteria.ts";
import { linksOut } from "../core/links.ts";
import { resolve } from "../core/lookup.ts";
import { shortestDay } from "../core/sun.ts";
import { bandLegend, climateOf, cloudChart, dayCounts, extremesText, hourCanvas, monthChart, monthLegend, niceTotal, sunChart, warmCold, wetChart } from "./climate.ts";
import { basisSeg, comfortStep } from "./cards.ts";
import { html, type Raw } from "./dom.ts";
import { KM_PER_MILE } from "../core/units.ts";
import { countryName, currentUnits, hours, local, money, num, tempUnit } from "./format.ts";
import { failText, ruler, scoreShare, shortLabel } from "./glance.ts";
import { advanced, cell, missingText, srcMark, waterfall } from "./results.ts";
import { moneyGap } from "../core/criteria.ts";
import type { AppState } from "./state.ts";
import { term } from "./terms.ts";
import { partialNote } from "./partial.ts";

// One city's full dossier: how its score is built, its whole climate, its money and every figure.
// The month chart is where the comfortable range is most at home: drag its band, or step it beside the title.

export function comfortSteps(s: AppState): Raw {
  const { min, max } = s.profile.prefs.comfort;
  return html`<p class="cl-line">${term("comfortable", "Nice days")}, yours to define: dry, mostly clear, from 8 am to 8 pm ${basisSeg(s)} between ${comfortStep("min", min, "Coolest nice daytime temperature", "ds")} and ${comfortStep("max", max, "Warmest nice daytime temperature", "ds")} ${tempUnit()}</p>`;
}

function scoreTable(s: AppState, r: CityResult): Raw {
  const lines = r.lines.filter((l) => l.weight > 0).sort((a, b) => b.points - a.points);
  const set = lines.reduce((t, l) => t + l.weight, 0) || 1;
  // The share beside a line is of this score; a line that scores nowhere here says so, and its weight goes to the rest.
  const shareText = (l: LineResult) => {
    const sh = scoreShare(r, l);
    return sh === null ? `set to ${Math.round((100 * l.weight) / set)}%, not in this score: no figure to compare` : `${Math.round(100 * sh)}% of your score`;
  };
  return html`<table class="lines"><thead><tr><th scope="col">Value</th><th scope="col">${r.city.name}</th><th scope="col" class="num">Result</th><th scope="col" class="num">Points</th></tr></thead><tbody>
    ${lines.map((l) => {
      const c = criterionById(l.id);
      const fails = s.profile.dealBreakers.includes(l.id) && l.failed;
      return html`<tr class="${fails ? "is-fail" : ""} ${l.imputed ? "is-imputed" : ""}">
        <th scope="row">${shortLabel(l)}<small>${shareText(l)}${s.profile.dealBreakers.includes(l.id) ? " · must pass" : ""}</small></th>
        <td>${l.personal ? cell(s, r, l) : html`<span class="lv">${l.imputed ? html`<span class="quiet">no figure: scored as the lowest of your other cities</span>` : c?.metric ? html`<button class="edit" data-act="edit" data-city="${r.city.id}" data-metric="${c.metric}" title="Use your own number">${l.raw.text}</button>` : l.raw.text}${!l.imputed && c?.metric ? srcMark(l.raw.sources[0], r.city.id, c.metric) : ""}</span>`}${fails ? html`<span class="fail"> fails, so the city is ruled out</span>` : ""}</td>
        <td class="num"><span class="res"><i style="width:${((l.score ?? 0) * 100).toFixed(1)}%"></i></span>${l.score === null ? "–" : Math.round(l.score * 100)}</td>
        <td class="num pts">${num(l.points, 1)}</td></tr>`;
    })}</tbody>
    <tfoot><tr><th scope="row">Score</th><td></td><td></td><td class="num pts">${num(r.total, 1)}</td></tr></tfoot></table>`;
}

function climate(s: AppState, r: CityResult, e: Evaluation): Raw {
  const c = climateOf(s, r.city);
  if (!c) return html`<section class="part" id="climate"><h2 class="ph">Climate</h2><p class="note">No climate figures for ${r.city.name} yet.</p></section>`;
  const k = s.profile.prefs.comfort;
  const n = niceTotal(c);
  const wc = warmCold(c);
  const measure = s.measure === "feels" && c.fhi ? "feels" : "air";
  const wet = c.wet ? Math.round(c.wet.reduce((a, b) => a + b, 0)) : null;
  const src = c.source.origin.kind === "source" ? c.source.origin.observation : null;
  const others = e.results.filter((x) => x.city.id !== r.city.id);
  return html`<section class="part" id="climate">
    <h2 class="ph">Climate</h2>
    <dl class="facts6">
      <div><dt>Warmest</dt><dd class="num">${wc.warm}</dd></div><div><dt>Coldest</dt><dd class="num">${wc.cold}</dd></div>
      <div><dt>${term("comfortable", "Nice days")}</dt><dd class="num">${n ?? "–"}</dd></div>
      <div><dt>${term("sunshine", "Sun a year")}</dt><dd class="num">${c.sunYear ? `${num(c.sunYear)} h` : "–"}</dd></div>
      <div><dt>${term("daylight", "Shortest day")}</dt><dd class="num">${hours(shortestDay(r.city.lat))}</dd></div>
      <div><dt>${term("wet", "Wet days")}</dt><dd class="num">${wet ?? "–"}</dd></div>
    </dl>
    <div class="sub">
      <div class="sub-h"><h3>Low to high, month by month</h3></div>
      ${comfortSteps(s)}
      <div class="chartwrap">${monthChart(c, k, { measure, editable: true, cityName: r.city.name })}</div>
      ${monthLegend(c, measure)}
      <p class="note">Bars: the average daily low and high, ${measure === "feels" ? term("feels", "as it feels") : term("air", "air temperature in the shade")}${c.fhi ? html` (<button class="link" data-act="measure" data-m="${measure === "air" ? "feels" : "air"}">show ${measure === "air" ? "feels-like" : "air"} bars</button>)` : ""}. ${measure === "air" ? extremesText(c) : ""} ${(s.profile.prefs.comfort.basis ?? "feels") !== measure ? `Your range is on the ${s.profile.prefs.comfort.basis === "air" ? "air" : "feels-like"} temperature; the bars here show the ${measure === "air" ? "air" : "feels-like"} one.` : ""} The band is your nice-day range: drag its ends or use the steppers. ${c.nice ? "The more nice days a month has, the greener its bar; the count sits under each month." : ""} ${measure === "feels" ? "The score always counts air temperature." : ""}${!c.recHi ? " The spread and the extremes appear here when the city has the newer climate figures." : ""}</p>
    </div>
    ${c.hourly
      ? html`<div class="sub"><h3>${term("hourly", "Every hour of the year")}</h3>
        <div class="hmap"><div class="hy" aria-hidden="true">${[0, 6, 12, 18, 24].map((h) => html`<span style="top:${(h / 24) * 100}%">${String(h).padStart(2, "0")}:00</span>`)}</div>${hourCanvas(r.city.id, "map", `${r.city.name}: average air temperature at each hour of the day through the year, in your bands`)}</div>
        <div class="hx" aria-hidden="true">${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m) => html`<span>${m}</span>`)}</div>
        <p class="readout" id="readout" aria-live="polite"><span class="quiet">Point at the map to read any hour.</span></p>
        ${bandLegend(k)}
        ${others.length ? html`<h3 class="sub-h2">Next to your other cities</h3><div class="hrow">${e.results.map((x) => {
          const xc = climateOf(s, x.city);
          return xc?.hourly ? html`<a class="hcell ${x.city.id === r.city.id ? "is-on" : ""}" href="#/city/${x.city.id}" ${x.city.id === r.city.id ? html`aria-current="page"` : ""}><span class="hn">${x.city.name}<span>${niceTotal(xc) === null ? "" : `${niceTotal(xc)} nice days`}</span></span>${hourCanvas(x.city.id, "strip", `${x.city.name}: every hour of the year`)}</a>` : "";
        })}</div>` : ""}</div>`
      : ""}
    ${Object.keys(c.days).length ? html`<div class="sub"><h3>Weather days</h3><p class="note">Days a year that pass each test, from the same five years; point at one for its definition.</p>${dayCounts(c, s.data.metrics)}</div>` : ""}
    <div class="pair">
      ${c.cloud ? html`<div class="sub"><h3>${term("cloud", "Clouds")}</h3><p class="note">Share of the sky covered, on average.</p>${cloudChart(c, r.city.name)}</div>` : ""}
      <div class="sub"><h3>${term("sunshine", "Sunshine")} in the ${term("daylight", "daylight")}</h3><p class="note">${c.sun ? `Sunny hours a day (amber) within the daylight (grey). ${local(c.sunNote ?? "")}` : "Daylight only: no sunshine recorder near the city that we can use yet."}</p>${sunChart(c, r.city.name)}</div>
      ${c.wet ? html`<div class="sub"><h3>Rain</h3><p class="note">${term("wet", "Wet days")} a month, ${wet} a year.</p>${wetChart(c, r.city.name)}</div>` : ""}
    </div>
    <p class="src-line">Temperatures, cloud and rain: ${term("era5", "ERA5")}${src ? `, ${src.period}` : ""}, at ${num(r.city.lat, 2)}°, ${num(r.city.lon, 2)}° ${srcMark(c.source, r.city.id, "temp_high")}</p>
  </section>`;
}

function figures(s: AppState, r: CityResult): Raw {
  const city = r.city;
  const metrics = Object.values(s.data.metrics).filter((m) => m.shape === "scalar");
  return html`<table class="figs"><tbody>
    ${metrics.map((m) => {
      const rv = resolve(s.data, s.profile, city, m.id);
      if (!rv) return html`<tr class="is-missing"><th scope="row">${local(m.label)}</th><td colspan="2"><span class="quiet">no open data yet</span> <button class="link" data-act="edit" data-city="${city.id}" data-metric="${m.id}">add yours</button></td></tr>`;
      const v = typeof rv.value === "number" ? rv.value : null;
      const unit = m.currency === "local" ? `${s.data.countries[city.country]?.currency ?? ""}${m.unit}` : m.unit;
      const words = v === null ? null : figureWords(m, v);
      // Distances in the figure or its unit ("2 km", "37 within 10 km") follow the person's units; a density per km² stays as the source states it.
      const d = m.decimals ?? 1;
      const miles = currentUnits().distance === "mi";
      const inMiles = v !== null && miles && /\bkm\b/.test(unit) && !/km²/.test(unit);
      // A length per area (km of cycle path per km² of land) is the same ratio times km per mile in miles.
      const perArea = v !== null && miles && unit.startsWith("km per km²");
      const shown =
        words ??
        (perArea
          ? html`${num(v! * KM_PER_MILE, d)} <span class="quiet">${unit.replace("km per km²", "mi per mi²")}</span>`
          : inMiles
            ? html`<span>${local(`${v!.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d })} ${unit}`)}</span>`
            : html`${num(v, d)} <span class="quiet">${unit}</span>`);
      return html`<tr><th scope="row">${local(m.label)}</th><td class="${words ? "" : "num"}">${shown}</td><td>${srcMark(rv, city.id, m.id)}</td></tr>`;
    })}
  </tbody></table>`;
}

export function cityView(s: AppState, e: Evaluation, id: string): Raw {
  const r = e.results.find((x) => x.city.id === id);
  const city = s.data.cities.find((c) => c.id === id);
  if (!city) return html`<div class="empty"><h2>No such city here</h2><p><a href="#/">Back to your cities</a></p></div>`;
  const passing = e.results.filter((x) => !x.ruledOut.length).length;
  const tabs = html`<nav class="ctabs" aria-label="Your cities"><a class="back" href="#/">← All sheets</a>${e.results.map(
    (x) => html`<a href="#/city/${x.city.id}" class="${x.city.id === id ? "is-on" : ""} ${x.ruledOut.length ? "is-out" : ""}" ${x.city.id === id ? html`aria-current="page"` : ""}><span>${x.city.name}</span><span class="num">${Math.round(x.total)}</span></a>`,
  )}</nav>`;
  if (!r)
    return html`<div class="cgrid">${tabs}<article class="sheet big"><div class="bighead"><h1 class="dname">${city.name}</h1><p class="dmeta">Not in your comparison. <button class="link" data-act="add-known" data-city="${city.id}">Add ${city.name}</button></p></div></article></div>`;
  const m = r.money;
  return html`<div class="cgrid">${tabs}
  <article class="sheet big" aria-labelledby="big-name">
    <div class="band" aria-hidden="true"><i style="width:${r.total.toFixed(1)}%"></i></div>
    <header class="bighead">
      <div><p class="bib num">${Math.round(r.total)}<small>/ 100 ${term("score", "score")}</small></p>
        <h1 class="dname" id="big-name">${city.name}</h1>
        <p class="dmeta"><b class="rankw">${r.ruledOut.length ? "Ruled out" : `No. ${r.rank} of ${passing}`}</b> · ${countryName(s.data, city.country)}${city.population ? ` · ${num(city.population)} people` : ""}${!s.profile.income.everyday?.assumed && s.profile.income.everyday?.homeCity === city.id ? html` · <b>you live here</b>` : ""}</p>
        ${r.ruledOut.length ? html`<span class="stamp">Ruled out: ${failText(r.ruledOut, r.lines)}</span>` : partialNote(s, r, true)}</div>
      <div class="bh-keep"><span class="k">${term("kept", "You keep")}</span><span class="a num">${m.display.monthlyLeft === null ? "–" : html`${moneyGap(m) ? html`<small>at most </small>` : ""}${money(m.display.monthlyLeft, m.display.currency)}`}</span><span class="quiet">${m.display.monthlyLeft === null ? missingText(m) : "a month"}</span>
        ${r.rights.length ? html`<ul class="rights">${r.rights.map((x) => html`<li class="r-${x.status}"><b>${x.person}</b> ${x.status === "yes" ? `can live and work here (${x.via === "citizen" ? "citizen" : x.via})` : x.status === "no" ? html`<span class="${s.profile.dealBreakers.includes("right_to_live") ? "fail" : ""}">${x.person === "You" ? "need" : "needs"} a visa or permit</span>` : html`<span class="quiet">not checked:</span> <button class="link" data-act="household">add a passport</button>`}<small class="r-why">${x.text}</small></li>`)}</ul>` : html`<p class="quiet small"><button class="link" data-act="household">Add your passport</button> to see if you can live and work here.</p>`}</div>
    </header>
    <section class="part" id="score"><h2 class="ph">How the score is built</h2>${ruler(r, s.profile.dealBreakers)}${scoreTable(s, r)}</section>
    ${climate(s, r, e)}
    <div class="tear" aria-hidden="true"></div>
    <section class="part" id="money"><h2 class="ph">Money</h2><div class="pair"><div>${waterfall(s, r)}</div><div>${advanced(s, r)}</div></div></section>
    <section class="part" id="figures"><h2 class="ph">Every figure</h2><p class="note">Each with its source: point at the teal mark. Replace any with your own number.</p>${figures(s, r)}</section>
    <section class="part" id="elsewhere"><h2 class="ph">Elsewhere</h2><p class="note">Sources we may link to but not copy.</p><ul class="out">${linksOut(city).map((l) => html`<li><a href="${l.url}" target="_blank" rel="noopener">${l.label}</a></li>`)}</ul></section>
  </article></div>`;
}
